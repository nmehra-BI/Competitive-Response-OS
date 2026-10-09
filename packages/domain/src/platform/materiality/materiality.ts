/**
 * Materiality and invalidation (PRD §4, ARCHITECTURE.md §9.3).
 *
 * Every committed change to something a snapshot pins (mandate scope, model versions, assumption
 * versions, sources, sign-off scopes, plan tasks) is classified by the tenant's materiality policy.
 *   material      → current snapshots that pin it become `stale` (approval disabled; "Refresh");
 *                   effective approvals on snapshots that pin it are invalidated (unsent writes pause).
 *   not_material  → nothing changes (comments, formatting, notes).
 *   uncertain     → escalate to the policy owner (sponsor by default); snapshots go stale until resolved,
 *                   approvals are NOT invalidated until classified material ("uncertain cases escalate").
 * Drafts never trigger anything: only commits do.
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
}

export interface SnapshotPin {
  snapshotId: string;
  gateRequestId: string;
  snapshotStatus: 'current' | 'stale' | 'superseded';
  gateStatus: string;
  effectiveApprovalIds: readonly string[];
}

export interface MaterialityOutcome {
  classification: MaterialityClass;
  ruleKey: string;
  staleSnapshotIds: string[];
  invalidateApprovalIds: string[];
  escalate: boolean;
  /** Business copy for the stale banner, e.g. "adoption assumption changed on 26 Nov". */
  reason: string;
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
}

/** TODO(WS3): implement. Unlisted change types classify as `uncertain` (fail safe). */
export function createMaterialityEvaluator(): MaterialityEvaluator {
  return {
    classify: () => {
      throw new Error('TODO(WS3): MaterialityEvaluator.classify');
    },
    evaluate: () => {
      throw new Error('TODO(WS3): MaterialityEvaluator.evaluate');
    },
  };
}
