-- 0004 · Wave 3 integration (PE) · decisions.md D-077, D-078
-- Additive only: one column with a default, one new tenant-scoped table, no change to existing rows.

-- Tenant-local calendar (D-068 §10): stale reasons, authority "as of" dates, the pilot-window end and the
-- approval-expiry reason read the tenant's IANA zone instead of a constant. Existing tenants keep
-- Europe/Berlin, the zone every earlier stage assumed.
ALTER TABLE platform.tenant ADD COLUMN time_zone text NOT NULL DEFAULT 'Europe/Berlin'
  CHECK (time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$');

-- "Changes since v3, which you viewed on 24 Nov" (DecisionPackageView.changesSince, D-068 §9): the last
-- snapshot version each person opened per gate request. A read receipt, not business state: it is
-- never audited, never part of a snapshot and never shown to anyone but the viewer.
CREATE TABLE platform.gate_request_view (
  tenant_id         uuid NOT NULL REFERENCES platform.tenant(id),
  gate_request_id   uuid NOT NULL REFERENCES platform.gate_request(id),
  user_id           uuid NOT NULL REFERENCES platform.app_user(id),
  snapshot_version  integer NOT NULL CHECK (snapshot_version > 0),
  viewed_at         timestamptz NOT NULL,
  PRIMARY KEY (gate_request_id, user_id)
);
CREATE INDEX gate_request_view_tenant_idx ON platform.gate_request_view (tenant_id, user_id);

ALTER TABLE platform.gate_request_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.gate_request_view FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform.gate_request_view
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON platform.gate_request_view TO me_app;
GRANT SELECT ON platform.gate_request_view TO me_worker;
