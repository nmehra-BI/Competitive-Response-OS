import { describe, expect, it } from 'vitest';
import { MaterialChangeType, MaterialityPolicyBody } from '@growth-os/contracts';
import {
  createMaterialityEvaluator,
  DEFAULT_MATERIALITY_POLICY,
  invalidationNotice,
  shortDay,
  staleBanner,
  type ChangeDescriptor,
  type SnapshotPin,
} from './materiality';

const ev = createMaterialityEvaluator();
const policy = MaterialityPolicyBody.parse(DEFAULT_MATERIALITY_POLICY);

const change = (over: Partial<ChangeDescriptor> = {}): ChangeDescriptor => ({
  caseId: 'case-104',
  changeType: 'decision_critical_assumption_changed',
  objectType: 'assumption',
  objectId: 'asm-01',
  fromVersion: 2,
  toVersion: 3,
  decisionCritical: true,
  label: 'adoption assumption',
  at: '2026-11-26T12:00:00+01:00',
  ...over,
});

const awaitingV3: SnapshotPin = {
  snapshotId: 'snap-v3',
  gateRequestId: 'g2',
  snapshotStatus: 'current',
  gateStatus: 'awaiting_decision',
  effectiveApprovalIds: [],
};
const approvedV4: SnapshotPin = {
  snapshotId: 'snap-v4',
  gateRequestId: 'g2',
  snapshotStatus: 'current',
  gateStatus: 'approved_with_conditions',
  effectiveApprovalIds: ['appr-1'],
};
const supersededV2: SnapshotPin = {
  snapshotId: 'snap-v2',
  gateRequestId: 'g2',
  snapshotStatus: 'superseded',
  gateStatus: 'awaiting_decision',
  effectiveApprovalIds: [],
};

describe('classify (default policy, ARCHITECTURE §9.3)', () => {
  const expected: Record<MaterialChangeType, string> = {
    geography_changed: 'material',
    product_changed: 'material',
    segment_changed: 'material',
    spend_ceiling_changed: 'material',
    decision_critical_assumption_changed: 'material',
    model_version_changed: 'material',
    source_superseded_or_deleted: 'uncertain',
    specialist_scope_changed: 'material',
    plan_tasks_changed: 'material',
    plan_destination_changed: 'material',
    comment_or_formatting: 'not_material',
    other: 'uncertain',
  };
  for (const t of MaterialChangeType.options) {
    it(`${t} → ${expected[t]}`, () => {
      expect(ev.classify(change({ changeType: t }), policy).classification).toBe(expected[t]);
    });
  }

  it('unlisted change types are uncertain (fail safe)', () => {
    expect(
      ev.classify(change({ changeType: 'geography_changed' }), { rules: [], escalateTo: 'sponsor' }),
    ).toEqual({
      classification: 'uncertain',
      ruleKey: 'unlisted:geography_changed',
    });
  });

  it('a non-critical assumption value change is uncertain, not material', () => {
    expect(ev.classify(change({ decisionCritical: false }), policy)).toEqual({
      classification: 'uncertain',
      ruleKey: 'assumption_not_decision_critical',
    });
  });
});

describe('evaluate: stale vs invalidated (D-013)', () => {
  it('material before decision: v3 becomes stale with the business reason (step 19)', () => {
    const o = ev.evaluate(change(), policy, [supersededV2, awaitingV3]);
    expect(o).toMatchObject({
      classification: 'material',
      staleSnapshotIds: ['snap-v3'],
      invalidateApprovalIds: [],
      escalate: false,
      reason: 'adoption assumption changed on 26 Nov',
      gateCommands: [{ gateRequestId: 'g2', command: 'mark_stale' }],
      impacts: [{ snapshotId: 'snap-v3', effect: 'snapshot_stale' }],
      pauseUnsentWrites: false,
    });
    expect(staleBanner(o.reason).title).toBe(
      'This snapshot is out of date: adoption assumption changed on 26 Nov. Approval is disabled.',
    );
  });

  it('material after approval: the approval is invalidated and unsent writes pause (WF-06)', () => {
    const o = ev.evaluate(change({ changeType: 'spend_ceiling_changed', label: undefined }), policy, [
      approvedV4,
    ]);
    expect(o).toMatchObject({
      classification: 'material',
      staleSnapshotIds: [],
      invalidateApprovalIds: ['appr-1'],
      gateCommands: [{ gateRequestId: 'g2', command: 'invalidate' }],
      impacts: [{ snapshotId: 'snap-v4', effect: 'approval_invalidated' }],
      pauseUnsentWrites: true,
      reasonShort: 'spend ceiling changed',
    });
    expect(invalidationNotice(4, o.reasonShort, true)).toBe(
      'Approval for v4 no longer applies: spend ceiling changed. Pilot tasks paused.',
    );
  });

  it('uncertain: snapshots go stale, approvals are escalated but NOT invalidated', () => {
    const o = ev.evaluate(
      change({ changeType: 'source_superseded_or_deleted', label: 'source SRC-014' }),
      policy,
      [awaitingV3, { ...approvedV4, gateRequestId: 'g1', snapshotId: 'snap-g1' }],
    );
    expect(o).toMatchObject({
      classification: 'uncertain',
      escalate: true,
      escalateTo: 'sponsor',
      staleSnapshotIds: ['snap-v3'],
      invalidateApprovalIds: [],
      escalatedApprovalIds: ['appr-1'],
      pauseUnsentWrites: false,
    });
    expect(o.impacts).toContainEqual({ snapshotId: 'snap-g1', effect: 'escalated' });
  });

  it('uncertain escalates to the investment committee when the policy says so', () => {
    const o = ev.evaluate(
      change({ changeType: 'other' }),
      { ...policy, escalateTo: 'investment_committee' },
      [awaitingV3],
    );
    expect(o.escalateTo).toBe('investment_committee');
  });

  it('resolving an escalation as material invalidates; as not material changes nothing', () => {
    const c = change({ changeType: 'source_superseded_or_deleted' });
    expect(ev.resolveEscalation('material', c, [approvedV4])).toMatchObject({
      invalidateApprovalIds: ['appr-1'],
      pauseUnsentWrites: true,
      gateCommands: [{ gateRequestId: 'g2', command: 'invalidate' }],
    });
    expect(ev.resolveEscalation('not_material', c, [approvedV4])).toMatchObject({
      invalidateApprovalIds: [],
      gateCommands: [],
    });
  });

  it('not material: comments change nothing', () => {
    const o = ev.evaluate(change({ changeType: 'comment_or_formatting' }), policy, [awaitingV3, approvedV4]);
    expect(o).toMatchObject({
      staleSnapshotIds: [],
      invalidateApprovalIds: [],
      gateCommands: [],
      escalate: false,
    });
  });

  it('drafts never trigger anything', () => {
    const o = ev.evaluate(change({ committed: false }), policy, [awaitingV3, approvedV4]);
    expect(o).toMatchObject({ ruleKey: 'draft_ignored', staleSnapshotIds: [], invalidateApprovalIds: [] });
  });

  it('superseded and already-stale snapshots are not marked again; decided-not-approved gates are untouched', () => {
    const o = ev.evaluate(change(), policy, [
      supersededV2,
      { ...awaitingV3, snapshotStatus: 'stale', gateStatus: 'stale' },
      { ...approvedV4, gateStatus: 'not_approved', effectiveApprovalIds: [] },
      { ...approvedV4, gateStatus: 'invalidated' },
    ]);
    expect(o).toMatchObject({ staleSnapshotIds: [], invalidateApprovalIds: [], gateCommands: [] });
  });
});

describe('shortDay', () => {
  it('formats the written local date', () => {
    expect(shortDay('2026-11-26T00:30:00+01:00')).toBe('26 Nov');
    expect(shortDay('2026-10-05')).toBe('5 Oct');
    expect(shortDay(undefined)).toBeNull();
  });
});
