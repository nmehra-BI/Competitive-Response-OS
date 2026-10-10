-- 0006 · Wave 4 product decisions (PA) · decisions.md D-122 … D-138 (CR-PD-1 … CR-PD-9 and the extra contracts)
-- Additive only: new nullable columns or columns with defaults, new tenant-scoped tables (RLS forced), new guard
-- triggers and NOT VALID check constraints that bind new writes without rewriting existing rows. No existing
-- column, constraint, trigger or policy is changed or dropped.

-- =============================================================================
-- 1. Delegated authority (D-109 §2, CR-PD-2): the Finance-signed DoA document behind each grant.
-- =============================================================================
ALTER TABLE platform.authority_grant ADD COLUMN doa_reference text
  CHECK (doa_reference IS NULL OR char_length(doa_reference) > 0);

-- =============================================================================
-- 2. G3 investment committee (D-109 §3, D-124). Membership names who sits on a seat; it is NOT authority:
--    deciding still needs an authority grant for the gate, BU and amount. One live holder per seat per BU.
-- =============================================================================
CREATE TABLE platform.committee_member (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES platform.tenant(id),
  business_unit_id  uuid NOT NULL REFERENCES platform.business_unit(id),
  user_id           uuid NOT NULL REFERENCES platform.app_user(id),
  seat              text NOT NULL CHECK (seat IN ('chair','finance','operations')),
  valid_from        date NOT NULL,
  valid_to          date,
  doa_reference     text CHECK (doa_reference IS NULL OR char_length(doa_reference) > 0),
  entered_by        uuid NOT NULL REFERENCES platform.app_user(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (entered_by <> user_id) -- an administrator never seats themselves (never-rule 6)
);
CREATE UNIQUE INDEX committee_member_one_live_seat_idx
  ON platform.committee_member (tenant_id, business_unit_id, seat) WHERE revoked_at IS NULL;
CREATE INDEX committee_member_user_idx ON platform.committee_member (tenant_id, user_id) WHERE revoked_at IS NULL;

-- Only human principals hold a seat (agents and services never decide; never-rule 1).
CREATE FUNCTION platform.guard_committee_member() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT kind FROM platform.app_user WHERE id = NEW.user_id) IS DISTINCT FROM 'human' THEN
    RAISE EXCEPTION 'AGENT_IDENTITY_FORBIDDEN: only human principals hold a committee seat'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER committee_member_guard BEFORE INSERT OR UPDATE ON platform.committee_member
  FOR EACH ROW EXECUTE FUNCTION platform.guard_committee_member();

-- The seat a committee approval was recorded in (quorum: 2 of 3 on one snapshot hash, finance required).
ALTER TABLE platform.approval ADD COLUMN committee_seat text
  CHECK (committee_seat IS NULL OR committee_seat IN ('chair','finance','operations'));
-- At most one decision per seat per snapshot (UNIQUE (snapshot_id, approver_user_id) already holds per person).
CREATE UNIQUE INDEX approval_one_per_seat_idx ON platform.approval (snapshot_id, committee_seat)
  WHERE committee_seat IS NOT NULL;

-- =============================================================================
-- 3. Pilot thresholds carry a measure type (D-115, CR-PD-4, D-126). The G3 demand clause reads `demand`.
-- =============================================================================
ALTER TABLE platform.outcome_target ADD COLUMN measure_type text
  CHECK (measure_type IS NULL OR measure_type IN ('demand','delivery_effort','buyer_fit','spend','other'));

-- =============================================================================
-- 4. Licence rights, term end and on-expiry action (D-120, CR-PD-7). Fail closed: without a written
--    confirmation, or after the term ended, a licence allows metadata only. NOT VALID: binds every new or
--    changed row; rows written before 0006 are re-seeded or corrected through S14 (D-129).
-- =============================================================================
ALTER TABLE platform.license
  ADD COLUMN rights_document_ref text CHECK (rights_document_ref IS NULL OR char_length(rights_document_ref) > 0),
  ADD COLUMN rights_confirmed_on date,
  ADD COLUMN rights_recorded_by  uuid REFERENCES platform.app_user(id),
  ADD COLUMN term_ends_on        date,
  ADD COLUMN on_expiry_action    text NOT NULL DEFAULT 'remove_content_keep_metadata'
    CHECK (on_expiry_action IN ('remove_content_keep_metadata','delete_copy_keep_audit')),
  ADD COLUMN expired_at          timestamptz,
  ADD CONSTRAINT license_confirmation_complete
    CHECK ((rights_document_ref IS NULL) = (rights_confirmed_on IS NULL)) NOT VALID,
  ADD CONSTRAINT license_fail_closed
    CHECK ((rights_document_ref IS NOT NULL AND expired_at IS NULL)
           OR (max_excerpt_sentences = 0 AND NOT allow_model_context AND NOT allow_embeddings AND NOT allow_export))
    NOT VALID;
CREATE INDEX license_term_end_idx ON platform.license (tenant_id, term_ends_on)
  WHERE term_ends_on IS NOT NULL AND expired_at IS NULL;

-- =============================================================================
-- 5. Tenant "Live analysis" setting (D-120 §4, CR-PD-8, D-130). Off by default; on only with the signed addendum
--    (reference and date) and a passing manual eval run recorded. Every change is audited by the API.
-- =============================================================================
CREATE TABLE platform.tenant_ai_setting (
  tenant_id           uuid PRIMARY KEY REFERENCES platform.tenant(id),
  live_enabled        boolean NOT NULL DEFAULT false,
  addendum_ref        text CHECK (addendum_ref IS NULL OR char_length(addendum_ref) > 0),
  addendum_signed_on  date,
  eval_run_ref        text CHECK (eval_run_ref IS NULL OR char_length(eval_run_ref) > 0),
  eval_passed_at      timestamptz,
  changed_by          uuid REFERENCES platform.app_user(id),
  changed_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT live_enabled OR (addendum_ref IS NOT NULL AND addendum_signed_on IS NOT NULL
                              AND eval_run_ref IS NOT NULL AND eval_passed_at IS NOT NULL))
);

-- =============================================================================
-- 6. Record spend (D-114 §2, D-133): reference, task link, reversing entries. Entries stay append-only
--    (0001 trigger + revoked privileges). A reversal names the entry it reverses, with a reason, and carries
--    the same gate, kind, amount and currency; the meter subtracts it. An entry is reversed at most once and
--    a reversal is never reversed.
-- =============================================================================
ALTER TABLE me.budget_entry
  ADD COLUMN reference          text CHECK (reference IS NULL OR char_length(reference) > 0),
  ADD COLUMN task_id            uuid REFERENCES platform.task(id),
  ADD COLUMN reverses_entry_id  uuid REFERENCES me.budget_entry(id),
  ADD COLUMN reversal_reason    text,
  ADD CONSTRAINT budget_entry_reversal_reason CHECK ((reverses_entry_id IS NULL) = (reversal_reason IS NULL)),
  ADD CONSTRAINT budget_entry_reversal_reason_text CHECK (reversal_reason IS NULL OR char_length(reversal_reason) > 0);
CREATE UNIQUE INDEX budget_entry_reversed_once_idx ON me.budget_entry (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX budget_entry_gate_idx ON me.budget_entry (tenant_id, gate_request_id);

CREATE FUNCTION me.guard_budget_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  o record;
BEGIN
  IF NEW.reverses_entry_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT case_id, gate_request_id, kind, amount, currency, reverses_entry_id
    INTO o FROM me.budget_entry WHERE id = NEW.reverses_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reversed budget entry not found' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF o.reverses_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: a reversal cannot be reversed' USING ERRCODE = 'check_violation';
  END IF;
  IF o.case_id <> NEW.case_id OR o.gate_request_id <> NEW.gate_request_id OR o.kind <> NEW.kind
     OR o.amount <> NEW.amount OR o.currency <> NEW.currency THEN
    RAISE EXCEPTION 'a reversal must match the entry it reverses (gate, kind, amount, currency)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER budget_entry_reversal_guard BEFORE INSERT ON me.budget_entry
  FOR EACH ROW EXECUTE FUNCTION me.guard_budget_reversal();

-- =============================================================================
-- 7. Pilot plan editor (D-112 §5): milestone date and evidence expected; an optional one-time budget line
--    per task. Validation task draft editor (D-113, D-128): an unsent draft task is removed by marking it,
--    never deleted, and a task that has been sent (or is being sent) cannot be removed.
-- =============================================================================
ALTER TABLE platform.milestone
  ADD COLUMN due_on            date,
  ADD COLUMN evidence_expected text;

ALTER TABLE platform.task
  ADD COLUMN budget_amount   numeric(18,2) CHECK (budget_amount IS NULL OR budget_amount >= 0),
  ADD COLUMN budget_currency char(3),
  ADD COLUMN budget_note     text,
  ADD COLUMN removed_at      timestamptz,
  ADD COLUMN removed_by      uuid REFERENCES platform.app_user(id),
  ADD CONSTRAINT task_budget_currency CHECK ((budget_amount IS NULL) = (budget_currency IS NULL)),
  ADD CONSTRAINT task_removed_by CHECK ((removed_at IS NULL) = (removed_by IS NULL));

CREATE FUNCTION platform.guard_task_removal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: a removed task stays removed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL AND EXISTS (
       SELECT 1 FROM platform.external_task_link l
        WHERE l.task_id = NEW.id AND l.sync_status NOT IN ('not_sent','in_preview')) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: a sent task cannot be removed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER task_removal_guard BEFORE UPDATE OF removed_at ON platform.task
  FOR EACH ROW EXECUTE FUNCTION platform.guard_task_removal();

-- =============================================================================
-- 8. Sizing editor (D-112 §2): basis text per input (e.g. the reachable pool's channel definition).
--    Feasibility "Add dimension" (D-112 §4, D-132): the full question beside the short label.
-- =============================================================================
ALTER TABLE me.sizing_input ADD COLUMN basis_text text;
ALTER TABLE me.feasibility_assessment ADD COLUMN question_detail text;

-- =============================================================================
-- 9. Jira Cloud connection (D-121, D-135): OAuth 2.0 (3LO) tokens of the dedicated integration account,
--    stored encrypted by the application (AES-256-GCM, key from CONNECTOR_TOKEN_KEY; only ciphertext and a
--    key id here), and single-use authorization states. Never logged, never in a snapshot, never sent to a
--    model.
-- =============================================================================
CREATE TABLE platform.connection_credential (
  connection_id             uuid PRIMARY KEY REFERENCES platform.connection(id),
  tenant_id                 uuid NOT NULL REFERENCES platform.tenant(id),
  kind                      text NOT NULL DEFAULT 'oauth2_3lo' CHECK (kind = 'oauth2_3lo'),
  access_token_ciphertext   bytea NOT NULL,
  refresh_token_ciphertext  bytea,
  key_id                    text NOT NULL,
  token_expires_at          timestamptz NOT NULL,
  scopes                    text[] NOT NULL DEFAULT '{}',
  site_url                  text NOT NULL,
  cloud_id                  text NOT NULL,
  account_id                text,
  account_display_name      text,
  authorized_by             uuid NOT NULL REFERENCES platform.app_user(id),
  authorized_at             timestamptz NOT NULL DEFAULT now(),
  refreshed_at              timestamptz,
  revoked_at                timestamptz
);

CREATE TABLE platform.connector_oauth_state (
  state_hash     char(64) PRIMARY KEY, -- sha256(state); the state itself is never stored
  tenant_id      uuid NOT NULL REFERENCES platform.tenant(id),
  connection_id  uuid NOT NULL REFERENCES platform.connection(id),
  user_id        uuid NOT NULL REFERENCES platform.app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX connector_oauth_state_expiry_idx ON platform.connector_oauth_state (tenant_id, expires_at)
  WHERE used_at IS NULL;

-- =============================================================================
-- 10. Row-level security and privileges for the new tables (0001's loop only covered tables that existed then).
-- =============================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['committee_member','tenant_ai_setting','connection_credential','connector_oauth_state']
  LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON platform.%I USING (tenant_id = platform.current_tenant_id()) '
      'WITH CHECK (tenant_id = platform.current_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON platform.committee_member, platform.tenant_ai_setting,
  platform.connection_credential, platform.connector_oauth_state TO me_app;
GRANT SELECT ON platform.committee_member, platform.tenant_ai_setting TO me_worker;
-- The worker refreshes Jira tokens before a send (D-121 §2).
GRANT SELECT, UPDATE ON platform.connection_credential TO me_worker;
GRANT EXECUTE ON FUNCTION platform.guard_committee_member(), platform.guard_task_removal(),
  me.guard_budget_reversal() TO me_app, me_worker;
