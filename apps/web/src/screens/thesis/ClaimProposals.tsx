/**
 * S05 AI claim proposals (D-116, D-131). A proposal is never a fact. "Accept as fact" is offered only
 * when the server says so (`oneStepAccept.available`: an unedited claim whose every citation opens for
 * the viewer); a confirm dialog shows the claim, its kind and its citations, and one human act accepts
 * the proposal and the claim. Otherwise "Add as draft" is the only acceptance: the claim lands as an
 * AI draft in Claims and is accepted there in a second step (never-rule 11).
 */
import { API, EPISTEMIC_KIND_LABELS, type Proposal } from '@growth-os/contracts';
import { AiBadge, Banner, Button, KindTag, SectionHeader } from '@growth-os/ui';
import { useState } from 'react';
import { Modal } from '../../app/shell/Modal';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';

type ClaimProposal = Proposal & { payload: Extract<Proposal['payload'], { type: 'claim' }> };

const isClaim = (p: Proposal): p is ClaimProposal => p.payload.type === 'claim';

function citationText(n: number): string {
  if (n === 0) return 'No citation';
  return n === 1 ? '1 citation' : `${n} citations`;
}

function AcceptAsFactDialog({
  p,
  onClose,
  onDone,
}: {
  p: ClaimProposal;
  onClose: () => void;
  onDone: () => void;
}) {
  const accept = useCommand(API.analysis.decideProposal, { onSuccess: onDone });
  const claim = p.payload.claim;
  return (
    <Modal label="Accept as fact" onClose={onClose}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
        <SectionHeader
          title="Accept as fact"
          subtitle="One act: the proposal is accepted and the claim becomes a fact on this case."
        />
        <blockquote className="as-serif" style={{ margin: 0 }}>
          {claim.statement}
        </blockquote>
        <dl className="as-dl">
          <dt>Kind</dt>
          <dd>
            <KindTag kind={claim.kind} />
          </dd>
          <dt>Citations</dt>
          <dd>
            {citationText(claim.evidenceIds.length)} · each opens for you
            <ul className="as-list" aria-label="Citations" style={{ marginTop: 4 }}>
              {claim.evidenceIds.map((id, i) => (
                <li key={id} className="as-muted" style={{ fontSize: 12.5 }}>
                  {`Cited passage ${i + 1}`}
                </li>
              ))}
            </ul>
          </dd>
        </dl>
        <p className="as-muted" style={{ margin: 0, fontSize: 12.5 }}>
          {`Accepted as ${EPISTEMIC_KIND_LABELS[claim.kind].toLowerCase()}, unedited, with its citations. To change the wording, add it as a draft instead.`}
        </p>
        {accept.error ? <ProblemBanner error={accept.error} /> : null}
        <div className="as-row">
          <Button
            variant="primary"
            onClick={() =>
              accept.mutate({
                params: { id: p.id },
                body: { decision: 'accept', reason: null, acceptAsFact: true },
              })
            }
            disabled={accept.isPending}
            disabledReason="Saving…"
          >
            Accept as fact
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ProposalItem({ p, canDecide }: { p: ClaimProposal; canDecide: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const draft = useCommand(API.analysis.decideProposal, {
    onSuccess: () => setDone('Added as an AI draft claim. Accept it in Claims when you have checked it.'),
  });
  const reject = useCommand(API.analysis.decideProposal, { onSuccess: () => setDone('Rejected.') });
  const claim = p.payload.claim;
  const one = p.oneStepAccept;
  const busy = draft.isPending || reject.isPending;
  return (
    <li className="as-claim" data-proposal={p.id}>
      <p className="as-serif">{claim.statement}</p>
      <div className="as-row">
        <KindTag kind={claim.kind} />
        <AiBadge variant="draft" />
        <span className="as-muted" style={{ fontSize: 12.5 }}>
          {citationText(claim.evidenceIds.length)}
        </span>
        {canDecide && !done ? (
          <span className="as-claim__actions">
            {one?.available ? (
              <Button variant="secondary" onClick={() => setConfirming(true)}>
                Accept as fact
              </Button>
            ) : null}
            <Button
              variant={one?.available ? 'ghost' : 'secondary'}
              disabled={busy}
              disabledReason="Saving…"
              onClick={() =>
                draft.mutate({ params: { id: p.id }, body: { decision: 'accept', reason: null } })
              }
            >
              Add as draft
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              disabledReason="Saving…"
              onClick={() =>
                reject.mutate({ params: { id: p.id }, body: { decision: 'reject', reason: null } })
              }
            >
              Reject
            </Button>
          </span>
        ) : null}
      </div>
      {canDecide && !done && one && !one.available && one.reason ? (
        <p className="as-muted" style={{ margin: 0, fontSize: 12.5 }}>
          {one.reason}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="as-muted" style={{ margin: 0, fontSize: 12.5 }}>
          {done}
        </p>
      ) : null}
      {(draft.error ?? reject.error) ? <ProblemBanner error={draft.error ?? reject.error} /> : null}
      {confirming ? (
        <AcceptAsFactDialog
          p={p}
          onClose={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false);
            setDone('Accepted as fact.');
          }}
        />
      ) : null}
    </li>
  );
}

/** Pending AI claim proposals for the case; nothing renders when there are none. */
export function ClaimProposals({ caseKey, canDecide }: { caseKey: string; canDecide: boolean }) {
  const q = useApiQuery(API.analysis.proposals, { params: { caseRef: caseKey } });
  const items = (q.data?.items ?? []).filter(isClaim).filter((p) => p.status === 'proposed');
  if (q.error) return <ProblemBanner error={q.error} />;
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="ap" className="as-section">
      <SectionHeader
        id="ap"
        title="AI claim proposals"
        subtitle="Not facts until a person accepts them. Uncited evidence stays Unknown."
      />
      {!canDecide ? (
        <Banner tone="neutral" live={false} title="The case owner decides these proposals." />
      ) : null}
      <ul className="as-list as-claims" aria-label="AI claim proposals">
        {items.map((p) => (
          <ProposalItem key={p.id} p={p} canDecide={canDecide} />
        ))}
      </ul>
    </section>
  );
}
