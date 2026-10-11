/**
 * Change an assumption's value (S09, acceptance step 19, D-100): a new immutable version with a
 * reason. The server runs the materiality check; a decision-critical change makes an open snapshot
 * stale or invalidates an approval it affects. Rates are entered as percentages.
 */
import { API, type Assumption } from '@growth-os/contracts';
import { Button } from '@growth-os/ui';
import Decimal from 'decimal.js';
import { useId, useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useCommand } from '../../lib/query';

function toText(a: Assumption): string {
  const v = a.current.value;
  if (v === null) return '';
  return a.current.unit === 'rate' ? new Decimal(v).times(100).toString() : v;
}

function toValue(a: Assumption, text: string): string | null {
  const t = text.replace(/[\s,%]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const d = new Decimal(t);
  return a.current.unit === 'rate' ? d.dividedBy(100).toString() : d.toString();
}

export function ChangeValueForm({ assumption: a, onDone }: { assumption: Assumption; onDone: () => void }) {
  const ids = useId();
  const [text, setText] = useState(toText(a));
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const update = useCommand(API.assumptions.update, { onSuccess: onDone });
  const value = toValue(a, text);
  const invalid = touched && (value === null || !reason.trim());
  return (
    <form
      aria-label={`Change value · ${a.name}`}
      className="ws8c-stack"
      style={{ gap: 6, marginTop: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (value === null || !reason.trim()) return;
        update.mutate({
          params: { id: a.id },
          ifMatch: a.rowVersion,
          body: { value, changeReason: reason.trim() },
        });
      }}
    >
      <label htmlFor={`${ids}-v`} className="ws8c-small">
        {`New value${a.current.unit === 'rate' ? ' (%)' : ''}`}
      </label>
      <input
        id={`${ids}-v`}
        className="gos-input"
        inputMode="decimal"
        value={text}
        aria-invalid={touched && value === null ? true : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      <label htmlFor={`${ids}-r`} className="ws8c-small">
        Reason (required)
      </label>
      <input
        id={`${ids}-r`}
        className="gos-input"
        value={reason}
        aria-invalid={touched && !reason.trim() ? true : undefined}
        onChange={(e) => setReason(e.target.value)}
      />
      {invalid ? (
        <span className="gos-field__error">Enter a number and the reason for the change.</span>
      ) : null}
      <div className="ws8c-row">
        <Button
          variant="primary"
          type="submit"
          disabled={update.isPending}
          disabledReason={update.isPending ? 'Saving…' : undefined}
        >
          Save new version
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {update.error ? <ProblemBanner error={update.error} /> : null}
    </form>
  );
}
