/**
 * Elena's approval panel on S10 (Decisions.dc.html): scoped "Approve pilot €120k · 90 days",
 * Return for revision / Not approved / Abstain, rationale required, Authorizes / Does not
 * authorize boxes. The decision is bound to the snapshot this page rendered (id + hash); a stale
 * or superseded version disables approval with the reason. Policy copy comes from the server.
 */
import {
  API,
  GATE_REQUEST_STATUS_LABELS,
  GATE_STATUS_LABELS,
  type ConditionInput,
  type DecisionPackageView,
  type PersonRef,
} from '@growth-os/contracts';
import { ApprovalPanelView, Button, TextAreaField } from '@growth-os/ui';
import { useState, type ReactNode } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useCommand } from '../../lib/query';
import { dayTime, fullDate } from './dates';
import { GATE_KIND, peopleIn } from './PackageArticle';

const APPROVE = new Set(['approve', 'approve_with_conditions']);

export function statusText(pkg: DecisionPackageView): string {
  const req = pkg.gateRequest;
  const status = req.displayStatus;
  const decided = pkg.approvals.find((a) => a.disposition !== 'abstain');
  const when = decided ? ` · ${dayTime(decided.decidedAt)}` : '';
  // GateStatus has no "withdrawn"; the request status carries it (label map added by D-068).
  if (req.status === 'withdrawn') return GATE_REQUEST_STATUS_LABELS.withdrawn;
  if (status === 'approved_with_conditions') {
    const n = req.conditions.length;
    return `${GATE_STATUS_LABELS[status]} · ${n} condition${n === 1 ? '' : 's'}${when}`;
  }
  if (status === 'invalidated') {
    const inv = pkg.approvals.find((a) => a.invalidation)?.invalidation;
    return `${GATE_STATUS_LABELS[status]}${inv ? ` · ${dayTime(inv.at)}` : ''}`;
  }
  if (status === 'expired')
    return `${GATE_STATUS_LABELS[status]} unused · ${req.expiresAt ? fullDate(req.expiresAt) : ''}`;
  if (status === 'awaiting_decision') return GATE_STATUS_LABELS[status];
  return `${GATE_STATUS_LABELS[status]}${when}`;
}

/** Note shown once the request is decided, invalidated, expired or withdrawn. */
export function decidedNote(pkg: DecisionPackageView): string | null {
  const req = pkg.gateRequest;
  const v = pkg.snapshot.version;
  if (req.status === 'withdrawn') return `v${v} was withdrawn by its author. Nothing can be decided on it.`;
  // Only decisions on the snapshot on screen count (an earlier version's decision is history).
  const onSnapshot = pkg.approvals.filter((x) => x.snapshotId === pkg.snapshot.id);
  const a = onSnapshot.find((x) => x.disposition !== 'abstain') ?? onSnapshot[0];
  if (!a) return null;
  // WS3 runtime next-action copy for approvals that stopped authorizing anything.
  if (req.status === 'expired') return 'The approval expired unused. Prepare a new request.';
  if (a.invalidation || req.status === 'invalidated')
    return 'The approval no longer applies. Prepare a new request.';
  if (APPROVE.has(a.disposition)) {
    const owner = req.scope.ownerId ? peopleIn(pkg).get(req.scope.ownerId)?.displayName : null;
    return req.gateCode === 'G2'
      ? `${GATE_KIND[req.gateCode]} approved for v${v} only. Conditions marked “Blocks execution until met” must be met before ${owner ?? 'the pilot owner'} activates the plan. Material changes invalidate this approval.`
      : `${GATE_KIND[req.gateCode]} approved for v${v} only. Spend above the approved budget needs a new authorization. Material changes invalidate this approval.`;
  }
  if (a.disposition === 'abstain')
    return 'Abstention recorded. The decision routes to the next approver under policy.';
  return `Decision recorded with ${a.approver.displayName}’s rationale. ${req.submittedBy?.displayName ?? 'The author'} is notified.`;
}

/** Why the designated approver cannot approve the version on screen (never a silent disable). */
export function snapshotBlockReason(pkg: DecisionPackageView): string | null {
  const s = pkg.snapshot;
  if (s.status === 'stale')
    return `Approval disabled: snapshot v${s.version} is out of date. Refresh to create v${s.version + 1}.`;
  if (s.status === 'superseded')
    return `v${s.version} is superseded and cannot be approved. Open the current version.`;
  return null;
}

export function DecisionPanel({
  pkg,
  viewer,
  caseKey,
}: {
  pkg: DecisionPackageView;
  viewer: PersonRef | null;
  caseKey: string;
}) {
  const req = pkg.gateRequest;
  const s = pkg.snapshot;
  const decide = useCommand(API.gates.decide);
  const withdraw = useCommand(API.gates.withdraw);
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState('');
  const isApprover = pkg.panel.chain.some((c) => c.isViewer);
  const note = decidedNote(pkg);
  const block = !note && isApprover ? snapshotBlockReason(pkg) : null;
  const proposed: ConditionInput[] = req.conditions
    .filter((c) => req.submittedBy && c.addedBy.id === req.submittedBy.id)
    .map((c) => ({ text: c.text, ownerId: c.owner.id, dueOn: c.dueOn, dueRule: c.dueRule, flag: c.flag }));
  const isAuthor = !!viewer && !!req.submittedBy && viewer.id === req.submittedBy.id;
  const canWithdraw = isAuthor && !note && (req.status === 'awaiting_decision' || req.status === 'stale');

  let secondary: ReactNode = null;
  let lockBody: ReactNode = null;
  if (note && req.gateCode === 'G2' && req.displayStatus.startsWith('approved')) {
    secondary = (
      <div>
        <Button variant="secondary" icon="arrowr" href={`/me/cases/${encodeURIComponent(caseKey)}/pilot`}>
          Open pilot plan
        </Button>
      </div>
    );
  } else if (!note && !pkg.panel.canDecide && !isApprover && viewer) {
    const approver = pkg.panel.chain.find((c) => c.state === 'waiting')?.approver.displayName;
    lockBody = (
      <>
        Viewing as {viewer.displayName}.
        {approver ? ` Only ${approver} can decide ${req.gateCode} v${s.version}.` : ''}
        {canWithdraw ? ' You can comment or withdraw the package.' : ''}
      </>
    );
    secondary = canWithdraw ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        {!withdrawing ? (
          <div>
            <Button variant="secondary" onClick={() => setWithdrawing(true)}>
              {`Withdraw v${s.version}`}
            </Button>
          </div>
        ) : null}
        {withdrawing ? (
          <form
            className="ws8c-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim())
                withdraw.mutate({ params: { id: req.id }, body: { rationale: reason.trim() } });
            }}
          >
            <TextAreaField
              label="Reason for withdrawing"
              required
              value={reason}
              onChange={setReason}
              rows={2}
            />
            {withdraw.error ? <ProblemBanner error={withdraw.error} /> : null}
            <div className="ws8c-row">
              <Button
                variant="secondary"
                tone="dark"
                type="submit"
                disabled={!reason.trim() || withdraw.isPending}
                disabledReason="Give the reason first."
              >
                {`Withdraw v${s.version}`}
              </Button>
              <Button variant="ghost" onClick={() => setWithdrawing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    ) : null;
  }

  return (
    <ApprovalPanelView
      gateCode={req.gateCode}
      status={req.displayStatus}
      statusText={statusText(pkg)}
      snapshotVersion={s.version}
      fingerprint={s.fingerprint}
      expiresText={req.expiresAt ? `If unused by ${fullDate(req.expiresAt)}` : null}
      buttonLabel={req.buttonLabel}
      authorizes={req.scope.authorizes}
      doesNotAuthorize={req.scope.doesNotAuthorize}
      panel={pkg.panel}
      disabledReason={block}
      people={[...peopleIn(pkg).values()]}
      busy={decide.isPending}
      error={decide.error ? <ProblemBanner error={decide.error} /> : null}
      decidedNote={note}
      secondaryAction={secondary}
      lockBody={lockBody}
      onDecide={(sub) => {
        // Approving a package approves the conditions it proposes, verbatim, plus any added now.
        const approving = APPROVE.has(sub.disposition);
        const conditions = approving ? [...proposed, ...sub.conditions] : [];
        decide.mutate({
          params: { id: req.id },
          body: {
            snapshotId: s.id,
            snapshotHash: s.contentHash,
            disposition: approving
              ? conditions.length
                ? 'approve_with_conditions'
                : 'approve'
              : sub.disposition,
            rationale: sub.rationale,
            note: sub.note,
            conditions,
            delegateToUserId: null,
          },
        });
      }}
    />
  );
}
