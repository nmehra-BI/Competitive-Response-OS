-- 0008 · First-run onboarding: per-user guide state · decisions.md D-190 onward (CR-ONB-1)
-- Additive only: one new tenant-scoped table, its guard and RLS. No existing object changes.

-- One row per person per tenant: welcome seen, explainer watched or skipped, guide skipped, the "visit" steps the
-- person completed and the coach marks they dismissed. Checklist steps that complete from workspace state are
-- derived at read time and never stored here. A preference row, not business state: it is updated in place (the
-- change itself is audited in platform.audit_event) and may be deleted by the demo-only reset.
CREATE TABLE platform.user_onboarding (
  tenant_id              uuid NOT NULL REFERENCES platform.tenant(id),
  user_id                uuid NOT NULL REFERENCES platform.app_user(id),
  welcome_seen_at        timestamptz,
  explainer_status       text NOT NULL DEFAULT 'not_started'
                           CHECK (explainer_status IN ('not_started', 'completed', 'skipped')),
  explainer_updated_at   timestamptz,
  guide_dismissed        boolean NOT NULL DEFAULT false,
  visited_steps          text[] NOT NULL DEFAULT '{}',
  coach_marks_dismissed  text[] NOT NULL DEFAULT '{}',
  row_version            integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CHECK (cardinality(visited_steps) <= 64 AND cardinality(coach_marks_dismissed) <= 64)
);

-- People only (never-rule 1: agent and service identities are refused by the API and by the database), and the
-- person must belong to the row's tenant.
CREATE FUNCTION platform.guard_user_onboarding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  principal_kind text;
  principal_tenant uuid;
BEGIN
  SELECT kind, tenant_id INTO principal_kind, principal_tenant FROM platform.app_user WHERE id = NEW.user_id;
  IF principal_kind IS DISTINCT FROM 'human' THEN
    RAISE EXCEPTION 'onboarding state is for people only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF principal_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'onboarding state must belong to the person''s tenant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id <> OLD.user_id OR NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'onboarding state cannot move to another person' USING ERRCODE = 'check_violation';
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_onboarding_guard BEFORE INSERT OR UPDATE ON platform.user_onboarding
  FOR EACH ROW EXECUTE FUNCTION platform.guard_user_onboarding();

ALTER TABLE platform.user_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.user_onboarding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform.user_onboarding
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.user_onboarding TO me_app;
