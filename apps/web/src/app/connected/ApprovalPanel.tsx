/**
 * Connected approval panel (frozen ApprovalPanelProps). The decision is bound to the snapshot the
 * approver read: `snapshotId` + `snapshotHash` come from the page that rendered the package. If
 * the current package differs (stale, superseded or refreshed), approval is disabled with a
 * reason — never approve something different from what was read (never-rule 2).
 */
import { API, GATE_STATUS_LABELS, type DecisionPackageView, type PersonRef } from '@growth-os/contracts';
import { ApprovalPanelView, Skeleton, type ApprovalPanelProps } from '@growth-os/ui';
import { useApiQuery, useCommand } from '../../lib/query';
import { usePeople } from '../../lib/people';
import { ProblemBanner } from '../shell/ProblemBanner';

function people(pkg: DecisionPackageView, directory: PersonRef[]): PersonRef[] {
  const all = [
    ...directory,
    ...pkg.positions.map((p) => p.reviewer),
    ...pkg.gateRequest.conditions.map((c) => c.owner),
    ...pkg.panel.chain.map((c) => c.approver),
    pkg.snapshot.createdBy,
  ];
  return [...new Map(all.map((p) => [p.id, p])).values()];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The "decided" note. Only an effective approval on the snapshot on screen counts: after a return
 * for revision and a resubmission, the earlier version's decision must not hide the actions.
 */
export function decidedNoteFor(pkg: DecisionPackageView): string | null {
  const a = pkg.approvals.find((x) => x.effective && x.snapshotId === pkg.snapshot.id);
  if (!a) return null;
  const v = pkg.snapshot.version;
  if (a.disposition === 'approve' || a.disposition === 'approve_with_conditions') {
    return `Approved for v${v} only. Conditions marked “Blocks execution until met” must be met before execution. Material changes invalidate this approval.`;
  }
  if (a.disposition === 'abstain')
    return 'Your abstention is recorded. The decision routes to the next approver under policy.';
  return 'Decision recorded with your rationale. The author is notified.';
}

export function ApprovalPanel({ gateRequestId, snapshotId, snapshotHash }: ApprovalPanelProps) {
  const pkg = useApiQuery(API.gates.package, { params: { id: gateRequestId }, query: {} });
  const decide = useCommand(API.gates.decide);
  // Condition owners: anyone in the tenant directory who can own work, plus the package's people.
  const directory = usePeople();
  if (pkg.isPending) return <Skeleton height={420} />;
  if (pkg.error || !pkg.data) return <ProblemBanner error={pkg.error} />;
  const d = pkg.data;
  const s = d.snapshot;
  const mismatch = s.id !== snapshotId || s.contentHash !== snapshotHash;
  const disabledReason =
    s.status === 'stale'
      ? `Approval disabled: snapshot v${s.version} is out of date. Refresh to create v${s.version + 1}.`
      : s.status === 'superseded' || mismatch
        ? 'The package changed since you opened it. Reload and read the current version before deciding.'
        : null;
  const conditionsCount = d.gateRequest.conditions.length;
  const status = d.gateRequest.displayStatus;
  const statusText =
    status === 'approved_with_conditions'
      ? `${GATE_STATUS_LABELS[status]} · ${conditionsCount} condition${conditionsCount === 1 ? '' : 's'}`
      : GATE_STATUS_LABELS[status];
  return (
    <ApprovalPanelView
      gateCode={d.gateRequest.gateCode}
      status={status}
      statusText={statusText}
      snapshotVersion={s.version}
      fingerprint={s.fingerprint}
      expiresText={
        // Shown with the approval (acceptance step 20): an unused approval expires on this date.
        d.gateRequest.expiresAt && (status === 'approved' || status === 'approved_with_conditions')
          ? `If unused by ${formatDate(d.gateRequest.expiresAt)}`
          : null
      }
      buttonLabel={d.gateRequest.buttonLabel}
      authorizes={d.gateRequest.scope.authorizes}
      doesNotAuthorize={d.gateRequest.scope.doesNotAuthorize}
      panel={d.panel}
      disabledReason={d.panel.canDecide ? disabledReason : null}
      people={people(d, directory.people)}
      busy={decide.isPending}
      error={decide.error ? <ProblemBanner error={decide.error} /> : null}
      decidedNote={decidedNoteFor(d)}
      onDecide={(sub) =>
        decide.mutate({
          params: { id: gateRequestId },
          body: {
            snapshotId,
            snapshotHash,
            disposition: sub.disposition,
            rationale: sub.rationale,
            note: sub.note,
            conditions: sub.conditions,
            delegateToUserId: null,
          },
        })
      }
    />
  );
}
