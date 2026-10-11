/**
 * Validation tasks (Validation.dc.html): preview before anything is written to another tool,
 * then create once. Sync status is honest: "Sending…" until the tool returns a key, then
 * "Confirmed · VAL-n" (never-rule 9). Polls while any task is in flight.
 *
 * After G1 the set is a draft (D-113): the experiment owner and the case owner edit, add or remove
 * unsent tasks ("Validation tasks · Draft"). Sent tasks are read-only and show their key. An edit
 * invalidates an open preview: the owner previews again, and the send refuses an older preview.
 */
import {
  API,
  type Experiment,
  type PersonRef,
  type Task,
  type TaskSet,
  type TaskSyncPreview,
} from '@growth-os/contracts';
import { Button, EmptyState, SectionHeader, Skeleton, SyncStatusTag } from '@growth-os/ui';
import { useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { pollWhile, SYNC_IN_FLIGHT, useApiQuery, useCommand } from '../../lib/query';
import { dayMonth, dayTime } from '../decisions/dates';
import {
  DraftTaskActions,
  DraftTaskForm,
  isDraft,
  RemoveDraftTaskDialog,
  type ExperimentWindow,
} from './ValidationTaskDraft';

export function ValidationTasks({
  experiment,
  viewer,
  authorizedBy,
}: {
  experiment: Experiment | null;
  viewer: PersonRef | null;
  /** "Authorized by G1 · validation €15k." */
  authorizedBy: string | null;
}) {
  const plan = experiment?.current.plan;
  return experiment?.taskSetId ? (
    <TaskSetCard
      taskSetId={experiment.taskSetId}
      canCreate={!!viewer && viewer.id === experiment.owner.id}
      authorizedBy={authorizedBy}
      window={plan ? { start: plan.windowStart, end: plan.windowEnd } : null}
    />
  ) : (
    <>
      <SectionHeader title="Validation tasks" subtitle="Preview before anything is written to another tool" />
      <EmptyState title="No tasks yet">
        Validation tasks can be created once G1 approves the validation spend.
      </EmptyState>
    </>
  );
}

type Editing = { kind: 'add' } | { kind: 'edit'; task: Task } | null;

function TaskSetCard({
  taskSetId,
  canCreate,
  authorizedBy,
  window,
}: {
  taskSetId: string;
  canCreate: boolean;
  authorizedBy: string | null;
  window: ExperimentWindow | null;
}) {
  const set = useApiQuery(
    API.taskSync.get,
    { params: { id: taskSetId } },
    {
      refetchInterval: pollWhile<TaskSet>((d) => d.tasks.some((t) => SYNC_IN_FLIGHT.has(t.sync.status))),
    },
  );
  const [preview, setPreview] = useState<TaskSyncPreview | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<Task | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const previewCmd = useCommand(API.taskSync.preview, { onSuccess: (p) => setPreview(p) });
  const send = useCommand(API.taskSync.send, { onSuccess: () => setPreview(null) });

  if (set.isPending) return <Skeleton height={220} />;
  if (set.error || !set.data) return <ProblemBanner error={set.error} />;
  const s = set.data;
  const unsent = s.tasks.filter(isDraft);
  const drafting = !!s.draftEditable && unsent.length > 0;
  const editable = !!s.draftEditable && !preview;
  const confirmedAt = s.tasks.map((t) => t.sync.confirmedAt).find(Boolean);
  const title = preview ? 'Preview · nothing sent yet' : s.summaryText;
  const destination = preview
    ? `Destination ${preview.destination.tool} · project ${preview.destination.project} · ${preview.assigneesText} · ${preview.permissionsText}`
    : (s.destinationLabel ?? '');
  const note = saved
    ? saved
    : preview
      ? `Check owners and dates. Creating writes ${preview.willCreate} issues once; retries never duplicate.`
      : s.summary.confirmed === s.summary.total && confirmedAt
        ? `Created ${dayTime(confirmedAt)} under G1 approval.`
        : unsent.length === s.tasks.length
          ? (authorizedBy ?? '')
          : unsent.length > 0
            ? `${unsent.length} not sent yet: preview, then create them.`
            : 'Waiting for the task tool to confirm each task.';
  const done = (message: string) => () => {
    setEditing(null);
    setRemoving(null);
    setPreview(null);
    setSaved(message);
  };

  return (
    <>
      <SectionHeader
        title={drafting ? 'Validation tasks · Draft' : 'Validation tasks'}
        subtitle={
          drafting
            ? 'Edit wording, owner, due date and deliverable before sending. Sent tasks are read-only.'
            : 'Preview before anything is written to another tool'
        }
      />
      <div className="ws8c-card" style={{ overflow: 'hidden' }}>
        <div className="ws8c-card__bar">
          <b>{title}</b>
          <span>{destination}</span>
        </div>
        <ul className="ws8c-tasks" aria-label="Validation tasks">
          {s.tasks.map((t) =>
            editing?.kind === 'edit' && editing.task.id === t.id ? (
              <li key={t.id} className="vt-item--editing">
                <DraftTaskForm
                  taskSetId={s.id}
                  task={t}
                  window={window}
                  onDone={done(`Saved task ${t.ordinal}. Preview again before sending.`)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={t.id}>
                <span>{t.title}</span>
                <span className="ws8c-secondary">{t.owner?.displayName ?? 'Unassigned'}</span>
                <span className="ws8c-secondary">{t.dueOn ? dayMonth(t.dueOn) : '—'}</span>
                <span>
                  {preview && isDraft(t) ? (
                    <SyncStatusTag status="in_preview" />
                  ) : (
                    <SyncStatusTag
                      status={t.sync.status}
                      externalKey={t.sync.externalKey}
                      error={t.sync.lastErrorMessage}
                    />
                  )}
                </span>
                {editable && isDraft(t) && !editing ? (
                  <DraftTaskActions
                    task={t}
                    onEdit={() => {
                      setSaved(null);
                      setEditing({ kind: 'edit', task: t });
                    }}
                    onRemove={() => {
                      setSaved(null);
                      setRemoving(t);
                    }}
                  />
                ) : null}
              </li>
            ),
          )}
        </ul>
        {editing?.kind === 'add' ? (
          <DraftTaskForm
            taskSetId={s.id}
            task={null}
            window={window}
            onDone={done('Task added. It is not sent until you preview and create it.')}
            onCancel={() => setEditing(null)}
          />
        ) : null}
        {previewCmd.error ? <ProblemBanner error={previewCmd.error} /> : null}
        {send.error ? <ProblemBanner error={send.error} /> : null}
        <div className="ws8c-card__foot">
          {canCreate && unsent.length > 0 && !preview && !editing ? (
            <Button
              variant="primary"
              icon="eye"
              disabled={previewCmd.isPending}
              disabledReason="Preparing the preview…"
              onClick={() => {
                setSaved(null);
                previewCmd.mutate({ params: { id: s.id } });
              }}
            >
              Preview tasks
            </Button>
          ) : null}
          {canCreate && preview ? (
            <>
              <Button
                variant="primary"
                icon="send"
                disabled={send.isPending}
                disabledReason="Sending…"
                onClick={() =>
                  send.mutate({
                    params: { id: s.id },
                    body: { previewId: preview.id, previewHash: preview.contentHash },
                  })
                }
              >
                {`Create ${preview.willCreate} ${preview.willCreate === 1 ? 'task' : 'tasks'} in ${preview.destination.tool}`}
              </Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Cancel
              </Button>
            </>
          ) : null}
          {editable && !editing ? (
            <Button
              variant="secondary"
              icon="plus"
              onClick={() => {
                setSaved(null);
                setEditing({ kind: 'add' });
              }}
            >
              Add task
            </Button>
          ) : null}
          <span role="status" className="ws8c-secondary" style={{ fontSize: 12.5 }}>
            {note}
          </span>
        </div>
      </div>
      {removing ? (
        <RemoveDraftTaskDialog
          task={removing}
          onClose={() => setRemoving(null)}
          onDone={done(`Removed task ${removing.ordinal}. It stays in the case history.`)}
        />
      ) : null}
    </>
  );
}
