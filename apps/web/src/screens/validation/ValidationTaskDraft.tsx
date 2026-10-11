/**
 * S09 "Validation tasks · Draft" (D-113, D-128): after G1 approves the experiment, its owner and the
 * case owner edit the title, owner (directory picker), due date (inside the experiment window) and
 * deliverable of a task that has not been sent, add a task, or remove an unsent one. Never threshold,
 * sample or budget: those change only by an amendment with a reason. A sent task is read-only and
 * shows its key; a task added after sending stays "Not sent" until it is previewed and sent.
 */
import { API, type Task } from '@growth-os/contracts';
import { Button, OwnerPicker } from '@growth-os/ui';
import { useId, useState } from 'react';
import { Modal } from '../../app/shell/Modal';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { usePeople } from '../../lib/people';
import { useCommand } from '../../lib/query';
import { dayMonth } from '../decisions/dates';
import { Field } from './Field';
import './validation-tasks.css';

/** Sync states in which a task is still a draft (never sent, or only previewed). */
export const DRAFT_SYNC = new Set(['not_sent', 'in_preview']);
export const isDraft = (t: Task) => DRAFT_SYNC.has(t.sync.status);

export interface ExperimentWindow {
  start: string;
  end: string;
}

interface Values {
  title: string;
  ownerId: string | null;
  dueOn: string;
  deliverable: string;
}

/** Add (no task) or edit (a task) one draft task. */
export function DraftTaskForm({
  taskSetId,
  task,
  window,
  onDone,
  onCancel,
}: {
  taskSetId: string;
  task: Task | null;
  window: ExperimentWindow | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const { people } = usePeople();
  const [v, setV] = useState<Values>({
    title: task?.title ?? '',
    ownerId: task?.owner?.id ?? null,
    dueOn: task?.dueOn ?? '',
    deliverable: task?.deliverable ?? '',
  });
  const [touched, setTouched] = useState(false);
  const add = useCommand(API.taskSync.addDraftTask, { onSuccess: onDone });
  const edit = useCommand(API.taskSync.editDraftTask, { onSuccess: onDone });
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((x) => ({ ...x, [k]: value }));
  const outside = !!window && !!v.dueOn && (v.dueOn < window.start || v.dueOn > window.end);
  const missing = !v.title.trim() || !v.ownerId || !v.deliverable.trim();
  const busy = add.isPending || edit.isPending;
  const label = task ? `Edit task · ${task.title}` : 'Add a validation task';
  const windowText = window ? `${dayMonth(window.start)} – ${dayMonth(window.end)}` : null;
  return (
    <form
      aria-label={label}
      className="vt-draft-form"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (missing || outside) return;
        const body = {
          title: v.title.trim(),
          ownerId: v.ownerId!,
          dueOn: v.dueOn || null,
          deliverable: v.deliverable.trim(),
        };
        if (task) edit.mutate({ params: { id: task.id }, ifMatch: task.rowVersion, body });
        else add.mutate({ params: { id: taskSetId }, body });
      }}
    >
      <Field label="Task title" required value={v.title} onChange={(x) => set('title', x)} />
      <OwnerPicker
        label="Owner"
        required
        value={v.ownerId}
        onChange={(id) => set('ownerId', id)}
        options={people}
        hint={
          v.ownerId
            ? `Selected: ${people.find((p) => p.id === v.ownerId)?.displayName ?? task?.owner?.displayName ?? ''}`
            : 'Choose one accountable person'
        }
      />
      <label className="gos-field" htmlFor={`${ids}-due`}>
        <span>
          Due date
          {windowText ? <span className="gos-field__hint"> (inside the window {windowText})</span> : null}
        </span>
        <input
          id={`${ids}-due`}
          className="gos-input"
          type="date"
          value={v.dueOn}
          min={window?.start}
          max={window?.end}
          aria-invalid={outside ? true : undefined}
          aria-describedby={outside ? `${ids}-due-err` : undefined}
          onChange={(e) => set('dueOn', e.target.value)}
        />
      </label>
      {outside ? (
        <p id={`${ids}-due-err`} className="vt-error" role="alert">
          The due date must be inside the experiment window ({windowText}).
        </p>
      ) : null}
      <Field label="Deliverable" required value={v.deliverable} onChange={(x) => set('deliverable', x)} />
      <p className="vt-note">Thresholds, sample and budget change only by an amendment with a reason.</p>
      {touched && missing ? (
        <p className="vt-error" role="alert">
          A task needs a title, an owner and a deliverable.
        </p>
      ) : null}
      {(add.error ?? edit.error) ? <ProblemBanner error={add.error ?? edit.error} /> : null}
      <div className="vt-row">
        <Button variant="primary" type="submit" disabled={busy} disabledReason="Saving…">
          {task ? 'Save task' : 'Add task'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Confirm removing an unsent task: the row is kept in history, never deleted. */
export function RemoveDraftTaskDialog({
  task,
  onClose,
  onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone: () => void;
}) {
  const remove = useCommand(API.taskSync.removeDraftTask, { onSuccess: onDone });
  return (
    <Modal label="Remove task" onClose={onClose}>
      <div className="vt-dialog">
        <h2 className="vt-dialog__title">Remove task?</h2>
        <p className="vt-dialog__body">
          <b>{task.title}</b> has not been sent. It is removed from these validation tasks and kept in the
          case history.
        </p>
        {remove.error ? <ProblemBanner error={remove.error} /> : null}
        <div className="vt-row">
          <Button
            variant="primary"
            tone="dark"
            disabled={remove.isPending}
            disabledReason="Removing…"
            onClick={() => remove.mutate({ params: { id: task.id }, ifMatch: task.rowVersion })}
          >
            Remove task
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Edit and Remove for one unsent task. */
export function DraftTaskActions({
  task,
  onEdit,
  onRemove,
}: {
  task: Task;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <span className="vt-actions">
      <Button variant="ghost" icon="pencil" onClick={onEdit} ariaLabel={`Edit task: ${task.title}`}>
        Edit
      </Button>
      <Button variant="ghost" icon="trash" onClick={onRemove} ariaLabel={`Remove task: ${task.title}`}>
        Remove
      </Button>
    </span>
  );
}
