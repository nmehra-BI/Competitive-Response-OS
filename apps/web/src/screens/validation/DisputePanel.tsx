/**
 * Dispute thread on an assumption (Validation.dc.html "Dispute · Adoption 20% by year 3"). The
 * reviewer's words are shown as signed dissent, never paraphrased. Only the disputing reviewer
 * or the sponsor can resolve, and only with a reason.
 */
import { API, type Assumption, type Challenge, type PersonRef } from '@growth-os/contracts';
import { Avatar, Button, DissentItem, Icon, IconButton, TextAreaField } from '@growth-os/ui';
import { useEffect, useRef, useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useCommand } from '../../lib/query';
import { dayTime } from '../decisions/dates';

export interface DisputePanelProps {
  assumption: Assumption;
  dispute: Challenge;
  viewer: PersonRef | null;
  sponsor: PersonRef | null;
  onClose: () => void;
  /** Move focus to the thread heading (when the viewer opened it, never on page load). */
  focusOnOpen?: boolean;
}

export function DisputePanel({
  assumption,
  dispute,
  viewer,
  sponsor,
  onClose,
  focusOnOpen,
}: DisputePanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [reply, setReply] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState('');
  const sendReply = useCommand(API.assumptions.replyToChallenge, { onSuccess: () => setReply('') });
  const resolve = useCommand(API.assumptions.resolveChallenge, { onSuccess: () => setResolving(false) });
  useEffect(() => {
    if (focusOnOpen) heading.current?.focus();
  }, [assumption.key, focusOnOpen]);

  const canResolve =
    !!viewer && (viewer.id === dispute.raisedBy.id || (!!sponsor && viewer.id === sponsor.id));
  const open = dispute.status === 'open';
  const affects = assumption.usedBy.map((u) => u.label).join(', ');
  const scope = [
    dispute.proposedValue ? `Proposes ${dispute.proposedValue}` : null,
    affects ? `affects ${affects}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section aria-labelledby="ws8c-dispute-title" className="ws8c-card ws8c-card--accent">
      <div className="ws8c-card__head">
        <span style={{ color: 'var(--warning-fg)', display: 'inline-flex' }} aria-hidden="true">
          <Icon name="message" size={16} />
        </span>
        <h2 id="ws8c-dispute-title" ref={heading} tabIndex={-1} style={{ fontSize: 14 }}>
          Dispute · {assumption.name}
        </h2>
        <span className="ws8c-secondary" style={{ fontSize: 12.5 }}>
          {open
            ? 'Open · stays until resolved with a reason'
            : `Resolved by ${dispute.resolvedBy?.displayName ?? '—'}${dispute.resolvedAt ? ` · ${dayTime(dispute.resolvedAt)}` : ''}`}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <IconButton icon="x" ariaLabel="Close dispute" onClick={onClose} />
        </span>
      </div>
      <div className="ws8c-card__body">
        <DissentItem
          author={dispute.raisedBy.displayName}
          initials={dispute.raisedBy.initials}
          role={dispute.raisedBy.title ?? ''}
          statement={dispute.statement}
          when={dayTime(dispute.createdAt)}
          scope={scope}
        />
        {dispute.replies.map((r) => (
          <div key={r.id} className="ws8c-reply">
            <Avatar initials={r.author.initials} size={24} />
            <div>
              <b style={{ fontWeight: 600 }}>{r.author.displayName}</b>{' '}
              <span className="ws8c-muted ws8c-small">{dayTime(r.createdAt)}</span>
              <p>{r.body}</p>
            </div>
          </div>
        ))}
        {!open && dispute.resolution ? (
          <p style={{ margin: 0, fontSize: 13 }}>
            <b style={{ fontWeight: 600 }}>Resolution:</b> {dispute.resolution}
          </p>
        ) : null}
        {open ? (
          <>
            <TextAreaField label="Reply" value={reply} onChange={setReply} rows={2} />
            {sendReply.error ? <ProblemBanner error={sendReply.error} /> : null}
            {resolving ? (
              <div className="ws8c-form">
                <TextAreaField
                  label="Reason for resolving"
                  required
                  value={resolution}
                  onChange={setResolution}
                  rows={2}
                />
                {resolve.error ? <ProblemBanner error={resolve.error} /> : null}
                <div className="ws8c-row">
                  <Button
                    variant="secondary"
                    tone="dark"
                    disabled={!resolution.trim() || resolve.isPending}
                    disabledReason="Write the reason first."
                    onClick={() =>
                      resolve.mutate({ params: { id: dispute.id }, body: { resolution: resolution.trim() } })
                    }
                  >
                    Resolve dispute
                  </Button>
                  <Button variant="ghost" onClick={() => setResolving(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="ws8c-row" style={{ alignItems: 'flex-start' }}>
              <Button
                variant="secondary"
                tone="dark"
                disabled={!reply.trim() || sendReply.isPending}
                disabledReason={sendReply.isPending ? 'Sending…' : 'Write a reply first.'}
                onClick={() => sendReply.mutate({ params: { id: dispute.id }, body: { body: reply.trim() } })}
              >
                Reply
              </Button>
              {!resolving ? (
                <Button
                  variant="secondary"
                  disabled={!canResolve}
                  disabledReason={`Only ${dispute.raisedBy.displayName} or the sponsor can resolve this dispute.`}
                  onClick={() => setResolving(true)}
                >
                  Resolve with reason
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
