-- =============================================================================
-- Growth OS · Market Expansion OS — initial schema (FROZEN at architecture stage)
-- Source of truth for docs/market-expansion/architecture/DATA_MODEL.md.
--
-- Schemas
--   platform : Growth OS shared primitives (tenancy, identity, authority, evidence,
--              assumptions, case envelope, gates/approvals, tasks/outbox, outcomes,
--              agent runs, audit). Must not reference `me`.
--   me       : Market Expansion app-specific objects. May reference `platform`.
--   sim      : simulated external task tool (dev/test). Outside tenancy and RLS.
--
-- Conventions
--   * Every platform/me table has tenant_id and is protected by RLS on
--     platform.current_tenant_id(), which is NULL (no rows) when unset.
--   * Enumerations are text + CHECK (easy to evolve). Codes match @growth-os/contracts.
--   * Money is numeric(18,2); rates numeric(9,8); never float.
--   * Immutable rows are protected by triggers, not only by grants.
--   * Run as role me_owner. Roles are created by scripts/db-up.sh.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS me;
CREATE SCHEMA IF NOT EXISTS sim;

-- -----------------------------------------------------------------------------
-- Session context helpers
-- -----------------------------------------------------------------------------

CREATE FUNCTION platform.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION platform.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION platform.current_correlation_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.correlation_id', true), '')
$$;

-- -----------------------------------------------------------------------------
-- Generic guard functions
-- -----------------------------------------------------------------------------

-- Insert-only tables: any UPDATE or DELETE fails.
CREATE FUNCTION platform.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table %.% is append-only (% rejected)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- Versioned tables with a `state` column: committed rows never change or disappear.
CREATE FUNCTION platform.guard_committed_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state = 'committed' THEN
      RAISE EXCEPTION '%.%: committed version % cannot be deleted', TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state = 'committed' THEN
    RAISE EXCEPTION '%.%: committed version % is immutable', TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- Child rows of a versioned parent: no insert/update/delete once the parent is committed.
-- TG_ARGV[0] = qualified parent table, TG_ARGV[1] = FK column in this table.
CREATE FUNCTION platform.guard_child_of_committed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_id uuid;
  parent_state text;
BEGIN
  parent_id := (to_jsonb(COALESCE(NEW, OLD)) ->> TG_ARGV[1])::uuid;
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> TG_ARGV[1])::uuid IS DISTINCT FROM parent_id THEN
    RAISE EXCEPTION '%.%: parent reference is immutable', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  EXECUTE format('SELECT state FROM %s WHERE id = $1', TG_ARGV[0]) INTO parent_state USING parent_id;
  IF parent_state = 'committed' THEN
    RAISE EXCEPTION '%.%: parent % is committed; create a new draft version instead', TG_TABLE_SCHEMA, TG_TABLE_NAME, parent_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE FUNCTION platform.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF to_jsonb(NEW) ? 'row_version' THEN
    NEW.row_version := OLD.row_version + 1;
  END IF;
  RETURN NEW;
END $$;

-- =============================================================================
-- PLATFORM · tenancy and identity
-- =============================================================================

CREATE TABLE platform.tenant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  data_residency  text NOT NULL DEFAULT 'eu',
  illustrative    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.business_unit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenant(id),
  key         text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE platform.app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenant(id),
  email         text NOT NULL CHECK (email = lower(email)),
  display_name  text NOT NULL,
  title         text,
  initials      text NOT NULL CHECK (char_length(initials) BETWEEN 1 AND 3),
  kind          text NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'service', 'agent')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email),
  UNIQUE (tenant_id, id)
);

CREATE TABLE platform.role_assignment (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES platform.tenant(id),
  user_id           uuid NOT NULL REFERENCES platform.app_user(id),
  role              text NOT NULL CHECK (role IN ('sponsor','case_owner','pilot_owner','commercial_reviewer',
                      'product_reviewer','finance_reviewer','specialist_reviewer','investment_committee',
                      'read_only_reviewer','tenant_admin')),
  business_unit_id  uuid REFERENCES platform.business_unit(id),
  case_id           uuid, -- FK added after workflow_case
  granted_by        uuid NOT NULL REFERENCES platform.app_user(id),
  granted_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz
);
CREATE INDEX role_assignment_user_idx ON platform.role_assignment (tenant_id, user_id) WHERE revoked_at IS NULL;

-- Delegated authority: gate × business unit × ceiling. Admins configure; grants never go to agents.
CREATE TABLE platform.authority_grant (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES platform.tenant(id),
  user_id           uuid NOT NULL REFERENCES platform.app_user(id),
  gate_code         text NOT NULL CHECK (gate_code IN ('G0','G1','G2','G3','X')),
  business_unit_id  uuid NOT NULL REFERENCES platform.business_unit(id),
  ceiling_amount    numeric(18,2) CHECK (ceiling_amount IS NULL OR ceiling_amount >= 0),
  currency          char(3),
  valid_from        date NOT NULL,
  valid_to          date,
  granted_by        uuid NOT NULL REFERENCES platform.app_user(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  CHECK ((ceiling_amount IS NULL) = (currency IS NULL)),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX authority_grant_lookup_idx ON platform.authority_grant (tenant_id, user_id, gate_code, business_unit_id)
  WHERE revoked_at IS NULL;

CREATE TABLE platform.policy (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenant(id),
  kind        text NOT NULL CHECK (kind IN ('gate','materiality','approval_expiry','retention','run_budget','self_approval')),
  key         text NOT NULL,
  version     integer NOT NULL CHECK (version > 0),
  status      text NOT NULL CHECK (status IN ('draft','active','retired')),
  body        jsonb NOT NULL,
  created_by  uuid NOT NULL REFERENCES platform.app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, key, version)
);
CREATE UNIQUE INDEX policy_one_active_idx ON platform.policy (tenant_id, kind, key) WHERE status = 'active';

CREATE TABLE platform.session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenant(id),
  user_id      uuid NOT NULL REFERENCES platform.app_user(id),
  token_hash   text NOT NULL UNIQUE, -- sha256 of the cookie token; the token itself is never stored
  auth_method  text NOT NULL CHECK (auth_method IN ('dev_persona','oidc')),
  interactive  boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

-- Per-tenant counters for display keys: ME-104, OPP-07, SRC-014 ...
CREATE TABLE platform.display_key_counter (
  tenant_id   uuid NOT NULL REFERENCES platform.tenant(id),
  prefix      text NOT NULL,
  next_value  integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, prefix)
);

-- Enterprise context references (shared, stable identity)
CREATE TABLE platform.product (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenant(id),
  key         text NOT NULL,
  name        text NOT NULL,
  description text,
  UNIQUE (tenant_id, key)
);

CREATE TABLE platform.segment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenant(id),
  key         text NOT NULL,
  name        text NOT NULL,
  UNIQUE (tenant_id, key)
);

CREATE TABLE platform.company (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES platform.tenant(id),
  name               text NOT NULL,
  parent_company_id  uuid REFERENCES platform.company(id)
);

CREATE TABLE platform.site (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES platform.tenant(id),
  external_site_id  text NOT NULL,
  name              text NOT NULL,
  company_id        uuid REFERENCES platform.company(id),
  country_code      char(2) NOT NULL,
  segment_id        uuid REFERENCES platform.segment(id),
  restricted        boolean NOT NULL DEFAULT true,
  source_id         uuid, -- FK added after source
  UNIQUE (tenant_id, external_site_id)
);

-- =============================================================================
-- PLATFORM · case envelope
-- =============================================================================

CREATE TABLE platform.workflow_case (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES platform.tenant(id),
  app_type          text NOT NULL CHECK (app_type IN ('market_expansion','competitive_response')),
  display_key       text NOT NULL,
  title             text NOT NULL,
  business_unit_id  uuid NOT NULL REFERENCES platform.business_unit(id),
  owner_user_id     uuid NOT NULL REFERENCES platform.app_user(id),
  sponsor_user_id   uuid NOT NULL REFERENCES platform.app_user(id),
  stage             text NOT NULL,
  held_from_stage   text,
  origin_type       text NOT NULL CHECK (origin_type IN ('opportunity','direct','handoff')),
  origin_id         uuid,
  mandate_id        uuid, -- app reference (me.mandate); FK added in the me section
  row_version       integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES platform.app_user(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES platform.app_user(id),
  closed_at         timestamptz,
  UNIQUE (tenant_id, display_key),
  UNIQUE (tenant_id, id),
  CHECK (app_type <> 'market_expansion' OR stage IN ('draft_mandate','discovery','assessment','validation',
    'pilot_approval_pending','pilot_approved','pilot_running','review_due','scale_approval_pending','scaling',
    'closed','on_hold','stopped')),
  CHECK ((stage = 'on_hold') = (held_from_stage IS NOT NULL))
);
CREATE INDEX workflow_case_stage_idx ON platform.workflow_case (tenant_id, app_type, stage);
CREATE INDEX workflow_case_owner_idx ON platform.workflow_case (tenant_id, owner_user_id);
CREATE TRIGGER workflow_case_touch BEFORE UPDATE ON platform.workflow_case
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE platform.role_assignment
  ADD CONSTRAINT role_assignment_case_fk FOREIGN KEY (case_id) REFERENCES platform.workflow_case(id);

CREATE TABLE platform.case_participant (
  tenant_id         uuid NOT NULL REFERENCES platform.tenant(id),
  case_id           uuid NOT NULL REFERENCES platform.workflow_case(id),
  user_id           uuid NOT NULL REFERENCES platform.app_user(id),
  participant_role  text NOT NULL,
  added_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id, participant_role)
);

-- =============================================================================
-- PLATFORM · evidence, provenance, licensing
-- =============================================================================

CREATE TABLE platform.license (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES platform.tenant(id),
  key                    text NOT NULL,
  name                   text NOT NULL,
  boundary_text          text NOT NULL,
  max_excerpt_sentences  integer NOT NULL DEFAULT 0 CHECK (max_excerpt_sentences >= 0),
  allow_model_context    boolean NOT NULL DEFAULT false,
  allow_embeddings       boolean NOT NULL DEFAULT false,
  allow_export           boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, key)
);

CREATE TABLE platform.source_entitlement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  license_id      uuid NOT NULL REFERENCES platform.license(id),
  principal_type  text NOT NULL CHECK (principal_type IN ('role','user')),
  principal       text NOT NULL,
  access          text NOT NULL CHECK (access IN ('excerpt','aggregate_only','none')),
  UNIQUE (license_id, principal_type, principal)
);

CREATE TABLE platform.source (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES platform.tenant(id),
  display_key              text NOT NULL,
  title                    text NOT NULL,
  publisher                text,
  origin_kind              text NOT NULL CHECK (origin_kind IN ('licensed','authorized_upload','public_web','internal_system')),
  origin_text              text NOT NULL,
  uri                      text,
  object_key               text, -- object storage key of the stored original (never served raw)
  content_sha256           char(64),
  published_on             date,
  retrieved_at             timestamptz,
  license_id               uuid REFERENCES platform.license(id),
  ingestion_status         text NOT NULL DEFAULT 'pending' CHECK (ingestion_status IN ('pending','ingested','partial','failed')),
  availability             text NOT NULL DEFAULT 'available' CHECK (availability IN ('available','restricted','deleted_by_provider','unavailable')),
  freshness                text NOT NULL DEFAULT 'current' CHECK (freshness IN ('current','ageing','stale','superseded')),
  superseded_by_source_id  uuid REFERENCES platform.source(id),
  stale_reason             text,
  stale_marked_by          uuid REFERENCES platform.app_user(id),
  deleted_at               timestamptz,
  connection_id            uuid, -- FK added after connection
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES platform.app_user(id),
  UNIQUE (tenant_id, display_key),
  CHECK ((freshness = 'superseded') = (superseded_by_source_id IS NOT NULL))
);
CREATE INDEX source_hash_idx ON platform.source (tenant_id, content_sha256);

ALTER TABLE platform.site
  ADD CONSTRAINT site_source_fk FOREIGN KEY (source_id) REFERENCES platform.source(id);

-- Permitted excerpts only. Full text stays in object storage behind entitlement checks.
CREATE TABLE platform.evidence_passage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  source_id       uuid NOT NULL REFERENCES platform.source(id),
  locator         text NOT NULL,
  excerpt         text NOT NULL,
  excerpt_sha256  char(64) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_passage_source_idx ON platform.evidence_passage (source_id);

CREATE TABLE platform.claim (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenant(id),
  case_id       uuid REFERENCES platform.workflow_case(id),
  statement     text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('evidence','assumption','scenario','actual','inference_ai','unknown')),
  kind_detail   text,
  origin        text NOT NULL CHECK (origin IN ('human','ai','ai_edited')),
  agent_run_id  uuid, -- FK added after agent_run
  status        text NOT NULL DEFAULT 'accepted' CHECK (status IN ('proposed','accepted','challenged','discarded','superseded')),
  accepted_by   uuid REFERENCES platform.app_user(id),
  accepted_at   timestamptz,
  assumption_id uuid, -- FK added after assumption
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL REFERENCES platform.app_user(id),
  -- AI output is never an accepted fact without a human.
  CHECK (origin = 'human' OR status <> 'accepted' OR accepted_by IS NOT NULL)
);
CREATE INDEX claim_case_idx ON platform.claim (tenant_id, case_id);

CREATE TABLE platform.claim_evidence_link (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenant(id),
  claim_id    uuid NOT NULL REFERENCES platform.claim(id),
  source_id   uuid NOT NULL REFERENCES platform.source(id),
  passage_id  uuid REFERENCES platform.evidence_passage(id),
  relation    text NOT NULL CHECK (relation IN ('quoted','supports','contradicts')),
  created_by  uuid NOT NULL REFERENCES platform.app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, source_id, passage_id, relation)
);
CREATE INDEX claim_evidence_source_idx ON platform.claim_evidence_link (source_id);

CREATE TABLE platform.challenge (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(id),
  kind             text NOT NULL CHECK (kind IN ('dispute','challenge')),
  target_type      text NOT NULL CHECK (target_type IN ('assumption','claim','source','sizing_output','economics_output')),
  target_id        uuid NOT NULL,
  case_id          uuid REFERENCES platform.workflow_case(id),
  raised_by        uuid NOT NULL REFERENCES platform.app_user(id),
  statement        text NOT NULL,
  proposed_value   text,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','withdrawn')),
  resolution       text,
  resolved_by      uuid REFERENCES platform.app_user(id),
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR (resolution IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE INDEX challenge_target_idx ON platform.challenge (tenant_id, target_type, target_id);

CREATE TABLE platform.challenge_reply (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenant(id),
  challenge_id  uuid NOT NULL REFERENCES platform.challenge(id),
  author_id     uuid NOT NULL REFERENCES platform.app_user(id),
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- PLATFORM · assumptions (shared primitive)
-- =============================================================================

CREATE TABLE platform.assumption (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES platform.tenant(id),
  case_id               uuid NOT NULL REFERENCES platform.workflow_case(id),
  display_key           text NOT NULL,
  input_key             text NOT NULL, -- e.g. adoption_rate.base, annual_price, capacity
  name                  text NOT NULL,
  scenario              text CHECK (scenario IN ('downside','base','upside')),
  owner_user_id         uuid NOT NULL REFERENCES platform.app_user(id),
  sensitivity           text NOT NULL CHECK (sensitivity IN ('high','medium','low')),
  decision_critical     boolean NOT NULL DEFAULT false,
  consequence_if_false  text NOT NULL,
  validation_method     text NOT NULL,
  due_on                date,
  status                text NOT NULL DEFAULT 'untested' CHECK (status IN ('untested','testing','supported','contradicted','inconclusive','retired')),
  status_detail         text,
  retired_reason        text,
  current_version_id    uuid, -- FK added after assumption_version
  row_version           integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES platform.app_user(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, display_key),
  UNIQUE (case_id, input_key),
  CHECK (status <> 'retired' OR retired_reason IS NOT NULL)
);
CREATE TRIGGER assumption_touch BEFORE UPDATE ON platform.assumption
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- Every value change is a new immutable version.
CREATE TABLE platform.assumption_version (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES platform.tenant(id),
  assumption_id     uuid NOT NULL REFERENCES platform.assumption(id),
  version           integer NOT NULL CHECK (version > 0),
  value             numeric(24,8),
  value_text        text,
  unit              text NOT NULL CHECK (unit IN ('sites','companies','customers','rate','currency_per_year_per_site',
                      'currency_per_year','currency_one_time','interviews','commitments','hours_per_site','text')),
  currency          char(3),
  price_year        integer,
  basis             text NOT NULL,
  evidence_quality  text NOT NULL CHECK (evidence_quality IN ('strong','some','weak','none','conflicting')),
  origin            text NOT NULL CHECK (origin IN ('human','ai','ai_edited')),
  agent_run_id      uuid,
  accepted_by       uuid REFERENCES platform.app_user(id),
  change_reason     text,
  created_by        uuid NOT NULL REFERENCES platform.app_user(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assumption_id, version),
  CHECK (value IS NOT NULL OR value_text IS NOT NULL),
  CHECK (unit <> 'rate' OR (value >= 0 AND value <= 1)),
  -- An AI-proposed value is never an input until a human accepts it.
  CHECK (origin = 'human' OR accepted_by IS NOT NULL)
);
CREATE TRIGGER assumption_version_immutable BEFORE UPDATE OR DELETE ON platform.assumption_version
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

ALTER TABLE platform.assumption
  ADD CONSTRAINT assumption_current_version_fk FOREIGN KEY (current_version_id) REFERENCES platform.assumption_version(id);
ALTER TABLE platform.claim
  ADD CONSTRAINT claim_assumption_fk FOREIGN KEY (assumption_id) REFERENCES platform.assumption(id);

-- =============================================================================
-- PLATFORM · gates, snapshots, approvals (shared primitives; app defines G0–G3/X)
-- =============================================================================

CREATE TABLE platform.gate_request (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES platform.tenant(id),
  display_key             text NOT NULL,
  case_id                 uuid REFERENCES platform.workflow_case(id),
  subject_type            text NOT NULL CHECK (subject_type IN ('case','mandate')),
  subject_id              uuid NOT NULL, -- case id, or me.mandate id for a standalone G0
  business_unit_id        uuid NOT NULL REFERENCES platform.business_unit(id),
  gate_code               text NOT NULL CHECK (gate_code IN ('G0','G1','G2','G3','X')),
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_decision','stale','approved',
                            'approved_with_conditions','returned_for_revision','not_approved','withdrawn','invalidated','expired')),
  scope                   jsonb NOT NULL,
  requested_amount        numeric(18,2),
  currency                char(3),
  duration_days           integer,
  parent_gate_request_id  uuid REFERENCES platform.gate_request(id),
  current_snapshot_id     uuid, -- FK added after decision_snapshot
  submitted_by            uuid REFERENCES platform.app_user(id),
  submitted_at            timestamptz,
  decided_at              timestamptz,
  expires_at              timestamptz, -- approval unused by this time → expired
  row_version             integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES platform.app_user(id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, display_key),
  CHECK ((requested_amount IS NULL) = (currency IS NULL)),
  CHECK (gate_code <> 'X' OR parent_gate_request_id IS NOT NULL),
  CHECK ((subject_type = 'case') = (case_id IS NOT NULL))
);
CREATE INDEX gate_request_case_idx ON platform.gate_request (tenant_id, case_id, gate_code);
CREATE INDEX gate_request_open_idx ON platform.gate_request (tenant_id, status) WHERE status IN ('awaiting_decision','stale');
CREATE TRIGGER gate_request_touch BEFORE UPDATE ON platform.gate_request
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- Immutable, hashed decision package. content_canonical is RFC 8785 canonical JSON;
-- the database itself verifies content_hash = sha256(content_canonical).
CREATE TABLE platform.decision_snapshot (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES platform.tenant(id),
  gate_request_id           uuid NOT NULL REFERENCES platform.gate_request(id),
  case_id                   uuid REFERENCES platform.workflow_case(id),
  version                   integer NOT NULL CHECK (version > 0), -- per subject: "Snapshot v3"
  subject_id                uuid NOT NULL,
  content_canonical         text NOT NULL,
  content                   jsonb GENERATED ALWAYS AS (content_canonical::jsonb) STORED,
  content_hash              char(64) NOT NULL,
  hash_alg                  text NOT NULL DEFAULT 'sha256-jcs' CHECK (hash_alg = 'sha256-jcs'),
  status                    text NOT NULL DEFAULT 'current' CHECK (status IN ('current','stale','superseded')),
  stale_reason              text,
  stale_at                  timestamptz,
  superseded_by_snapshot_id uuid REFERENCES platform.decision_snapshot(id),
  created_by                uuid NOT NULL REFERENCES platform.app_user(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, version),
  UNIQUE (id, content_hash),
  CHECK (content_hash = encode(sha256(convert_to(content_canonical, 'UTF8')), 'hex')),
  CHECK (status <> 'stale' OR stale_reason IS NOT NULL)
);
CREATE INDEX decision_snapshot_gate_idx ON platform.decision_snapshot (gate_request_id);

CREATE FUNCTION platform.guard_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'decision snapshots are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.content_canonical IS DISTINCT FROM OLD.content_canonical
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.gate_request_id IS DISTINCT FROM OLD.gate_request_id
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id THEN
    RAISE EXCEPTION 'decision snapshot % content is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'superseded snapshot % cannot change', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER decision_snapshot_guard BEFORE UPDATE OR DELETE ON platform.decision_snapshot
  FOR EACH ROW EXECUTE FUNCTION platform.guard_snapshot();

ALTER TABLE platform.gate_request
  ADD CONSTRAINT gate_request_current_snapshot_fk FOREIGN KEY (current_snapshot_id) REFERENCES platform.decision_snapshot(id);

-- Component index used by the materiality evaluator: which snapshots pin which versions.
CREATE TABLE platform.snapshot_component (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  snapshot_id     uuid NOT NULL REFERENCES platform.decision_snapshot(id),
  component_type  text NOT NULL,
  component_id    uuid NOT NULL,
  component_version integer,
  PRIMARY KEY (snapshot_id, component_type, component_id)
);
CREATE INDEX snapshot_component_lookup_idx ON platform.snapshot_component (tenant_id, component_type, component_id);
CREATE TRIGGER snapshot_component_immutable BEFORE UPDATE OR DELETE ON platform.snapshot_component
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

-- Immutable decision records. Bound to (snapshot_id, snapshot_hash) by a composite FK.
CREATE TABLE platform.approval (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES platform.tenant(id),
  gate_request_id       uuid NOT NULL REFERENCES platform.gate_request(id),
  snapshot_id           uuid NOT NULL,
  snapshot_hash         char(64) NOT NULL,
  approver_user_id      uuid NOT NULL REFERENCES platform.app_user(id),
  approver_role         text NOT NULL,
  authority_grant_id    uuid REFERENCES platform.authority_grant(id),
  session_id            uuid NOT NULL REFERENCES platform.session(id),
  disposition           text NOT NULL CHECK (disposition IN ('approve','approve_with_conditions','return_for_revision',
                          'not_approved','abstain','delegate')),
  rationale             text NOT NULL CHECK (char_length(rationale) > 0),
  note                  text,
  delegated_to_user_id  uuid REFERENCES platform.app_user(id),
  idempotency_key       text NOT NULL,
  decided_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (snapshot_id, snapshot_hash) REFERENCES platform.decision_snapshot(id, content_hash),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (snapshot_id, approver_user_id),
  CHECK (disposition NOT IN ('approve','approve_with_conditions') OR authority_grant_id IS NOT NULL),
  CHECK ((disposition = 'delegate') = (delegated_to_user_id IS NOT NULL))
);
CREATE INDEX approval_gate_idx ON platform.approval (gate_request_id);

-- Defence in depth for ME-11: the database refuses approvals that bypass the rules,
-- even if application code is wrong. Policy (authority ceilings etc.) stays in the app.
CREATE FUNCTION platform.guard_approval_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  snap record;
  approver_kind text;
  sess record;
  case_owner uuid;
BEGIN
  SELECT s.status, s.created_by, s.gate_request_id, g.status AS gate_status, g.case_id
    INTO snap
    FROM platform.decision_snapshot s JOIN platform.gate_request g ON g.id = s.gate_request_id
   WHERE s.id = NEW.snapshot_id;
  IF snap.gate_request_id IS DISTINCT FROM NEW.gate_request_id THEN
    RAISE EXCEPTION 'approval snapshot does not belong to gate request' USING ERRCODE = 'check_violation';
  END IF;
  IF snap.status <> 'current' THEN
    RAISE EXCEPTION 'SNAPSHOT_STALE: snapshot % is %', NEW.snapshot_id, snap.status USING ERRCODE = 'check_violation';
  END IF;
  IF snap.gate_status <> 'awaiting_decision' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: gate request is %', snap.gate_status USING ERRCODE = 'check_violation';
  END IF;
  SELECT kind INTO approver_kind FROM platform.app_user WHERE id = NEW.approver_user_id;
  IF approver_kind <> 'human' THEN
    RAISE EXCEPTION 'AGENT_IDENTITY_FORBIDDEN: only human principals decide gates' USING ERRCODE = 'check_violation';
  END IF;
  SELECT user_id, interactive, expires_at, revoked_at INTO sess FROM platform.session WHERE id = NEW.session_id;
  IF sess.user_id IS DISTINCT FROM NEW.approver_user_id OR NOT sess.interactive
     OR sess.revoked_at IS NOT NULL OR sess.expires_at < now() THEN
    RAISE EXCEPTION 'AGENT_IDENTITY_FORBIDDEN: decision requires the approver''s own interactive session' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.disposition IN ('approve','approve_with_conditions') THEN
    IF snap.created_by = NEW.approver_user_id THEN
      RAISE EXCEPTION 'SELF_APPROVAL_PROHIBITED: package author cannot approve' USING ERRCODE = 'check_violation';
    END IF;
    IF snap.case_id IS NOT NULL THEN
      SELECT owner_user_id INTO case_owner FROM platform.workflow_case WHERE id = snap.case_id;
      IF case_owner = NEW.approver_user_id THEN
        RAISE EXCEPTION 'SELF_APPROVAL_PROHIBITED: case owner cannot approve own gate' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM platform.authority_grant a
                    WHERE a.id = NEW.authority_grant_id AND a.user_id = NEW.approver_user_id AND a.revoked_at IS NULL
                      AND a.valid_from <= current_date AND (a.valid_to IS NULL OR a.valid_to >= current_date)) THEN
      RAISE EXCEPTION 'AUTHORITY_INSUFFICIENT: no valid authority grant' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_guard_insert BEFORE INSERT ON platform.approval
  FOR EACH ROW EXECUTE FUNCTION platform.guard_approval_insert();
CREATE TRIGGER approval_immutable BEFORE UPDATE OR DELETE ON platform.approval
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE platform.material_change (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES platform.tenant(id),
  case_id                  uuid NOT NULL REFERENCES platform.workflow_case(id),
  change_type              text NOT NULL CHECK (change_type IN ('geography_changed','product_changed','segment_changed',
                             'spend_ceiling_changed','decision_critical_assumption_changed','model_version_changed',
                             'source_superseded_or_deleted','specialist_scope_changed','plan_tasks_changed',
                             'plan_destination_changed','comment_or_formatting','other')),
  object_type              text NOT NULL,
  object_id                uuid NOT NULL,
  from_version             integer,
  to_version               integer,
  classification           text NOT NULL CHECK (classification IN ('material','not_material','uncertain')),
  rule_key                 text NOT NULL,
  policy_id                uuid REFERENCES platform.policy(id),
  actor_user_id            uuid REFERENCES platform.app_user(id),
  detected_at              timestamptz NOT NULL DEFAULT now(),
  resolved_classification  text CHECK (resolved_classification IN ('material','not_material')),
  resolved_by              uuid REFERENCES platform.app_user(id),
  resolved_at              timestamptz,
  resolution_rationale     text
);
CREATE INDEX material_change_case_idx ON platform.material_change (tenant_id, case_id, detected_at DESC);

CREATE TABLE platform.material_change_impact (
  tenant_id           uuid NOT NULL REFERENCES platform.tenant(id),
  material_change_id  uuid NOT NULL REFERENCES platform.material_change(id),
  snapshot_id         uuid NOT NULL REFERENCES platform.decision_snapshot(id),
  effect              text NOT NULL CHECK (effect IN ('snapshot_stale','approval_invalidated','escalated')),
  PRIMARY KEY (material_change_id, snapshot_id, effect)
);

-- Invalidation is an event, not an edit of the approval row.
CREATE TABLE platform.approval_invalidation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES platform.tenant(id),
  approval_id         uuid NOT NULL UNIQUE REFERENCES platform.approval(id),
  kind                text NOT NULL CHECK (kind IN ('invalidated','expired')),
  reason              text NOT NULL,
  material_change_id  uuid REFERENCES platform.material_change(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER approval_invalidation_immutable BEFORE UPDATE OR DELETE ON platform.approval_invalidation
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE platform.condition (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(id),
  gate_request_id  uuid NOT NULL REFERENCES platform.gate_request(id),
  approval_id      uuid REFERENCES platform.approval(id), -- set when added at approval
  key              text NOT NULL, -- C1, C2 ...
  text             text NOT NULL,
  owner_user_id    uuid NOT NULL REFERENCES platform.app_user(id),
  due_on           date,
  due_rule         text,
  blocks_execution boolean NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','met','waived')),
  met_evidence     text,
  met_by           uuid REFERENCES platform.app_user(id),
  met_at           timestamptz,
  added_by         uuid NOT NULL REFERENCES platform.app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gate_request_id, key),
  CHECK (status <> 'met' OR (met_evidence IS NOT NULL AND met_by IS NOT NULL))
);

CREATE TABLE platform.reviewer_position (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES platform.tenant(id),
  snapshot_id        uuid NOT NULL REFERENCES platform.decision_snapshot(id),
  reviewer_user_id   uuid NOT NULL REFERENCES platform.app_user(id),
  area               text NOT NULL CHECK (area IN ('finance','specialist','product','commercial','pilot_owner','operations','sponsor')),
  position           text NOT NULL CHECK (position IN ('supports','supports_with_conditions','dissents','abstains',
                       'not_yet_reviewed','accepts_ownership')),
  scope_text         text NOT NULL,
  signed_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, reviewer_user_id, area)
);

CREATE TABLE platform.dissent (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES platform.tenant(id),
  case_id                  uuid NOT NULL REFERENCES platform.workflow_case(id),
  author_id                uuid NOT NULL REFERENCES platform.app_user(id),
  statement                text NOT NULL,
  scope_text               text NOT NULL,
  signed_snapshot_id       uuid REFERENCES platform.decision_snapshot(id),
  signed_at                timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER dissent_immutable BEFORE UPDATE OR DELETE ON platform.dissent
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE platform.review_request (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(id),
  case_id          uuid NOT NULL REFERENCES platform.workflow_case(id),
  area             text NOT NULL CHECK (area IN ('finance','specialist','product','commercial','pilot_owner','operations','sponsor')),
  target_type      text NOT NULL,
  target_id        uuid,
  question         text NOT NULL,
  what_to_check    text[] NOT NULL DEFAULT '{}',
  requested_by     uuid NOT NULL REFERENCES platform.app_user(id),
  reviewer_user_id uuid NOT NULL REFERENCES platform.app_user(id),
  due_on           date,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','responded','cancelled')),
  response         text CHECK (response IN ('confirm','dispute','abstain')),
  response_reason  text,
  responded_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'responded') = (response IS NOT NULL))
);
CREATE INDEX review_request_reviewer_idx ON platform.review_request (tenant_id, reviewer_user_id, status);

-- =============================================================================
-- PLATFORM · connections, tasks, outbox
-- =============================================================================

CREATE TABLE platform.connection (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(id),
  kind             text NOT NULL CHECK (kind IN ('task_tool','market_data','finance','crm','trade_registry')),
  provider         text NOT NULL, -- jira_simulated | jira_cloud | upload | ...
  name             text NOT NULL,
  scope_text       text NOT NULL,
  used_for         text NOT NULL,
  status           text NOT NULL CHECK (status IN ('connected','expired','missing_permission','unavailable')),
  last_success_at  timestamptz,
  last_checked_at  timestamptz,
  config           jsonb NOT NULL DEFAULT '{}', -- non-secret settings only
  secret_ref       text, -- reference into the secret store; never the secret
  created_by       uuid NOT NULL REFERENCES platform.app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE platform.source
  ADD CONSTRAINT source_connection_fk FOREIGN KEY (connection_id) REFERENCES platform.connection(id);

CREATE TABLE platform.connector_mapping (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES platform.tenant(id),
  connection_id        uuid NOT NULL REFERENCES platform.connection(id),
  purpose              text NOT NULL CHECK (purpose IN ('validation_tasks','pilot_tasks')),
  destination_project  text NOT NULL,
  issue_type           text NOT NULL,
  assignee_map         jsonb NOT NULL DEFAULT '{}',
  UNIQUE (connection_id, purpose)
);

CREATE TABLE platform.task_set (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    uuid NOT NULL REFERENCES platform.tenant(id),
  case_id                      uuid NOT NULL REFERENCES platform.workflow_case(id),
  owner_type                   text NOT NULL CHECK (owner_type IN ('pilot_plan_version','experiment')),
  owner_id                     uuid NOT NULL,
  authorizing_gate_request_id  uuid NOT NULL REFERENCES platform.gate_request(id),
  connection_id                uuid REFERENCES platform.connection(id),
  mapping_id                   uuid REFERENCES platform.connector_mapping(id),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)
);

CREATE TABLE platform.milestone (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenant(id),
  task_set_id  uuid NOT NULL REFERENCES platform.task_set(id),
  name         text NOT NULL,
  window_text  text NOT NULL,
  ordinal      integer NOT NULL,
  UNIQUE (task_set_id, ordinal)
);

CREATE TABLE platform.task (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenant(id),
  case_id        uuid NOT NULL REFERENCES platform.workflow_case(id),
  task_set_id    uuid NOT NULL REFERENCES platform.task_set(id),
  ordinal        integer NOT NULL CHECK (ordinal > 0),
  title          text NOT NULL,
  milestone_id   uuid REFERENCES platform.milestone(id),
  function       text NOT NULL CHECK (function IN ('product','sales','marketing','operations','strategy','finance','specialist')),
  owner_user_id  uuid REFERENCES platform.app_user(id), -- nullable in draft; activation requires all set
  due_on         date,
  due_rule       text,
  deliverable    text NOT NULL,
  condition_key  text,
  status         text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','blocked','done')),
  completed_at   timestamptz,
  row_version    integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_set_id, ordinal)
);
CREATE INDEX task_owner_idx ON platform.task (tenant_id, owner_user_id, status);
CREATE TRIGGER task_touch BEFORE UPDATE ON platform.task
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.task_dependency (
  tenant_id           uuid NOT NULL REFERENCES platform.tenant(id),
  task_id             uuid NOT NULL REFERENCES platform.task(id),
  depends_on_task_id  uuid NOT NULL REFERENCES platform.task(id),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE platform.task_sync_preview (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenant(id),
  task_set_id    uuid NOT NULL REFERENCES platform.task_set(id),
  plan_version_id uuid,
  content        jsonb NOT NULL,
  content_hash   char(64) NOT NULL,
  created_by     uuid NOT NULL REFERENCES platform.app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);

-- One row per (task, destination). Separate from internal task status (honest sync).
CREATE TABLE platform.external_task_link (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES platform.tenant(id),
  task_id             uuid NOT NULL REFERENCES platform.task(id),
  connection_id       uuid NOT NULL REFERENCES platform.connection(id),
  idempotency_key     char(64) NOT NULL, -- sha256(tenant|plan_version|task|destination)
  sync_status         text NOT NULL DEFAULT 'not_sent' CHECK (sync_status IN ('not_sent','in_preview','sending','confirmed',
                        'failed','retry_scheduled','checking','paused_approval_changed','paused_connector')),
  external_key        text,
  external_url        text,
  attempts            integer NOT NULL DEFAULT 0,
  last_error_code     text,
  last_error_message  text,
  retryable           boolean NOT NULL DEFAULT true,
  preview_id          uuid REFERENCES platform.task_sync_preview(id),
  confirmed_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (task_id, connection_id),
  CHECK ((sync_status = 'confirmed') = (external_key IS NOT NULL))
);

CREATE TABLE platform.outbox_message (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES platform.tenant(id),
  kind               text NOT NULL CHECK (kind IN ('task.create','analytics.emit')),
  aggregate_type     text NOT NULL,
  aggregate_id       uuid NOT NULL,
  idempotency_key    text NOT NULL,
  payload            jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','checking','confirmed','failed','paused','cancelled')),
  attempts           integer NOT NULL DEFAULT 0,
  max_attempts       integer NOT NULL DEFAULT 5,
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  locked_until       timestamptz,
  last_error         jsonb,
  actor_user_id      uuid REFERENCES platform.app_user(id), -- execution identity (authorizing human)
  authorization_ref  jsonb NOT NULL DEFAULT '{}', -- {gateRequestId, approvalId, snapshotHash, planVersionId}
  external_ref       text,
  correlation_id     text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  sent_at            timestamptz,
  UNIQUE (tenant_id, kind, idempotency_key)
);
CREATE INDEX outbox_ready_idx ON platform.outbox_message (next_attempt_at) WHERE status IN ('pending','checking');

-- =============================================================================
-- PLATFORM · outcomes and decisions
-- =============================================================================

CREATE TABLE platform.outcome_target (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(id),
  case_id          uuid NOT NULL REFERENCES platform.workflow_case(id),
  snapshot_id      uuid NOT NULL REFERENCES platform.decision_snapshot(id), -- pre-registered in the approved snapshot
  metric_key       text NOT NULL,
  name             text NOT NULL,
  threshold_text   text NOT NULL,
  operator         text NOT NULL CHECK (operator IN ('gte','lte','eq','qualitative')),
  threshold_value  numeric(24,8),
  unit             text NOT NULL,
  window_text      text NOT NULL,
  UNIQUE (snapshot_id, metric_key)
);
CREATE TRIGGER outcome_target_immutable BEFORE UPDATE OR DELETE ON platform.outcome_target
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE platform.outcome_observation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenant(id),
  case_id        uuid NOT NULL REFERENCES platform.workflow_case(id),
  target_id      uuid REFERENCES platform.outcome_target(id),
  label          text NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  value          numeric(24,8),
  value_text     text NOT NULL,
  unit           text NOT NULL,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  source_text    text NOT NULL,
  source_id      uuid REFERENCES platform.source(id),
  result         text CHECK (result IN ('met','not_met','inconclusive')),
  supersedes_id  uuid REFERENCES platform.outcome_observation(id),
  recorded_by    uuid NOT NULL REFERENCES platform.app_user(id),
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
CREATE TRIGGER outcome_observation_immutable BEFORE UPDATE OR DELETE ON platform.outcome_observation
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE platform.decision_record (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES platform.tenant(id),
  case_id             uuid NOT NULL REFERENCES platform.workflow_case(id),
  outcome             text NOT NULL CHECK (outcome IN ('proceed','revise','extend','stop','scale')),
  label               text NOT NULL,
  rationale           text NOT NULL,
  decided_by          uuid NOT NULL REFERENCES platform.app_user(id),
  authority_grant_id  uuid REFERENCES platform.authority_grant(id),
  on_recommendation_of uuid REFERENCES platform.app_user(id),
  outcome_review_id   uuid, -- me.outcome_review
  decided_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER decision_record_immutable BEFORE UPDATE OR DELETE ON platform.decision_record
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

-- =============================================================================
-- PLATFORM · agent runs (analysis subsystem)
-- =============================================================================

CREATE TABLE platform.agent_run (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES platform.tenant(id),
  case_id              uuid REFERENCES platform.workflow_case(id),
  subject_type         text NOT NULL CHECK (subject_type IN ('case','mandate')),
  subject_id           uuid NOT NULL,
  skill_key            text NOT NULL,
  skill_version        text NOT NULL,
  goal                 text NOT NULL,
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_for_input',
                         'awaiting_approval','completed','partial','failed','cancelled')),
  status_detail        text,
  requested_by         uuid NOT NULL REFERENCES platform.app_user(id), -- the human the run acts for
  agent_principal_id   uuid REFERENCES platform.app_user(id), -- kind = 'agent'
  provider             text NOT NULL,
  model_config         text, -- configured model name recorded for traceability
  input_snapshot_hash  char(64) NOT NULL,
  budget               jsonb NOT NULL,
  usage                jsonb NOT NULL DEFAULT '{"elapsedMs":0,"toolCalls":0,"inputTokens":0,"outputTokens":0,"costMicros":0}',
  checkpoint           jsonb,
  last_checkpoint_seq  integer NOT NULL DEFAULT 0,
  needs_input          jsonb,
  error                jsonb,
  correlation_id       text NOT NULL,
  idempotency_key      text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  started_at           timestamptz,
  finished_at          timestamptz,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX agent_run_case_idx ON platform.agent_run (tenant_id, case_id, created_at DESC);

ALTER TABLE platform.claim
  ADD CONSTRAINT claim_agent_run_fk FOREIGN KEY (agent_run_id) REFERENCES platform.agent_run(id);
ALTER TABLE platform.assumption_version
  ADD CONSTRAINT assumption_version_agent_run_fk FOREIGN KEY (agent_run_id) REFERENCES platform.agent_run(id);

CREATE TABLE platform.agent_run_step (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenant(id),
  run_id       uuid NOT NULL REFERENCES platform.agent_run(id),
  seq          integer NOT NULL CHECK (seq >= 0),
  kind         text NOT NULL CHECK (kind IN ('provider_call','tool_call','validation','checkpoint','proposal_write')),
  status       text NOT NULL CHECK (status IN ('started','succeeded','failed')),
  summary      text NOT NULL,
  data         jsonb NOT NULL DEFAULT '{}', -- structured refs and hashes only
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  UNIQUE (run_id, seq)
);

CREATE TABLE platform.tool_call (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  run_id          uuid NOT NULL REFERENCES platform.agent_run(id),
  step_id         uuid REFERENCES platform.agent_run_step(id),
  tool_name       text NOT NULL CHECK (tool_name IN ('intelligence.search','evidence.get','portfolio.get_product',
                    'crm.get_authorized_accounts','sizing.calculate','economics.calculate','work.preview_tasks')),
  tool_version    text NOT NULL,
  args_hash       char(64) NOT NULL,
  args_redacted   jsonb NOT NULL,
  scope_check     jsonb NOT NULL,
  outcome         text NOT NULL CHECK (outcome IN ('ok','denied','error')),
  result_summary  text NOT NULL,
  result_ref      jsonb,
  latency_ms      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_call_run_idx ON platform.tool_call (run_id);
CREATE TRIGGER tool_call_immutable BEFORE UPDATE OR DELETE ON platform.tool_call
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE platform.proposal (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenant(id),
  case_id      uuid REFERENCES platform.workflow_case(id),
  run_id       uuid NOT NULL REFERENCES platform.agent_run(id),
  skill_key    text NOT NULL,
  payload      jsonb NOT NULL,
  target_type  text,
  target_id    uuid,
  status       text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','edited_and_accepted','rejected','superseded')),
  decided_by   uuid REFERENCES platform.app_user(id),
  decided_at   timestamptz,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('proposed','superseded') OR decided_by IS NOT NULL)
);
CREATE INDEX proposal_case_idx ON platform.proposal (tenant_id, case_id, status);

-- Deterministic engine results (sizing/economics). Same input hash → same output.
CREATE TABLE platform.calculation_result (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  engine          text NOT NULL CHECK (engine IN ('sizing','economics')),
  engine_version  text NOT NULL,
  input_hash      char(64) NOT NULL,
  input           jsonb NOT NULL,
  output          jsonb NOT NULL,
  blocked         boolean NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, engine, engine_version, input_hash)
);
CREATE TRIGGER calculation_result_immutable BEFORE UPDATE OR DELETE ON platform.calculation_result
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

-- =============================================================================
-- PLATFORM · comments, audit, analytics, idempotency
-- =============================================================================

CREATE TABLE platform.comment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenant(id),
  case_id      uuid NOT NULL REFERENCES platform.workflow_case(id),
  target_type  text NOT NULL,
  target_id    uuid NOT NULL,
  author_id    uuid NOT NULL REFERENCES platform.app_user(id),
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comment_target_idx ON platform.comment (tenant_id, target_type, target_id);

CREATE TABLE platform.audit_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_user_id   uuid REFERENCES platform.app_user(id),
  actor_kind      text NOT NULL CHECK (actor_kind IN ('human','service','agent','system')),
  actor_role      text,
  action          text NOT NULL,
  object_type     text NOT NULL,
  object_id       uuid NOT NULL,
  object_version  integer,
  case_id         uuid REFERENCES platform.workflow_case(id),
  before_hash     char(64),
  after_hash      char(64),
  summary         text NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}', -- ids, versions, enums; never restricted text
  authz_context   jsonb NOT NULL,
  correlation_id  text NOT NULL,
  request_id      text
);
CREATE INDEX audit_event_case_idx ON platform.audit_event (tenant_id, case_id, seq);
CREATE INDEX audit_event_object_idx ON platform.audit_event (tenant_id, object_type, object_id);
CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE ON platform.audit_event
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE platform.analytics_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenant(id),
  name         text NOT NULL CHECK (name IN ('mandate_created','mandate_approved','opportunity_shortlisted',
                 'evidence_reviewed','sizing_snapshot_created','assumption_changed','feasibility_review_recorded',
                 'validation_authorized','experiment_completed','gate_submitted','gate_returned','gate_approved',
                 'approval_invalidated','pilot_activated','external_task_confirmed','external_task_failed',
                 'outcome_recorded','extension_requested','scale_requested','case_stopped')),
  envelope     jsonb NOT NULL,
  props        jsonb NOT NULL,
  occurred_at  timestamptz NOT NULL,
  emitted_at   timestamptz
);
CREATE INDEX analytics_event_name_idx ON platform.analytics_event (tenant_id, name, occurred_at);
CREATE TRIGGER analytics_event_no_delete BEFORE DELETE ON platform.analytics_event
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE platform.idempotency_record (
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(id),
  user_id          uuid NOT NULL REFERENCES platform.app_user(id),
  key              text NOT NULL,
  method           text NOT NULL,
  route            text NOT NULL,
  request_hash     char(64) NOT NULL,
  status           text NOT NULL CHECK (status IN ('in_progress','completed')),
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id, key)
);

-- =============================================================================
-- ME · mandate, opportunities, comparison
-- =============================================================================

CREATE TABLE me.mandate (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES platform.tenant(id),
  display_key         text NOT NULL,
  business_unit_id    uuid NOT NULL REFERENCES platform.business_unit(id),
  title               text NOT NULL,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_decision','returned','approved','superseded')),
  current_version_id  uuid,
  draft_version_id    uuid,
  g0_gate_request_id  uuid REFERENCES platform.gate_request(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES platform.app_user(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, display_key)
);
CREATE TRIGGER mandate_touch BEFORE UPDATE ON me.mandate FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE me.mandate_version (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES platform.tenant(id),
  mandate_id             uuid NOT NULL REFERENCES me.mandate(id),
  version                integer NOT NULL CHECK (version > 0),
  state                  text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','committed')),
  objective              text,
  product_id             uuid REFERENCES platform.product(id),
  segment_ids            uuid[] NOT NULL DEFAULT '{}',
  geography_codes        text[] NOT NULL DEFAULT '{}',
  exclusions             text[] NOT NULL DEFAULT '{}',
  horizon_years          integer CHECK (horizon_years BETWEEN 1 AND 10),
  pilot_duration_days    integer CHECK (pilot_duration_days > 0),
  investment_ceiling     numeric(18,2) CHECK (investment_ceiling >= 0),
  currency               char(3),
  evidence_source_kinds  text[] NOT NULL DEFAULT '{}',
  owner_user_id          uuid REFERENCES platform.app_user(id),
  sponsor_user_id        uuid REFERENCES platform.app_user(id),
  success_definition     text,
  row_version            integer NOT NULL DEFAULT 0,
  committed_at           timestamptz,
  created_by             uuid NOT NULL REFERENCES platform.app_user(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mandate_id, version),
  -- A committed mandate version has every required field (ME-01).
  CHECK (state = 'draft' OR (objective IS NOT NULL AND product_id IS NOT NULL AND currency IS NOT NULL
         AND owner_user_id IS NOT NULL AND sponsor_user_id IS NOT NULL AND horizon_years IS NOT NULL
         AND success_definition IS NOT NULL AND cardinality(geography_codes) > 0 AND cardinality(segment_ids) > 0))
);
CREATE UNIQUE INDEX mandate_one_draft_idx ON me.mandate_version (mandate_id) WHERE state = 'draft';
CREATE TRIGGER mandate_version_guard BEFORE UPDATE OR DELETE ON me.mandate_version
  FOR EACH ROW EXECUTE FUNCTION platform.guard_committed_version();
CREATE TRIGGER mandate_version_touch BEFORE UPDATE ON me.mandate_version
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE me.mandate
  ADD CONSTRAINT mandate_current_version_fk FOREIGN KEY (current_version_id) REFERENCES me.mandate_version(id),
  ADD CONSTRAINT mandate_draft_version_fk FOREIGN KEY (draft_version_id) REFERENCES me.mandate_version(id);

-- The envelope's app reference to its mandate. (platform → me FK is the one allowed exception:
-- it is declared here, in the app section, so platform DDL stays app-agnostic.)
ALTER TABLE platform.workflow_case
  ADD CONSTRAINT workflow_case_me_mandate_fk FOREIGN KEY (mandate_id) REFERENCES me.mandate(id);

CREATE TABLE me.market_boundary (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES platform.tenant(id),
  market_unit           text NOT NULL,
  population_unit       text NOT NULL CHECK (population_unit IN ('site','company','customer')),
  country_code          char(2) NOT NULL,
  segment_label         text NOT NULL,
  product_boundary      text NOT NULL,
  currency              char(3) NOT NULL,
  price_year            integer NOT NULL,
  includes_hardware     boolean NOT NULL DEFAULT false,
  includes_software     boolean NOT NULL DEFAULT false,
  includes_services     boolean NOT NULL DEFAULT false,
  includes_replacement  boolean NOT NULL DEFAULT false,
  annualization_method  text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER market_boundary_immutable BEFORE UPDATE OR DELETE ON me.market_boundary
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE me.opportunity (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES platform.tenant(id),
  mandate_id               uuid NOT NULL REFERENCES me.mandate(id),
  display_key              text NOT NULL,
  name                     text NOT NULL,
  trigger_text             text NOT NULL DEFAULT '',
  fit_rationale            text NOT NULL DEFAULT '',
  origin                   text NOT NULL CHECK (origin IN ('ai','manual','handoff')),
  agent_run_id             uuid REFERENCES platform.agent_run(id),
  status                   text NOT NULL DEFAULT 'detected' CHECK (status IN ('detected','shortlisted','converted','dismissed','duplicate')),
  dismiss_reason           text,
  duplicate_of_id          uuid REFERENCES me.opportunity(id),
  likely_duplicate_of_id   uuid REFERENCES me.opportunity(id),
  converted_case_id        uuid REFERENCES platform.workflow_case(id),
  market_boundary_id       uuid REFERENCES me.market_boundary(id),
  product_id               uuid REFERENCES platform.product(id),
  segment_id               uuid REFERENCES platform.segment(id),
  country_code             char(2),
  evidence_quality         text NOT NULL DEFAULT 'none' CHECK (evidence_quality IN ('strong','some','weak','none','conflicting')),
  last_checked_at          timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES platform.app_user(id),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, display_key),
  CHECK (status <> 'dismissed' OR dismiss_reason IS NOT NULL),
  CHECK ((status = 'duplicate') = (duplicate_of_id IS NOT NULL)),
  CHECK ((status = 'converted') = (converted_case_id IS NOT NULL))
);
CREATE INDEX opportunity_mandate_idx ON me.opportunity (tenant_id, mandate_id, status);
CREATE TRIGGER opportunity_touch BEFORE UPDATE ON me.opportunity FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE me.opportunity_fit_criterion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  opportunity_id  uuid NOT NULL REFERENCES me.opportunity(id),
  criterion       text NOT NULL,
  result          text NOT NULL CHECK (result IN ('met','not_met','unknown')),
  note            text,
  ordinal         integer NOT NULL
);

CREATE TABLE me.opportunity_unknown (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  opportunity_id  uuid NOT NULL REFERENCES me.opportunity(id),
  text            text NOT NULL
);

CREATE TABLE me.opportunity_source (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  opportunity_id  uuid NOT NULL REFERENCES me.opportunity(id),
  source_id       uuid NOT NULL REFERENCES platform.source(id),
  PRIMARY KEY (opportunity_id, source_id)
);

CREATE TABLE me.comparison (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES platform.tenant(id),
  mandate_id                uuid NOT NULL REFERENCES me.mandate(id),
  opportunity_ids           uuid[] NOT NULL CHECK (cardinality(opportunity_ids) BETWEEN 2 AND 4),
  common_unit_text          text NOT NULL,
  selected_opportunity_id   uuid REFERENCES me.opportunity(id),
  created_by                uuid NOT NULL REFERENCES platform.app_user(id),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE me.comparison_weights_version (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES platform.tenant(id),
  comparison_id      uuid NOT NULL REFERENCES me.comparison(id),
  version            integer NOT NULL CHECK (version > 0),
  product_fit        integer NOT NULL CHECK (product_fit BETWEEN 0 AND 100),
  channel_access     integer NOT NULL CHECK (channel_access BETWEEN 0 AND 100),
  evidence_coverage  integer NOT NULL CHECK (evidence_coverage BETWEEN 0 AND 100),
  applied_by         uuid NOT NULL REFERENCES platform.app_user(id),
  applied_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comparison_id, version),
  CHECK (product_fit + channel_access + evidence_coverage = 100)
);
CREATE TRIGGER comparison_weights_immutable BEFORE UPDATE OR DELETE ON me.comparison_weights_version
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE me.comparison_cell (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  comparison_id   uuid NOT NULL REFERENCES me.comparison(id),
  opportunity_id  uuid NOT NULL REFERENCES me.opportunity(id),
  attribute       text NOT NULL CHECK (attribute IN ('market_boundary','tam','sam','growth_evidence','product_fit',
                    'channel_access','evidence_coverage','investment_need','readiness_blockers','unknowns')),
  rating          integer CHECK (rating BETWEEN 1 AND 3), -- NULL = Unknown, never 0
  value_text      text,
  detail_text     text,
  incomparable    boolean NOT NULL DEFAULT false,
  rated_by        uuid REFERENCES platform.app_user(id),
  source_ids      uuid[] NOT NULL DEFAULT '{}',
  UNIQUE (comparison_id, opportunity_id, attribute)
);

CREATE TABLE me.comparison_exclusion (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  comparison_id   uuid NOT NULL REFERENCES me.comparison(id),
  opportunity_id  uuid NOT NULL REFERENCES me.opportunity(id),
  reason          text NOT NULL,
  excluded_by     uuid NOT NULL REFERENCES platform.app_user(id),
  excluded_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comparison_id, opportunity_id)
);

-- =============================================================================
-- ME · thesis
-- =============================================================================

CREATE TABLE me.thesis_version (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES platform.tenant(id),
  case_id               uuid NOT NULL REFERENCES platform.workflow_case(id),
  version               integer NOT NULL CHECK (version > 0),
  state                 text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','committed')),
  fields                jsonb NOT NULL, -- ThesisFields with field-level provenance
  reviewer_accepted_by  uuid REFERENCES platform.app_user(id),
  reviewer_accepted_at  timestamptz,
  row_version           integer NOT NULL DEFAULT 0,
  committed_at          timestamptz,
  created_by            uuid NOT NULL REFERENCES platform.app_user(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version)
);
CREATE UNIQUE INDEX thesis_one_draft_idx ON me.thesis_version (case_id) WHERE state = 'draft';
CREATE TRIGGER thesis_version_guard BEFORE UPDATE OR DELETE ON me.thesis_version
  FOR EACH ROW WHEN (OLD.state = 'committed') EXECUTE FUNCTION platform.guard_committed_version();
CREATE TRIGGER thesis_version_touch BEFORE UPDATE ON me.thesis_version
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE me.thesis_claim (
  tenant_id          uuid NOT NULL REFERENCES platform.tenant(id),
  thesis_version_id  uuid NOT NULL REFERENCES me.thesis_version(id),
  claim_id           uuid NOT NULL REFERENCES platform.claim(id),
  ordinal            integer NOT NULL,
  PRIMARY KEY (thesis_version_id, claim_id)
);
CREATE TRIGGER thesis_claim_guard BEFORE INSERT OR UPDATE OR DELETE ON me.thesis_claim
  FOR EACH ROW EXECUTE FUNCTION platform.guard_child_of_committed('me.thesis_version', 'thesis_version_id');

-- =============================================================================
-- ME · sizing
-- =============================================================================

CREATE TABLE me.sizing_version (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES platform.tenant(id),
  case_id                uuid NOT NULL REFERENCES platform.workflow_case(id),
  version                integer NOT NULL CHECK (version > 0),
  state                  text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','committed')),
  method                 text NOT NULL CHECK (method IN ('aggregate_overlap','site_list_union')),
  horizon_years          integer NOT NULL CHECK (horizon_years > 0),
  market_boundary_id     uuid NOT NULL REFERENCES me.market_boundary(id),
  dedup_rule_text        text NOT NULL,
  calculation_result_id  uuid REFERENCES platform.calculation_result(id),
  row_version            integer NOT NULL DEFAULT 0,
  committed_at           timestamptz,
  committed_by           uuid REFERENCES platform.app_user(id),
  created_by             uuid NOT NULL REFERENCES platform.app_user(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version),
  -- Only an unblocked calculation can be committed.
  CHECK (state = 'draft' OR calculation_result_id IS NOT NULL)
);
CREATE UNIQUE INDEX sizing_one_draft_idx ON me.sizing_version (case_id) WHERE state = 'draft';
CREATE TRIGGER sizing_version_guard BEFORE UPDATE OR DELETE ON me.sizing_version
  FOR EACH ROW WHEN (OLD.state = 'committed') EXECUTE FUNCTION platform.guard_committed_version();
CREATE TRIGGER sizing_version_touch BEFORE UPDATE ON me.sizing_version
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE me.sizing_input (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES platform.tenant(id),
  sizing_version_id      uuid NOT NULL REFERENCES me.sizing_version(id),
  input_key              text NOT NULL, -- tam_site_count, annual_spend_per_site, reachable_pool, adoption_rate.base, capacity ...
  label                  text NOT NULL,
  kind                   text NOT NULL CHECK (kind IN ('evidence','assumption','calculated')),
  value                  numeric(24,8) NOT NULL,
  unit                   text NOT NULL,
  currency               char(3),
  price_year             integer,
  assumption_version_id  uuid REFERENCES platform.assumption_version(id), -- pinned when committed
  assumption_id          uuid REFERENCES platform.assumption(id), -- live link while draft
  source_id              uuid REFERENCES platform.source(id),
  evidence_quality       text CHECK (evidence_quality IN ('strong','some','weak','none','conflicting')),
  UNIQUE (sizing_version_id, input_key),
  CHECK (kind <> 'assumption' OR assumption_id IS NOT NULL),
  CHECK (kind <> 'evidence' OR source_id IS NOT NULL)
);
CREATE TRIGGER sizing_input_guard BEFORE INSERT OR UPDATE OR DELETE ON me.sizing_input
  FOR EACH ROW EXECUTE FUNCTION platform.guard_child_of_committed('me.sizing_version', 'sizing_version_id');

CREATE TABLE me.cohort (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES platform.tenant(id),
  sizing_version_id  uuid NOT NULL REFERENCES me.sizing_version(id),
  name               text NOT NULL,
  qualifier          text,
  rule               text NOT NULL,
  site_count         integer NOT NULL CHECK (site_count >= 0),
  population_unit    text NOT NULL CHECK (population_unit IN ('site','company','customer')),
  price_year         integer NOT NULL,
  source_id          uuid REFERENCES platform.source(id),
  site_list_ref      text, -- object key of the restricted site-ID list (site_list_union method)
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','duplicate_candidate','excluded')),
  ordinal            integer NOT NULL
);
CREATE TRIGGER cohort_guard BEFORE INSERT OR UPDATE OR DELETE ON me.cohort
  FOR EACH ROW EXECUTE FUNCTION platform.guard_child_of_committed('me.sizing_version', 'sizing_version_id');

CREATE TABLE me.cohort_overlap (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES platform.tenant(id),
  sizing_version_id  uuid NOT NULL REFERENCES me.sizing_version(id),
  cohort_a_id        uuid NOT NULL REFERENCES me.cohort(id),
  cohort_b_id        uuid NOT NULL REFERENCES me.cohort(id),
  overlap_count      integer NOT NULL, -- validated by the engine (negative blocks)
  method_text        text NOT NULL, -- "Dedup run v2"
  UNIQUE (sizing_version_id, cohort_a_id, cohort_b_id),
  CHECK (cohort_a_id <> cohort_b_id)
);
CREATE TRIGGER cohort_overlap_guard BEFORE INSERT OR UPDATE OR DELETE ON me.cohort_overlap
  FOR EACH ROW EXECUTE FUNCTION platform.guard_child_of_committed('me.sizing_version', 'sizing_version_id');

CREATE TABLE me.sizing_cross_check (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES platform.tenant(id),
  sizing_version_id  uuid NOT NULL UNIQUE REFERENCES me.sizing_version(id),
  measure            text NOT NULL DEFAULT 'sam' CHECK (measure = 'sam'),
  low                numeric(18,2) NOT NULL,
  high               numeric(18,2) NOT NULL,
  currency           char(3) NOT NULL,
  price_year         integer NOT NULL,
  basis              text NOT NULL,
  source_id          uuid REFERENCES platform.source(id),
  illustrative       boolean NOT NULL DEFAULT false,
  explanation        text,
  CHECK (high >= low)
);
CREATE TRIGGER sizing_cross_check_guard BEFORE INSERT OR UPDATE OR DELETE ON me.sizing_cross_check
  FOR EACH ROW EXECUTE FUNCTION platform.guard_child_of_committed('me.sizing_version', 'sizing_version_id');

-- =============================================================================
-- ME · feasibility
-- =============================================================================

CREATE TABLE me.feasibility_assessment (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES platform.tenant(id),
  case_id            uuid NOT NULL REFERENCES platform.workflow_case(id),
  dimension          text NOT NULL CHECK (dimension IN ('product_fit','differentiation','commercial_access','operations',
                       'specialist_review','channel','competition')),
  question           text NOT NULL,
  evidence_text      text NOT NULL DEFAULT '',
  reviewer_user_id   uuid NOT NULL REFERENCES platform.app_user(id),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','signed','declined')),
  scope_text         text NOT NULL DEFAULT 'Not yet reviewed',
  due_on             date,
  human_only         boolean NOT NULL DEFAULT false,
  current_review_id  uuid,
  UNIQUE (case_id, dimension)
);

CREATE TABLE me.feasibility_review (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES platform.tenant(id),
  assessment_id        uuid NOT NULL REFERENCES me.feasibility_assessment(id),
  version              integer NOT NULL CHECK (version > 0),
  position             text NOT NULL CHECK (position IN ('supports','supports_with_conditions','dissents','abstains',
                         'not_yet_reviewed','accepts_ownership')),
  scope_text           text NOT NULL,
  covers_gate          text CHECK (covers_gate IN ('G0','G1','G2','G3','X')),
  max_sites            integer,
  max_days             integer,
  statement            text,
  evidence_source_ids  uuid[] NOT NULL DEFAULT '{}',
  signed_by            uuid NOT NULL REFERENCES platform.app_user(id),
  signed_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, version)
);
CREATE TRIGGER feasibility_review_immutable BEFORE UPDATE OR DELETE ON me.feasibility_review
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

ALTER TABLE me.feasibility_assessment
  ADD CONSTRAINT feasibility_current_review_fk FOREIGN KEY (current_review_id) REFERENCES me.feasibility_review(id);

-- A specialist sign-off must come from a human principal (the agent cannot substitute a green check).
CREATE FUNCTION me.guard_feasibility_signer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT kind FROM platform.app_user WHERE id = NEW.signed_by) <> 'human' THEN
    RAISE EXCEPTION 'AGENT_IDENTITY_FORBIDDEN: feasibility reviews are human-owned' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feasibility_review_signer BEFORE INSERT ON me.feasibility_review
  FOR EACH ROW EXECUTE FUNCTION me.guard_feasibility_signer();

CREATE TABLE me.blocker (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         uuid NOT NULL REFERENCES platform.tenant(id),
  case_id                           uuid NOT NULL REFERENCES platform.workflow_case(id),
  assessment_id                     uuid REFERENCES me.feasibility_assessment(id),
  text                              text NOT NULL,
  owner_user_id                     uuid REFERENCES platform.app_user(id),
  due_on                            date,
  blocks_gate                       text NOT NULL CHECK (blocks_gate IN ('G0','G1','G2','G3','X')),
  status                            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','scope_restricted')),
  resolution                        text,
  resolved_by                       uuid REFERENCES platform.app_user(id),
  resolved_at                       timestamptz,
  scope_restriction_gate_request_id uuid REFERENCES platform.gate_request(id),
  created_at                        timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR resolution IS NOT NULL),
  CHECK (status <> 'scope_restricted' OR scope_restriction_gate_request_id IS NOT NULL)
);

CREATE TABLE me.feasibility_disagreement (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenant(id),
  assessment_id  uuid NOT NULL REFERENCES me.feasibility_assessment(id),
  author_id      uuid NOT NULL REFERENCES platform.app_user(id),
  statement      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE me.competitor_entry (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES platform.tenant(id),
  case_id    uuid NOT NULL REFERENCES platform.workflow_case(id),
  text       text NOT NULL,
  source_id  uuid REFERENCES platform.source(id),
  unknown    boolean NOT NULL DEFAULT false
);

-- =============================================================================
-- ME · economics
-- =============================================================================

CREATE TABLE me.economics_version (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES platform.tenant(id),
  case_id                uuid NOT NULL REFERENCES platform.workflow_case(id),
  version                integer NOT NULL CHECK (version > 0),
  state                  text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','committed')),
  sizing_version_id      uuid NOT NULL REFERENCES me.sizing_version(id),
  currency               char(3) NOT NULL,
  price_year             integer NOT NULL,
  horizon_years          integer NOT NULL,
  exclusions_text        text NOT NULL,
  calculation_result_id  uuid REFERENCES platform.calculation_result(id),
  row_version            integer NOT NULL DEFAULT 0,
  committed_at           timestamptz,
  committed_by           uuid REFERENCES platform.app_user(id),
  created_by             uuid NOT NULL REFERENCES platform.app_user(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version),
  CHECK (state = 'draft' OR calculation_result_id IS NOT NULL)
);
CREATE UNIQUE INDEX economics_one_draft_idx ON me.economics_version (case_id) WHERE state = 'draft';
CREATE TRIGGER economics_version_guard BEFORE UPDATE OR DELETE ON me.economics_version
  FOR EACH ROW WHEN (OLD.state = 'committed') EXECUTE FUNCTION platform.guard_committed_version();
CREATE TRIGGER economics_version_touch BEFORE UPDATE ON me.economics_version
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE me.economics_driver (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES platform.tenant(id),
  economics_version_id   uuid NOT NULL REFERENCES me.economics_version(id),
  input_key              text NOT NULL CHECK (input_key IN ('annual_price','adoption_rate.downside','adoption_rate.base',
                           'adoption_rate.upside','gross_margin','annual_incremental_opex','capacity',
                           'one_time_investment','reachable_pool')),
  label                  text NOT NULL,
  value                  numeric(24,8) NOT NULL,
  unit                   text NOT NULL,
  time_basis             text CHECK (time_basis IN ('per_year','one_time')),
  assumption_id          uuid REFERENCES platform.assumption(id),
  assumption_version_id  uuid REFERENCES platform.assumption_version(id),
  UNIQUE (economics_version_id, input_key)
);
CREATE TRIGGER economics_driver_guard BEFORE INSERT OR UPDATE OR DELETE ON me.economics_driver
  FOR EACH ROW EXECUTE FUNCTION platform.guard_child_of_committed('me.economics_version', 'economics_version_id');

CREATE TABLE me.model_review (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES platform.tenant(id),
  case_id            uuid NOT NULL REFERENCES platform.workflow_case(id),
  model_type         text NOT NULL CHECK (model_type IN ('economics','sizing')),
  model_version_id   uuid NOT NULL,
  reviewer_user_id   uuid NOT NULL REFERENCES platform.app_user(id),
  requested_by       uuid NOT NULL REFERENCES platform.app_user(id),
  requested_at       timestamptz NOT NULL DEFAULT now(),
  due_on             date,
  checked_items      text[] NOT NULL DEFAULT '{}',
  not_checked_items  text[] NOT NULL DEFAULT '{}',
  position           text CHECK (position IN ('supports','supports_with_conditions','dissents','abstains','not_yet_reviewed')),
  statement          text,
  signed_at          timestamptz
);

-- =============================================================================
-- ME · validation experiments
-- =============================================================================

CREATE TABLE me.experiment (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES platform.tenant(id),
  case_id                   uuid NOT NULL REFERENCES platform.workflow_case(id),
  display_key               text NOT NULL,
  title                     text NOT NULL,
  lifecycle                 text NOT NULL DEFAULT 'draft' CHECK (lifecycle IN ('draft','locked','running','result_recorded','cancelled')),
  owner_user_id             uuid NOT NULL REFERENCES platform.app_user(id),
  fieldwork_owner_user_id   uuid REFERENCES platform.app_user(id),
  locked_by_gate_request_id uuid REFERENCES platform.gate_request(id),
  locked_at                 timestamptz,
  current_plan_version      integer NOT NULL DEFAULT 1,
  illustrative              boolean NOT NULL DEFAULT false,
  row_version               integer NOT NULL DEFAULT 0,
  created_by                uuid NOT NULL REFERENCES platform.app_user(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, display_key),
  CHECK (lifecycle = 'draft' OR lifecycle = 'cancelled' OR locked_at IS NOT NULL)
);
CREATE TRIGGER experiment_touch BEFORE UPDATE ON me.experiment FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE me.experiment_assumption (
  tenant_id      uuid NOT NULL REFERENCES platform.tenant(id),
  experiment_id  uuid NOT NULL REFERENCES me.experiment(id),
  assumption_id  uuid NOT NULL REFERENCES platform.assumption(id),
  PRIMARY KEY (experiment_id, assumption_id)
);

CREATE TABLE me.experiment_plan_version (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(id),
  experiment_id    uuid NOT NULL REFERENCES me.experiment(id),
  version          integer NOT NULL CHECK (version > 0),
  is_original      boolean NOT NULL DEFAULT false, -- the pre-registered plan locked at G1
  hypothesis       text NOT NULL,
  method           text NOT NULL,
  sample_text      text NOT NULL,
  sample_size      integer,
  selection_text   text NOT NULL,
  nonresponse_note text NOT NULL,
  window_start     date NOT NULL,
  window_end       date NOT NULL,
  budget_amount    numeric(18,2),
  currency         char(3),
  budget_note      text,
  decision_rules   jsonb NOT NULL DEFAULT '[]',
  created_by       uuid NOT NULL REFERENCES platform.app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, version),
  CHECK (window_end >= window_start)
);
CREATE UNIQUE INDEX experiment_one_original_idx ON me.experiment_plan_version (experiment_id) WHERE is_original;

-- Draft plan versions may be edited; once the experiment is locked every plan version is frozen.
CREATE FUNCTION me.guard_experiment_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lc text;
BEGIN
  SELECT lifecycle INTO lc FROM me.experiment WHERE id = COALESCE(NEW.experiment_id, OLD.experiment_id);
  IF TG_OP IN ('UPDATE','DELETE') AND lc <> 'draft' THEN
    RAISE EXCEPTION 'experiment plan is locked; create an amendment' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER experiment_plan_guard BEFORE UPDATE OR DELETE ON me.experiment_plan_version
  FOR EACH ROW EXECUTE FUNCTION me.guard_experiment_plan();

CREATE TABLE me.experiment_metric (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES platform.tenant(id),
  plan_version_id   uuid NOT NULL REFERENCES me.experiment_plan_version(id),
  metric_key        text NOT NULL,
  name              text NOT NULL,
  operator          text NOT NULL CHECK (operator IN ('gte','lte','eq','qualitative')),
  threshold_value   numeric(24,8),
  threshold_text    text NOT NULL,
  unit              text NOT NULL,
  UNIQUE (plan_version_id, metric_key),
  CHECK (operator = 'qualitative' OR threshold_value IS NOT NULL)
);

CREATE TABLE me.experiment_amendment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES platform.tenant(id),
  experiment_id       uuid NOT NULL REFERENCES me.experiment(id),
  number              integer NOT NULL CHECK (number > 0),
  from_plan_version   integer NOT NULL,
  to_plan_version     integer NOT NULL,
  reason              text NOT NULL CHECK (char_length(reason) > 0),
  changed_fields      text[] NOT NULL,
  thresholds_changed  boolean NOT NULL,
  after_results_seen  boolean NOT NULL,
  author_id           uuid NOT NULL REFERENCES platform.app_user(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, number),
  CHECK (to_plan_version > from_plan_version)
);
CREATE TRIGGER experiment_amendment_immutable BEFORE UPDATE OR DELETE ON me.experiment_amendment
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE me.experiment_result_version (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  experiment_id   uuid NOT NULL REFERENCES me.experiment(id),
  version         integer NOT NULL CHECK (version > 0),
  observations    jsonb NOT NULL, -- [{metricKey, observed, observedText, result}]
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  source_text     text NOT NULL,
  interpretation  text NOT NULL,
  limitations     text NOT NULL,
  recorded_by     uuid NOT NULL REFERENCES platform.app_user(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, version)
);
CREATE TRIGGER experiment_result_immutable BEFORE UPDATE OR DELETE ON me.experiment_result_version
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE me.experiment_decision (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenant(id),
  experiment_id  uuid NOT NULL REFERENCES me.experiment(id),
  decision_text  text NOT NULL,
  decided_by     uuid NOT NULL REFERENCES platform.app_user(id),
  decided_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER experiment_decision_immutable BEFORE UPDATE OR DELETE ON me.experiment_decision
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

-- =============================================================================
-- ME · pilot, budget, outcomes review
-- =============================================================================

CREATE TABLE me.pilot_plan (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES platform.tenant(id),
  case_id             uuid NOT NULL UNIQUE REFERENCES platform.workflow_case(id),
  gate_request_id     uuid REFERENCES platform.gate_request(id), -- the authorizing G2
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','active','paused','completed')),
  current_version_id  uuid,
  draft_version_id    uuid,
  activated_at        timestamptz,
  activated_by        uuid REFERENCES platform.app_user(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE me.pilot_plan_version (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES platform.tenant(id),
  pilot_plan_id         uuid NOT NULL REFERENCES me.pilot_plan(id),
  version               integer NOT NULL CHECK (version > 0),
  state                 text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','committed')),
  baseline_snapshot_id  uuid REFERENCES platform.decision_snapshot(id),
  budget_ceiling        numeric(18,2) NOT NULL,
  currency              char(3) NOT NULL,
  window_start          date NOT NULL,
  window_end            date NOT NULL,
  scope_text            text NOT NULL,
  thresholds_text       text[] NOT NULL DEFAULT '{}',
  task_set_id           uuid REFERENCES platform.task_set(id),
  row_version           integer NOT NULL DEFAULT 0,
  committed_at          timestamptz,
  created_by            uuid NOT NULL REFERENCES platform.app_user(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pilot_plan_id, version),
  CHECK (window_end >= window_start)
);
CREATE UNIQUE INDEX pilot_plan_one_draft_idx ON me.pilot_plan_version (pilot_plan_id) WHERE state = 'draft';
CREATE TRIGGER pilot_plan_version_guard BEFORE UPDATE OR DELETE ON me.pilot_plan_version
  FOR EACH ROW WHEN (OLD.state = 'committed') EXECUTE FUNCTION platform.guard_committed_version();
CREATE TRIGGER pilot_plan_version_touch BEFORE UPDATE ON me.pilot_plan_version
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE me.pilot_plan
  ADD CONSTRAINT pilot_plan_current_fk FOREIGN KEY (current_version_id) REFERENCES me.pilot_plan_version(id),
  ADD CONSTRAINT pilot_plan_draft_fk FOREIGN KEY (draft_version_id) REFERENCES me.pilot_plan_version(id);

CREATE TABLE me.budget_entry (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenant(id),
  case_id          uuid NOT NULL REFERENCES platform.workflow_case(id),
  gate_request_id  uuid NOT NULL REFERENCES platform.gate_request(id),
  kind             text NOT NULL CHECK (kind IN ('committed','spent')),
  amount           numeric(18,2) NOT NULL CHECK (amount >= 0),
  currency         char(3) NOT NULL,
  as_of            date NOT NULL,
  source_text      text NOT NULL,
  recorded_by      uuid NOT NULL REFERENCES platform.app_user(id),
  recorded_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER budget_entry_immutable BEFORE UPDATE OR DELETE ON me.budget_entry
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE me.scope_change_request (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES platform.tenant(id),
  case_id             uuid NOT NULL REFERENCES platform.workflow_case(id),
  requested_by        uuid NOT NULL REFERENCES platform.app_user(id),
  description         text NOT NULL,
  requested_changes   jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted_to_gate_request','withdrawn')),
  gate_request_id     uuid REFERENCES platform.gate_request(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE me.message_draft (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenant(id),
  case_id     uuid NOT NULL REFERENCES platform.workflow_case(id),
  title       text NOT NULL,
  body        text NOT NULL,
  origin      text NOT NULL CHECK (origin IN ('human','ai','ai_edited')),
  status      text NOT NULL DEFAULT 'draft' CHECK (status = 'draft'), -- MVP never sends
  row_version integer NOT NULL DEFAULT 0,
  created_by  uuid NOT NULL REFERENCES platform.app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER message_draft_touch BEFORE UPDATE ON me.message_draft FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE me.outcome_review (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES platform.tenant(id),
  case_id               uuid NOT NULL REFERENCES platform.workflow_case(id),
  gate_request_id       uuid NOT NULL REFERENCES platform.gate_request(id), -- the gate whose baseline is reviewed
  version               integer NOT NULL DEFAULT 1,
  status                text NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete','ready','decided')),
  what_we_learned       text[] NOT NULL DEFAULT '{}',
  what_changes_next     text[] NOT NULL DEFAULT '{}',
  causal_limitations    text[] NOT NULL DEFAULT '{}',
  recommendation        jsonb, -- {outcome, label, text, by}
  decision_record_id    uuid REFERENCES platform.decision_record(id),
  row_version           integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, gate_request_id, version),
  CHECK (status <> 'decided' OR (decision_record_id IS NOT NULL AND cardinality(causal_limitations) > 0))
);
CREATE TRIGGER outcome_review_touch BEFORE UPDATE ON me.outcome_review FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE platform.decision_record
  ADD CONSTRAINT decision_record_outcome_review_fk FOREIGN KEY (outcome_review_id) REFERENCES me.outcome_review(id)
  DEFERRABLE INITIALLY DEFERRED;

-- =============================================================================
-- SIM · simulated external task tool (behaves like a remote system; no RLS)
-- =============================================================================

CREATE TABLE sim.project_counter (
  connection_id  uuid NOT NULL,
  project        text NOT NULL,
  next_value     integer NOT NULL DEFAULT 1,
  PRIMARY KEY (connection_id, project)
);

CREATE TABLE sim.external_issue (
  connection_id    uuid NOT NULL,
  key              text NOT NULL, -- PIL-11
  project          text NOT NULL,
  title            text NOT NULL,
  assignee         text,
  fields           jsonb NOT NULL DEFAULT '{}',
  idempotency_key  text NOT NULL, -- stored as an issue property, as a real Jira adapter would
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, key),
  UNIQUE (connection_id, idempotency_key)
);

CREATE TABLE sim.fault_rule (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  uuid NOT NULL,
  mode           text NOT NULL CHECK (mode IN ('timeout_after_success','http_5xx','permission_denied','token_expired','rate_limited')),
  match          jsonb NOT NULL DEFAULT '{}',
  remaining      integer NOT NULL DEFAULT 1 CHECK (remaining >= 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sim.call_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection_id  uuid NOT NULL,
  operation      text NOT NULL,
  idempotency_key text,
  outcome        text NOT NULL,
  at             timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Row-level security: tenant isolation on every platform/me table
-- =============================================================================

ALTER TABLE platform.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON platform.tenant
  USING (id = platform.current_tenant_id());

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_schema, c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema IN ('platform', 'me')
       AND c.column_name = 'tenant_id'
       AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.table_schema, t.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', t.table_schema, t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I USING (tenant_id = platform.current_tenant_id()) '
      'WITH CHECK (tenant_id = platform.current_tenant_id())',
      t.table_schema, t.table_name);
  END LOOP;
END $$;

-- Cross-tenant entry points for the worker (timers, outbox polling). SECURITY DEFINER,
-- owned by me_owner, return ids only; the worker then sets app.tenant_id per item.
CREATE FUNCTION platform.list_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = platform, pg_temp AS $$
  SELECT id FROM platform.tenant
$$;

CREATE FUNCTION platform.claim_outbox_batch(batch_size integer, lease interval)
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = platform, pg_temp AS $$
  UPDATE platform.outbox_message m
     SET locked_until = now() + lease
   WHERE m.id IN (
     SELECT o.id FROM platform.outbox_message o
      WHERE o.status IN ('pending','checking')
        AND o.next_attempt_at <= now()
        AND (o.locked_until IS NULL OR o.locked_until < now())
      ORDER BY o.next_attempt_at
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED)
  RETURNING m.id, m.tenant_id
$$;

-- =============================================================================
-- Grants. me_app (API) and me_worker (jobs) are NOBYPASSRLS and do not own objects.
-- =============================================================================

GRANT USAGE ON SCHEMA platform, me TO me_app, me_worker;
GRANT USAGE ON SCHEMA sim TO me_worker, me_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, me TO me_app, me_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sim TO me_worker, me_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA platform, me, sim TO me_app, me_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA platform, me TO me_app, me_worker;

-- Append-only at the privilege level too (triggers also refuse).
REVOKE UPDATE, DELETE ON platform.audit_event, platform.approval, platform.approval_invalidation,
  platform.assumption_version, platform.snapshot_component, platform.dissent, platform.tool_call,
  platform.calculation_result, platform.outcome_observation, platform.outcome_target, platform.decision_record,
  me.feasibility_review, me.experiment_amendment, me.experiment_result_version, me.experiment_decision,
  me.budget_entry, me.comparison_weights_version, me.market_boundary
  FROM me_app, me_worker;
REVOKE DELETE ON platform.decision_snapshot, platform.analytics_event, platform.gate_request,
  platform.workflow_case FROM me_app, me_worker;
-- Only the worker sets analytics emitted_at; the API inserts only.
REVOKE UPDATE ON platform.analytics_event FROM me_app;
-- The API never runs the cross-tenant outbox claim.
REVOKE EXECUTE ON FUNCTION platform.claim_outbox_batch(integer, interval) FROM me_app;
REVOKE EXECUTE ON FUNCTION platform.claim_outbox_batch(integer, interval) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION platform.list_tenant_ids() FROM PUBLIC, me_app;
GRANT EXECUTE ON FUNCTION platform.claim_outbox_batch(integer, interval), platform.list_tenant_ids() TO me_worker;
