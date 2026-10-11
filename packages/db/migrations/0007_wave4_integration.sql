-- 0007 · Wave 4 integration (PE) · decisions.md D-147, D-148
-- Additive only: one nullable column and one guard trigger. No existing column, constraint, trigger or policy is
-- changed or dropped.

-- =============================================================================
-- 1. The S08 opex scope note gets its own column (CR-W4-E1-2, D-147). Wave 4 E1 stored it after a marker in
--    `exclusions_text`; the API now writes this column and still reads the marker for drafts saved before 0007.
--    Committed versions stay immutable through the existing whole-row guard (`guard_committed_version`).
-- =============================================================================
ALTER TABLE me.economics_version ADD COLUMN opex_scope_note text
  CHECK (opex_scope_note IS NULL OR char_length(opex_scope_note) BETWEEN 1 AND 500);

-- =============================================================================
-- 2. A committee approval names a seat its approver holds (CR-E3-1, D-148). The API assigns the seat from
--    `committee_member`; the database now refuses a forged seat: the approver must hold a live seat of that kind
--    in the gate request's business unit on the decision date (tenant-local, the same rule as the API).
--    An AFTER trigger, so a second decision in one seat still meets `approval_one_per_seat_idx` first.
-- =============================================================================
CREATE FUNCTION platform.guard_approval_committee_seat() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  decided_on date;
BEGIN
  IF NEW.committee_seat IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT (NEW.decided_at AT TIME ZONE t.time_zone)::date INTO decided_on
    FROM platform.tenant t WHERE t.id = NEW.tenant_id;
  IF NOT EXISTS (
    SELECT 1
      FROM platform.committee_member m
      JOIN platform.gate_request g ON g.id = NEW.gate_request_id
     WHERE m.tenant_id = NEW.tenant_id
       AND m.user_id = NEW.approver_user_id
       AND m.seat = NEW.committee_seat
       AND m.business_unit_id = g.business_unit_id
       AND (m.revoked_at IS NULL OR m.revoked_at > NEW.decided_at)
       AND m.valid_from <= decided_on
       AND (m.valid_to IS NULL OR m.valid_to >= decided_on)
  ) THEN
    RAISE EXCEPTION 'COMMITTEE_SEAT_NOT_HELD: approver % holds no live % seat in this business unit',
      NEW.approver_user_id, NEW.committee_seat
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER approval_committee_seat_guard AFTER INSERT ON platform.approval
  FOR EACH ROW EXECUTE FUNCTION platform.guard_approval_committee_seat();
GRANT EXECUTE ON FUNCTION platform.guard_approval_committee_seat() TO me_app, me_worker;
