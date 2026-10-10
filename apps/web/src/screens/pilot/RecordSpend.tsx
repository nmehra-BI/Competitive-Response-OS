/**
 * S11 "Record spend" under the budget meter (D-114 §2, D-133). Kind (Committed · Spent), amount (one-time,
 * in the approved budget's currency), date, description, PO or invoice reference and an optional task.
 * Entries are append-only: a correction is "Reverse" with a reason, and the meter subtracts it. Spend
 * above the remaining approved amount is refused by the API with "Request scope change"; the screen
 * offers that action instead of letting anyone exceed the approval. One-time pilot money is never shown
 * next to a per-year figure.
 */
import {
  API,
  BUDGET_ENTRY_KIND_LABELS,
  type BudgetEntry,
  type BudgetEntryKind,
  type PilotPlanView,
  type Task,
} from '@growth-os/contracts';
import { Button, DataTable, formatExact, TextAreaField, type DataTableColumn } from '@growth-os/ui';
import { useId, useState } from 'react';
import { Modal } from '../../app/shell/Modal';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { ApiProblem } from '../../lib/api-client';
import { useCommand } from '../../lib/query';
import { fmtDate } from '../history/dates';
import { isPositiveAmount, parseAmount } from './money';

const KINDS: BudgetEntryKind[] = ['committed', 'spent'];

/** The refusal above the remaining approved amount (blocker `budget_ceiling`). */
export function isCeilingRefusal(e: unknown): boolean {
  return (
    e instanceof ApiProblem &&
    e.problem.code === 'PRECONDITIONS_UNMET' &&
    !!e.problem.blockers?.some((b) => b.key === 'budget_ceiling')
  );
}

export function RecordSpend({
  v,
  canRecord,
  caseRef,
  today,
  onScopeChange,
  onDone,
}: {
  v: PilotPlanView;
  canRecord: boolean;
  caseRef: string;
  today: string;
  onScopeChange: () => void;
  onDone: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reversing, setReversing] = useState<BudgetEntry | null>(null);
  const b = v.budget;
  if (!b) return null;
  const entries = v.budgetEntries ?? [];
  const tasks = v.taskSet?.tasks ?? [];
  const currency = b.approved.currency;
  const reason = 'Only the case owner or the pilot owner records spend.';
  return (
    <section className="ws8d-section" aria-labelledby="pilot-spend">
      <div className="ws8d-row" style={{ justifyContent: 'space-between' }}>
        <h2 id="pilot-spend">Spend entries · one-time · {currency}</h2>
        <Button
          variant="secondary"
          icon="plus"
          disabled={!canRecord || open}
          disabledReason={!canRecord ? reason : undefined}
          onClick={() => setOpen(true)}
        >
          Record spend
        </Button>
      </div>
      <p className="ws8d-muted" style={{ margin: 0 }}>
        Entries are never edited or deleted. Correct one by reversing it with a reason.
      </p>
      {open ? (
        <SpendForm
          gateRequestId={b.gateRequestId}
          currency={currency}
          caseRef={caseRef}
          tasks={tasks}
          today={today}
          onScopeChange={onScopeChange}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      ) : null}
      {entries.length ? (
        <EntryTable
          entries={entries}
          tasks={tasks}
          canRecord={canRecord}
          disabledReason={reason}
          onReverse={setReversing}
        />
      ) : (
        <p className="ws8d-note" style={{ margin: 0 }}>
          No spend recorded yet.
        </p>
      )}
      {reversing ? (
        <ReverseDialog entry={reversing} onClose={() => setReversing(null)} onDone={onDone} />
      ) : null}
    </section>
  );
}

function EntryTable({
  entries,
  tasks,
  canRecord,
  disabledReason,
  onReverse,
}: {
  entries: BudgetEntry[];
  tasks: Task[];
  canRecord: boolean;
  disabledReason: string;
  onReverse: (e: BudgetEntry) => void;
}) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const taskLabel = (id: string | null | undefined) => {
    const t = id ? tasks.find((x) => x.id === id) : undefined;
    return t ? `Task ${t.ordinal} · ${t.title}` : '—';
  };
  const columns: DataTableColumn<BudgetEntry>[] = [
    { key: 'date', header: 'Date', cell: (e) => <span className="ws8d-note">{fmtDate(e.asOf)}</span> },
    { key: 'kind', header: 'Kind', cell: (e) => BUDGET_ENTRY_KIND_LABELS[e.kind] },
    {
      key: 'amount',
      header: 'Amount',
      cell: (e) =>
        e.reversesEntryId ? (
          <span>
            {`− ${formatExact(e.amount, e.currency)}`}
            <span className="gos-sr-only"> (reversal)</span>
          </span>
        ) : (
          <span style={e.reversedByEntryId ? { textDecoration: 'line-through' } : undefined}>
            {formatExact(e.amount, e.currency)}
          </span>
        ),
    },
    {
      key: 'what',
      header: 'Description',
      cell: (e) => (
        <div>
          <div style={{ fontSize: 13 }}>{e.sourceText}</div>
          {e.reversesEntryId ? (
            <div className="ws8d-sub">
              Reversal of the {fmtDate(byId.get(e.reversesEntryId)?.asOf ?? e.asOf)} entry ·{' '}
              {e.reversalReason}
            </div>
          ) : e.reversedByEntryId ? (
            <div className="ws8d-sub">Reversed</div>
          ) : null}
        </div>
      ),
    },
    { key: 'ref', header: 'Reference', cell: (e) => <span className="ws8d-note">{e.reference ?? '—'}</span> },
    { key: 'task', header: 'Task', cell: (e) => <span className="ws8d-note">{taskLabel(e.taskId)}</span> },
    {
      key: 'by',
      header: 'Recorded by',
      cell: (e) => <span className="ws8d-note">{e.recordedBy.displayName}</span>,
    },
    {
      key: 'act',
      header: 'Correction',
      cell: (e) =>
        e.reversesEntryId || e.reversedByEntryId ? (
          <span className="ws8d-note">—</span>
        ) : (
          <Button
            variant="ghost"
            icon="returnarrow"
            disabled={!canRecord}
            disabledReason={disabledReason}
            ariaLabel={`Reverse ${BUDGET_ENTRY_KIND_LABELS[e.kind].toLowerCase()} ${formatExact(e.amount, e.currency)} · ${e.sourceText}`}
            onClick={() => onReverse(e)}
          >
            Reverse
          </Button>
        ),
    },
  ];
  return (
    <div className="gos-card" style={{ overflow: 'hidden' }}>
      <DataTable
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        ariaLabel="Spend entries"
        minWidth={880}
      />
    </div>
  );
}

function SpendForm({
  gateRequestId,
  currency,
  caseRef,
  tasks,
  today,
  onScopeChange,
  onClose,
  onDone,
}: {
  gateRequestId: string;
  currency: string;
  caseRef: string;
  tasks: Task[];
  today: string;
  onScopeChange: () => void;
  onClose: () => void;
  onDone: (note: string) => void;
}) {
  const ids = useId();
  const [kind, setKind] = useState<BudgetEntryKind>('spent');
  const [amountText, setAmountText] = useState('');
  const [asOf, setAsOf] = useState(today);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [taskId, setTaskId] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.budget.recordEntry);
  const amount = parseAmount(amountText);
  const amountError =
    amountText.trim() && !isPositiveAmount(amount) ? 'Enter an amount such as 8000 or 8000.50.' : undefined;
  const missing = [
    !isPositiveAmount(amount) && 'amount',
    !asOf && 'date',
    !description.trim() && 'description',
  ].filter(Boolean) as string[];
  const submit = async () => {
    if (missing.length || !amount) return;
    setErr(null);
    try {
      const e = await cmd.mutateAsync({
        params: { caseRef },
        body: {
          gateRequestId,
          kind,
          amount,
          currency,
          asOf,
          sourceText: description.trim(),
          reference: reference.trim() || null,
          taskId: taskId || null,
        },
      });
      onDone(`${BUDGET_ENTRY_KIND_LABELS[e.kind]} ${formatExact(e.amount, e.currency)} recorded.`);
      onClose();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <form
      className="ws8d-form ws8d-section ws8d-section--dashed"
      aria-labelledby={`${ids}-t`}
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit();
      }}
    >
      <h3 id={`${ids}-t`}>Record spend</h3>
      <fieldset>
        <legend>Kind</legend>
        <div className="ws8d-row">
          {KINDS.map((k) => (
            <label key={k} className="ws8d-check">
              <input type="radio" name={`${ids}-kind`} checked={kind === k} onChange={() => setKind(k)} />
              {BUDGET_ENTRY_KIND_LABELS[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="ws8d-grid" style={{ gap: 12 }}>
        <label className="gos-field" htmlFor={`${ids}-amount`}>
          <span>
            Amount ({currency}, one-time) <span className="gos-field__hint">(required)</span>
          </span>
          <input
            id={`${ids}-amount`}
            className="gos-input"
            inputMode="decimal"
            value={amountText}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? `${ids}-amount-err` : undefined}
            onChange={(e) => setAmountText(e.target.value)}
          />
          {amountError ? (
            <span id={`${ids}-amount-err`} className="gos-field__error">
              {amountError}
            </span>
          ) : null}
        </label>
        <label className="gos-field" htmlFor={`${ids}-date`}>
          <span>
            Date <span className="gos-field__hint">(required)</span>
          </span>
          <input
            id={`${ids}-date`}
            className="gos-input"
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <label className="gos-field" htmlFor={`${ids}-ref`}>
          <span>
            Reference <span className="gos-field__hint">(PO or invoice number)</span>
          </span>
          <input
            id={`${ids}-ref`}
            className="gos-input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label className="gos-field" htmlFor={`${ids}-task`}>
          <span>
            Task <span className="gos-field__hint">(optional)</span>
          </span>
          <select
            id={`${ids}-task`}
            className="gos-input"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
          >
            <option value="">No task</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {`Task ${t.ordinal} · ${t.title}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <TextAreaField label="Description" required value={description} onChange={setDescription} rows={2} />
      {err ? (
        <ProblemBanner
          error={err}
          actions={
            isCeilingRefusal(err) ? (
              <Button variant="secondary" icon="pencil" onClick={onScopeChange}>
                Request scope change
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <div className="ws8d-row">
        <Button
          variant="primary"
          type="submit"
          disabled={missing.length > 0 || cmd.isPending}
          disabledReason={cmd.isPending ? 'Saving…' : `Still needed: ${missing.join(', ')}.`}
        >
          {`Record ${BUDGET_ENTRY_KIND_LABELS[kind].toLowerCase()}`}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReverseDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: BudgetEntry;
  onClose: () => void;
  onDone: (note: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.budget.reverseEntry);
  const label = `Reverse ${BUDGET_ENTRY_KIND_LABELS[entry.kind].toLowerCase()} ${formatExact(entry.amount, entry.currency)}`;
  const submit = async () => {
    setErr(null);
    try {
      await cmd.mutateAsync({ params: { id: entry.id }, body: { reason: reason.trim() } });
      onDone(`Reversed · ${formatExact(entry.amount, entry.currency)} no longer counts against the budget.`);
      onClose();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <Modal label={label} onClose={onClose}>
      <div className="ws8d-dialog">
        <h2>{label}</h2>
        <p className="ws8d-note" style={{ margin: 0 }}>
          {entry.sourceText}
          {entry.reference ? ` · ${entry.reference}` : ''} · {fmtDate(entry.asOf)}. The entry stays in the
          record; a reversing entry with your reason is added.
        </p>
        <TextAreaField label="Reason" required value={reason} onChange={setReason} rows={2} />
        {err ? <ProblemBanner error={err} /> : null}
        <div className="ws8d-row">
          <Button
            variant="primary"
            disabled={!reason.trim() || cmd.isPending}
            disabledReason={!reason.trim() ? 'A reason is required.' : 'Saving…'}
            onClick={submit}
          >
            Reverse entry
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
