/**
 * Materiality and invalidation (PRD §4, ARCHITECTURE.md §9.3, D-013).
 *
 * Every committed change to something a snapshot pins (mandate scope, model versions, assumption
 * versions, sources, sign-off scopes, plan tasks) is classified by the tenant's materiality policy.
 *   material      → current snapshots awaiting a decision that pin it become `stale` (approval disabled;
 *                   "Refresh"); effective approvals on snapshots that pin it are invalidated (unsent
 *                   writes pause).
 *   not_material  → nothing changes (comments, formatting, notes).
 *   uncertain     → escalate to the policy owner (sponsor by default); snapshots go stale until resolved,
 *                   approvals are NOT invalidated until classified material ("uncertain cases escalate").
 * Drafts never trigger anything: only commits do. Unlisted change types are `uncertain` (fail safe).
 */
import type { MaterialChangeType, MaterialityClass, MaterialityPolicyBody } from '@growth-os/contracts';

export interface ChangeDescriptor {
  caseId: string;
  changeType: MaterialChangeType;
  objectType: string; // e.g. 'assumption', 'sizing_version', 'source', 'feasibility_review', 'pilot_plan_version'
  objectId: string;
  fromVersion: number | null;
  toVersion: number | null;
  /** For assumptions: only decision-critical assumptions are material by default. */
  decisionCritical?: boolean;
  /** false for draft edits: drafts never trigger materiality. Defaults to true (a commit). */
  committed?: boolean;
  /** Business name of what changed, e.g. "adoption assumption". Defaults by change type. */
  label?: string;
  /** When the change was committed (ISO date-time with offset); used in the stale reason. */
  at?: string;
}

export interface SnapshotPin {
  snapshotId: string;
  gateRequestId: string;
  snapshotStatus: 'current' | 'stale' | 'superseded';
  gateStatus: string;
  effectiveApprovalIds: readonly string[];
}

export type MaterialityEffect = 'snapshot_stale' | 'approval_invalidated' | 'escalated';

export interface MaterialityOutcome {
  classification: MaterialityClass;
  ruleKey: string;
  staleSnapshotIds: string[];
  invalidateApprovalIds: string[];
  escalate: boolean;
  /** Business copy for the stale banner, e.g. "adoption assumption changed on 26 Nov". */
  reason: string;
  /** Same without the date, e.g. "spend ceiling changed" (invalidation notice). */
  reasonShort: string;
  /** Approvals left in force pending the escalation (uncertain only). */
  escalatedApprovalIds: string[];
  /** Who resolves an uncertain change. */
  escalateTo: 'sponsor' | 'investment_committee' | null;
  /** Gate request commands to apply (gate request machine, system actor). */
  gateCommands: { gateRequestId: string; command: 'mark_stale' | 'invalidate' }[];
  /** Rows for platform.material_change_impact. */
  impacts: { snapshotId: string; effect: MaterialityEffect }[];
  /** Pause unsent outbox rows and external task links for the invalidated approvals. */
  pauseUnsentWrites: boolean;
}

export interface MaterialityEvaluator {
  classify(
    change: ChangeDescriptor,
    policy: MaterialityPolicyBody,
  ): { classification: MaterialityClass; ruleKey: string };
  /** Pure: given the classification and the snapshots that pin the changed object, decide effects. */
  evaluate(
    change: ChangeDescriptor,
    policy: MaterialityPolicyBody,
    pins: readonly SnapshotPin[],
  ): MaterialityOutcome;
  /** The policy owner classified an escalated (uncertain) change. Only `material` invalidates. */
  resolveEscalation(
    resolved: Exclude<MaterialityClass, 'uncertain'>,
    change: ChangeDescriptor,
    pins: readonly SnapshotPin[],
  ): MaterialityOutcome;
}

/** Default policy (ARCHITECTURE §9.3). Tenants version their own; this mirrors the fixture. */
export const DEFAULT_MATERIALITY_POLICY: MaterialityPolicyBody = {
  rules: [
    { changeType: 'geography_changed', classification: 'material' },
    { changeType: 'product_changed', classification: 'material' },
    { changeType: 'segment_changed', classification: 'material' },
    { changeType: 'spend_ceiling_changed', classification: 'material' },
    { changeType: 'decision_critical_assumption_changed', classification: 'material' },
    { changeType: 'model_version_changed', classification: 'material' },
    { changeType: 'source_superseded_or_deleted', classification: 'uncertain' },
    { changeType: 'specialist_scope_changed', classification: 'material' },
    { changeType: 'plan_tasks_changed', classification: 'material' },
    { changeType: 'plan_destination_changed', classification: 'material' },
    { changeType: 'comment_or_formatting', classification: 'not_material' },
  ],
  escalateTo: 'sponsor',
};

const CHANGE_LABELS: Readonly<Record<MaterialChangeType, string>> = {
  geography_changed: 'geography',
  product_changed: 'product',
  segment_changed: 'segment',
  spend_ceiling_changed: 'spend ceiling',
  decision_critical_assumption_changed: 'assumption',
  model_version_changed: 'model version',
  source_superseded_or_deleted: 'source',
  specialist_scope_changed: 'specialist sign-off scope',
  plan_tasks_changed: 'pilot plan tasks',
  plan_destination_changed: 'task destination',
  comment_or_formatting: 'comment',
  other: 'an input',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-26T12:00:00+01:00" → "26 Nov" (the local date as written; no clock, no time zone maths). */
export function shortDay(iso: string | undefined): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : null;
}

export function changeReason(change: ChangeDescriptor): { reason: string; reasonShort: string } {
  const what = change.label ?? CHANGE_LABELS[change.changeType];
  const reasonShort = `${what} changed`;
  const day = shortDay(change.at);
  return { reasonShort, reason: day ? `${reasonShort} on ${day}` : reasonShort };
}

/** Stale banner copy (API.md §3 example). */
export function staleBanner(reason: string): { title: string; body: string } {
  return {
    title: `This snapshot is out of date: ${reason}. Approval is disabled.`,
    body: 'Refresh the snapshot to create a new version from the current committed inputs.',
  };
}

/** Invalidation notice, e.g. "Approval for v4 no longer applies: spend ceiling changed. Pilot tasks paused." */
export function invalidationNotice(
  snapshotVersion: number,
  reasonShort: string,
  tasksPaused: boolean,
): string {
  return `Approval for v${snapshotVersion} no longer applies: ${reasonShort}.${tasksPaused ? ' Pilot tasks paused.' : ''}`;
}

const APPROVED = new Set(['approved', 'approved_with_conditions']);

function emptyOutcome(
  classification: MaterialityClass,
  ruleKey: string,
  change: ChangeDescriptor,
): MaterialityOutcome {
  return {
    classification,
    ruleKey,
    staleSnapshotIds: [],
    invalidateApprovalIds: [],
    escalate: false,
    escalatedApprovalIds: [],
    escalateTo: null,
    gateCommands: [],
    impacts: [],
    pauseUnsentWrites: false,
    ...changeReason(change),
  };
}

function classify(change: ChangeDescriptor, policy: MaterialityPolicyBody) {
  const rule = policy.rules.find((r) => r.changeType === change.changeType);
  if (!rule) return { classification: 'uncertain' as const, ruleKey: `unlisted:${change.changeType}` };
  if (
    change.changeType === 'decision_critical_assumption_changed' &&
    change.decisionCritical === false &&
    rule.classification === 'material'
  ) {
    // Non-critical assumption values are uncertain: escalate rather than invalidate (§9.3).
    return { classification: 'uncertain' as const, ruleKey: 'assumption_not_decision_critical' };
  }
  return { classification: rule.classification, ruleKey: `rule:${change.changeType}` };
}

function applyEffects(
  out: MaterialityOutcome,
  pins: readonly SnapshotPin[],
  mode: 'material' | 'uncertain',
): MaterialityOutcome {
  const seenGate = new Set<string>();
  for (const p of pins) {
    if (p.snapshotStatus === 'superseded') continue;
    if (p.snapshotStatus === 'current' && p.gateStatus === 'awaiting_decision') {
      out.staleSnapshotIds.push(p.snapshotId);
      out.impacts.push({ snapshotId: p.snapshotId, effect: 'snapshot_stale' });
      if (mode === 'uncertain') out.impacts.push({ snapshotId: p.snapshotId, effect: 'escalated' });
      if (!seenGate.has(p.gateRequestId)) {
        seenGate.add(p.gateRequestId);
        out.gateCommands.push({ gateRequestId: p.gateRequestId, command: 'mark_stale' });
      }
    } else if (APPROVED.has(p.gateStatus) && p.effectiveApprovalIds.length > 0) {
      if (mode === 'material') {
        out.invalidateApprovalIds.push(...p.effectiveApprovalIds);
        out.impacts.push({ snapshotId: p.snapshotId, effect: 'approval_invalidated' });
        out.pauseUnsentWrites = true;
        if (!seenGate.has(p.gateRequestId)) {
          seenGate.add(p.gateRequestId);
          out.gateCommands.push({ gateRequestId: p.gateRequestId, command: 'invalidate' });
        }
      } else {
        out.escalatedApprovalIds.push(...p.effectiveApprovalIds);
        out.impacts.push({ snapshotId: p.snapshotId, effect: 'escalated' });
      }
    }
  }
  return out;
}

export function createMaterialityEvaluator(): MaterialityEvaluator {
  return {
    classify,
    evaluate(change, policy, pins) {
      const { classification, ruleKey } = classify(change, policy);
      if (change.committed === false) return emptyOutcome(classification, 'draft_ignored', change);
      const out = emptyOutcome(classification, ruleKey, change);
      if (classification === 'not_material') return out;
      if (classification === 'uncertain') {
        out.escalate = true;
        out.escalateTo = policy.escalateTo ?? 'sponsor';
        return applyEffects(out, pins, 'uncertain');
      }
      return applyEffects(out, pins, 'material');
    },
    resolveEscalation(resolved, change, pins) {
      const out = emptyOutcome(resolved, `resolved:${resolved}`, change);
      if (resolved === 'not_material') return out;
      // Snapshots are already stale from the escalation; only approvals change now.
      const approvedPins = pins.filter((p) => APPROVED.has(p.gateStatus));
      return applyEffects(out, approvedPins, 'material');
    },
  };
}
