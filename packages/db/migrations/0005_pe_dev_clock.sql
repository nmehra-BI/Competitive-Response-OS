-- 0005 · End-to-end and release readiness (PE) · decisions.md D-091
-- Additive only: one new tenant-scoped table.

-- Dev clock: a per-tenant forward offset applied to business time (`ctx.now` in the API, the timers and the
-- outbox send-time re-check) so the pilot window and approval expiry can be walked live in a demo or an e2e
-- run. It is honoured only when the server runs with AUTH_MODE=dev (never in production) and only for
-- illustrative tenants; this table refuses rows for any other tenant. Audit timestamps never use it.
CREATE TABLE platform.dev_clock (
  tenant_id   uuid PRIMARY KEY REFERENCES platform.tenant(id),
  offset_ms   bigint NOT NULL CHECK (offset_ms >= 0),
  set_by      uuid NOT NULL REFERENCES platform.app_user(id),
  set_at      timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION platform.guard_dev_clock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.tenant t WHERE t.id = NEW.tenant_id AND t.illustrative) THEN
    RAISE EXCEPTION 'the dev clock is for illustrative tenants only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.offset_ms < OLD.offset_ms THEN
    RAISE EXCEPTION 'the dev clock only moves forward' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dev_clock_guard BEFORE INSERT OR UPDATE ON platform.dev_clock
  FOR EACH ROW EXECUTE FUNCTION platform.guard_dev_clock();

ALTER TABLE platform.dev_clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.dev_clock FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform.dev_clock
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON platform.dev_clock TO me_app;
GRANT SELECT ON platform.dev_clock TO me_worker;
