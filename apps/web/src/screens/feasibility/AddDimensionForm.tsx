/**
 * S07 "Add dimension / Request review" (D-112 §4): a dimension from the fixed list, a named human reviewer
 * (a member of the case), a due date, the question and the scope of review. The reviewer is asked in
 * their Reviews inbox and only they can sign. AI never answers a review; a specialist review is always
 * human-only.
 */
import {
  API,
  FEASIBILITY_DIMENSION_LABELS,
  FeasibilityDimension,
  type PersonRef,
} from '@growth-os/contracts';
import { Button, OwnerPicker, TextAreaField } from '@growth-os/ui';
import { useId, useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useCommand } from '../../lib/query';

export function AddDimensionForm({
  caseKey,
  existing,
  people,
  onClose,
  onDone,
}: {
  caseKey: string;
  existing: readonly FeasibilityDimension[];
  people: PersonRef[];
  onClose: () => void;
  onDone: (note: string) => void;
}) {
  const ids = useId();
  const open = FeasibilityDimension.options.filter((d) => !existing.includes(d));
  const [dimension, setDimension] = useState<FeasibilityDimension | ''>(open[0] ?? '');
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [dueOn, setDueOn] = useState('');
  const [question, setQuestion] = useState('');
  const [detail, setDetail] = useState('');
  const [scope, setScope] = useState('');
  const cmd = useCommand(API.feasibility.addDimension);
  const specialist = dimension === 'specialist_review';
  const missing = [
    !dimension && 'dimension',
    !reviewerId && 'named reviewer',
    !question.trim() && 'question',
    !scope.trim() && 'scope of review',
  ].filter(Boolean) as string[];
  const submit = async () => {
    if (missing.length || !dimension || !reviewerId) return;
    try {
      await cmd.mutateAsync({
        params: { caseRef: caseKey },
        body: {
          dimension,
          reviewerId,
          dueOn: dueOn || null,
          question: question.trim(),
          questionDetail: detail.trim() || null,
          scopeText: scope.trim(),
          humanOnly: specialist,
        },
      });
      const who = people.find((p) => p.id === reviewerId)?.displayName ?? 'The reviewer';
      onDone(`${FEASIBILITY_DIMENSION_LABELS[dimension]} added · ${who} is asked to review.`);
      onClose();
    } catch {
      /* shown below */
    }
  };
  return (
    <form
      className="as-inline-form"
      aria-labelledby={`${ids}-t`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div id={`${ids}-t`} style={{ fontSize: 14, fontWeight: 600 }}>
        Add dimension · request review
      </div>
      <label className="gos-field" htmlFor={`${ids}-dim`}>
        <span>Dimension</span>
        <select
          id={`${ids}-dim`}
          className="gos-input"
          value={dimension}
          onChange={(e) => setDimension(e.target.value as FeasibilityDimension)}
        >
          {open.map((d) => (
            <option key={d} value={d}>
              {FEASIBILITY_DIMENSION_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
      <OwnerPicker
        label="Named reviewer"
        required
        value={reviewerId}
        onChange={setReviewerId}
        options={people}
        hint="A person on this case. Only they can sign; a review is never answered by AI."
      />
      <TextAreaField label="Question" required value={question} onChange={setQuestion} rows={2} />
      <TextAreaField
        label="Question in full"
        hint="optional · what exactly to check"
        value={detail}
        onChange={setDetail}
        rows={3}
      />
      <TextAreaField label="Scope of review" required value={scope} onChange={setScope} rows={2} />
      <label className="gos-field" htmlFor={`${ids}-due`}>
        <span>
          Due date <span className="gos-field__hint">(optional)</span>
        </span>
        <input
          id={`${ids}-due`}
          className="gos-input"
          type="date"
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
        />
      </label>
      {specialist ? <p className="as-note">AI cannot provide this review: a specialist answers it.</p> : null}
      {cmd.error ? <ProblemBanner error={cmd.error} /> : null}
      <div className="as-row">
        <Button
          variant="primary"
          type="submit"
          disabled={missing.length > 0 || cmd.isPending}
          disabledReason={cmd.isPending ? 'Saving…' : `Still needed: ${missing.join(', ')}.`}
        >
          Request review
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
