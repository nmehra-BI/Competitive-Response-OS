/**
 * S11 "Pilot plan editor" (D-112 §5): milestones (name, window, date, evidence expected) and tasks
 * (title, milestone, function, owner, dependencies, due date, deliverable, optional one-time budget
 * line) of the plan draft. Saves with If-Match; a newer save elsewhere shows "Changed elsewhere". The
 * approved budget, sites and dates are not edited here: they change only by a scope-change request.
 */
import { API, TaskFunction, type PersonRef, type PilotPlanView } from '@growth-os/contracts';
import { Button, formatBudget } from '@growth-os/ui';
import { useId, useState, type ReactNode } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useCommand } from '../../lib/query';
import {
  FUNCTION_LABEL,
  newMilestone,
  newTask,
  patchFrom,
  problemsOf,
  rowsFrom,
  type MilestoneRow,
  type PlanRows,
  type TaskRow,
} from './planDraft';

function Input({
  label,
  value,
  onChange,
  type = 'text',
  error,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date';
  error?: string;
  inputMode?: 'decimal' | 'numeric';
}) {
  const id = useId();
  return (
    <label className="gos-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        className="gos-input"
        type={type}
        value={value}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <span id={`${id}-err`} className="gos-field__error">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <label className="gos-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} className="gos-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

export function PlanEditor({
  v,
  caseRef,
  people,
  onClose,
  onDone,
}: {
  v: PilotPlanView;
  caseRef: string;
  people: PersonRef[];
  onClose: () => void;
  onDone: (note: string) => void;
}) {
  const ids = useId();
  const [rows, setRows] = useState<PlanRows>(() => rowsFrom(v));
  const [err, setErr] = useState<unknown>(null);
  const [tried, setTried] = useState(false);
  const save = useCommand(API.pilot.saveDraft);
  const draft = v.draft!;
  const problems = problemsOf(rows);
  const errorOf = (field: string) => (tried ? problems.find((p) => p.field === field)?.message : undefined);

  const setM = (i: number, patch: Partial<MilestoneRow>) =>
    setRows((r) => ({ ...r, milestones: r.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const setT = (i: number, patch: Partial<TaskRow>) =>
    setRows((r) => ({ ...r, tasks: r.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const removeMilestone = (i: number) =>
    setRows((r) => ({
      milestones: r.milestones.filter((_, j) => j !== i),
      // Tasks keep pointing at the same milestone rows; the removed one leaves its tasks unassigned.
      tasks: r.tasks.map((t) => ({
        ...t,
        milestone: t.milestone === i + 1 ? 0 : t.milestone > i + 1 ? t.milestone - 1 : t.milestone,
      })),
    }));

  const submit = async () => {
    setTried(true);
    if (problems.length) return;
    setErr(null);
    try {
      await save.mutateAsync({
        params: { caseRef },
        ifMatch: draft.rowVersion,
        body: patchFrom(rows, draft.currency),
      });
      onDone(`Plan draft v${draft.version} saved.`);
      onClose();
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <form
      className="ws8d-section ws8d-section--accent ws8d-form"
      aria-labelledby={`${ids}-t`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="ws8d-row" style={{ justifyContent: 'space-between' }}>
        <h2 id={`${ids}-t`}>Edit plan draft v{draft.version}</h2>
        <span className="ws8d-sub">
          Approved ceiling {formatBudget(draft.budgetCeiling, draft.currency)} · budget, sites and dates
          change only by a scope-change request
        </span>
      </div>

      <fieldset>
        <legend>Milestones</legend>
        <div className="ws8d-form" style={{ gap: 10 }}>
          {rows.milestones.map((m, i) => (
            <div
              key={m.key}
              className="ws8d-section ws8d-section--dashed"
              role="group"
              aria-label={`Milestone ${i + 1}`}
            >
              <div className="ws8d-grid" style={{ gap: 10 }}>
                <Input
                  label={`Milestone ${i + 1} name`}
                  value={m.name}
                  onChange={(x) => setM(i, { name: x })}
                  error={errorOf(`m${i}.name`)}
                />
                <Input
                  label={`Milestone ${i + 1} window`}
                  value={m.windowText}
                  onChange={(x) => setM(i, { windowText: x })}
                />
                <Input
                  label={`Milestone ${i + 1} date`}
                  type="date"
                  value={m.dueOn}
                  onChange={(x) => setM(i, { dueOn: x })}
                />
                <Input
                  label={`Milestone ${i + 1} evidence expected`}
                  value={m.evidenceExpected}
                  onChange={(x) => setM(i, { evidenceExpected: x })}
                />
              </div>
              <div>
                <Button
                  variant="ghost"
                  icon="trash"
                  onClick={() => removeMilestone(i)}
                  ariaLabel={`Remove milestone ${i + 1}`}
                >
                  Remove milestone
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              icon="plus"
              onClick={() =>
                setRows((r) => ({
                  ...r,
                  milestones: [...r.milestones, newMilestone(r.milestones.length + 1)],
                }))
              }
            >
              Add milestone
            </Button>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Tasks</legend>
        <div className="ws8d-form" style={{ gap: 10 }}>
          {rows.tasks.map((t, i) => (
            <div
              key={t.key}
              className="ws8d-section ws8d-section--dashed"
              role="group"
              aria-label={`Task ${i + 1}`}
            >
              <div className="ws8d-grid" style={{ gap: 10 }}>
                <Input
                  label={`Task ${i + 1} title`}
                  value={t.title}
                  onChange={(x) => setT(i, { title: x })}
                  error={errorOf(`t${i}.title`)}
                />
                <Select
                  label={`Task ${i + 1} milestone`}
                  value={String(t.milestone)}
                  onChange={(x) => setT(i, { milestone: Number(x) })}
                >
                  <option value="0">No milestone</option>
                  {rows.milestones.map((m, j) => (
                    <option key={m.key} value={String(j + 1)}>
                      {m.name.trim() || `Milestone ${j + 1}`}
                    </option>
                  ))}
                </Select>
                <Select
                  label={`Task ${i + 1} function`}
                  value={t.fn}
                  onChange={(x) => setT(i, { fn: x as TaskRow['fn'] })}
                >
                  {TaskFunction.options.map((f) => (
                    <option key={f} value={f}>
                      {FUNCTION_LABEL[f]}
                    </option>
                  ))}
                </Select>
                <Select
                  label={`Task ${i + 1} owner`}
                  value={t.ownerId}
                  onChange={(x) => setT(i, { ownerId: x })}
                >
                  <option value="">Unassigned</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
                <Input
                  label={`Task ${i + 1} depends on (task numbers)`}
                  value={t.dependsOn}
                  onChange={(x) => setT(i, { dependsOn: x })}
                  error={errorOf(`t${i}.dependsOn`)}
                />
                <Input
                  label={`Task ${i + 1} due date`}
                  type="date"
                  value={t.dueOn}
                  onChange={(x) => setT(i, { dueOn: x })}
                />
                <Input
                  label={`Task ${i + 1} deliverable`}
                  value={t.deliverable}
                  onChange={(x) => setT(i, { deliverable: x })}
                  error={errorOf(`t${i}.deliverable`)}
                />
                <Input
                  label={`Task ${i + 1} budget line (${draft.currency}, one-time, optional)`}
                  value={t.budgetAmount}
                  inputMode="decimal"
                  onChange={(x) => setT(i, { budgetAmount: x })}
                  error={errorOf(`t${i}.budget`)}
                />
                <Input
                  label={`Task ${i + 1} budget note`}
                  value={t.budgetNote}
                  onChange={(x) => setT(i, { budgetNote: x })}
                />
              </div>
              <div>
                <Button
                  variant="ghost"
                  icon="trash"
                  disabled={t.locked}
                  disabledReason="Sent to the task tool · it cannot be removed."
                  onClick={() => setRows((r) => ({ ...r, tasks: r.tasks.filter((_, j) => j !== i) }))}
                  ariaLabel={`Remove task ${i + 1}`}
                >
                  Remove task
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              icon="plus"
              onClick={() => setRows((r) => ({ ...r, tasks: [...r.tasks, newTask()] }))}
            >
              Add task
            </Button>
          </div>
        </div>
      </fieldset>

      {tried && problems.length ? (
        <p role="alert" className="gos-field__error" style={{ margin: 0 }}>
          {problems.length === 1 ? problems[0]!.message : `${problems.length} fields need attention.`}
        </p>
      ) : null}
      {err ? <ProblemBanner error={err} /> : null}
      <div className="ws8d-row">
        <Button
          variant="primary"
          type="submit"
          icon="save"
          disabled={save.isPending}
          disabledReason="Saving…"
        >
          Save plan draft
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
