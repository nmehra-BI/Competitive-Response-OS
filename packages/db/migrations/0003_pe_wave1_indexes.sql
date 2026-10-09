-- 0003 · Wave 1 integration (PE) · decisions.md D-038
-- Index-only and additive (D-031: new migrations that only add indexes are outside the freeze).
-- They back the queries the integrated seams now run on every material change and expiry sweep.

-- Materiality (applyMateriality) and approval expiry (timers.approval_expiry) find outbox rows by the
-- gate request that authorized them: authorization_ref->>'gateRequestId'.
CREATE INDEX outbox_message_gate_ref_idx
  ON platform.outbox_message (tenant_id, (authorization_ref->>'gateRequestId'));

-- Approval expiry scans approved gate requests whose expiry has passed.
CREATE INDEX gate_request_expiry_idx
  ON platform.gate_request (tenant_id, expires_at)
  WHERE status IN ('approved', 'approved_with_conditions') AND expires_at IS NOT NULL;

-- Effective-approval lookups by snapshot (findPins) and the cases.members endpoint (D-037).
CREATE INDEX approval_snapshot_idx ON platform.approval (snapshot_id);
CREATE INDEX case_participant_user_idx ON platform.case_participant (tenant_id, user_id);
