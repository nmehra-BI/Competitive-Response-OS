/**
 * S08 finance review (acceptance step 16, D-097): the case owner asks a named finance reviewer to
 * review a committed economics version; the reviewer signs with what they checked and what they did
 * not check. Signing is the reviewer's act only (the API refuses anyone else).
 */
import { API, REVIEWER_POSITION_LABELS, type ModelReview, type ReviewerPosition } from '@growth-os/contracts';
import { Button } from '@growth-os/ui';
import { useId, useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';

const lines = (t: string) =>
  t
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

export function FinanceReviewRequest({
  caseKey,
  economicsVersion,
  requested,
}: {
  caseKey: string;
  economicsVersion: number | null;
  requested: ModelReview | null;
}) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [reviewerId, setReviewerId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const people = useApiQuery(
    API.directory.people,
    { query: { role: 'finance_reviewer' } },
    { enabled: open, staleTime: 10 * 60_000 },
  );
  const request = useCommand(API.economics.requestFinanceReview, { onSuccess: () => setOpen(false) });
  const already = requested && requested.signedAt === null;
  if (!open)
    return (
      <Button
        variant="secondary"
        icon="send"
        disabled={economicsVersion === null || !!already}
        disabledReason={
          economicsVersion === null
            ? 'Commit a snapshot first'
            : `Finance review requested from ${requested?.reviewer.displayName ?? ''}`
        }
        onClick={() => setOpen(true)}
      >
        Request finance review
      </Button>
    );
  const choices = people.data?.items ?? [];
  const chosen = reviewerId || choices[0]?.id || '';
  return (
    <form
      aria-label="Request finance review"
      className="as-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!chosen || economicsVersion === null) return;
        request.mutate({
          params: { caseRef: caseKey },
          body: { economicsVersion, reviewerId: chosen, dueOn: dueOn || null },
        });
      }}
    >
      <div className="as-form-grid">
        <label className="gos-field" htmlFor={`${ids}-who`}>
          <span>Finance reviewer</span>
          <select
            id={`${ids}-who`}
            className="gos-select"
            value={chosen}
            onChange={(e) => setReviewerId(e.target.value)}
          >
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="gos-field" htmlFor={`${ids}-due`}>
          <span>Due (optional)</span>
          <input
            id={`${ids}-due`}
            className="gos-input"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
          />
        </label>
      </div>
      <div className="as-row">
        <Button
          variant="primary"
          type="submit"
          disabled={!chosen || request.isPending}
          disabledReason={!chosen ? 'No finance reviewer in this business unit' : 'Sending…'}
        >
          {`Request review of snapshot v${economicsVersion ?? ''}`}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {request.error ? <ProblemBanner error={request.error} /> : null}
    </form>
  );
}

const POSITIONS: ReviewerPosition[] = ['supports', 'supports_with_conditions', 'dissents', 'abstains'];

export function FinanceSignForm({ review }: { review: ModelReview }) {
  const ids = useId();
  const [position, setPosition] = useState<ReviewerPosition>('supports_with_conditions');
  const [checked, setChecked] = useState('');
  const [notChecked, setNotChecked] = useState('');
  const [statement, setStatement] = useState('');
  const [touched, setTouched] = useState(false);
  const sign = useCommand(API.economics.signFinanceReview);
  const missing = lines(checked).length === 0;
  return (
    <form
      aria-label="Sign finance review"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (missing) return;
        sign.mutate({
          params: { id: review.id },
          body: {
            position,
            checkedItems: lines(checked),
            notCheckedItems: lines(notChecked),
            statement: statement.trim() || null,
          },
        });
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <label className="gos-field" htmlFor={`${ids}-pos`}>
        <span>Your position</span>
        <select
          id={`${ids}-pos`}
          className="gos-select"
          value={position}
          onChange={(e) => setPosition(e.target.value as ReviewerPosition)}
        >
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {REVIEWER_POSITION_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="gos-field" htmlFor={`${ids}-chk`}>
        <span>Checked (one per line, required)</span>
        <textarea
          id={`${ids}-chk`}
          className="gos-textarea"
          rows={3}
          value={checked}
          aria-invalid={touched && missing ? true : undefined}
          onChange={(e) => setChecked(e.target.value)}
        />
        {touched && missing ? (
          <span className="gos-field__error">List at least one item you checked.</span>
        ) : null}
      </label>
      <label className="gos-field" htmlFor={`${ids}-not`}>
        <span>Not checked (one per line)</span>
        <textarea
          id={`${ids}-not`}
          className="gos-textarea"
          rows={2}
          value={notChecked}
          onChange={(e) => setNotChecked(e.target.value)}
        />
      </label>
      <label className="gos-field" htmlFor={`${ids}-st`}>
        <span>Statement (optional)</span>
        <textarea
          id={`${ids}-st`}
          className="gos-textarea"
          rows={2}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
        />
      </label>
      <div>
        <Button
          variant="primary"
          type="submit"
          disabled={sign.isPending}
          disabledReason={sign.isPending ? 'Signing…' : undefined}
        >
          Sign finance review
        </Button>
      </div>
      {sign.error ? <ProblemBanner error={sign.error} /> : null}
    </form>
  );
}
