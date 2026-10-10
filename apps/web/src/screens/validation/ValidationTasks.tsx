/**
 * Validation tasks (Validation.dc.html): preview before anything is written to another tool,
 * then create once. Sync status is honest: "Sending…" until the tool returns a key, then
 * "Confirmed · VAL-n" (never-rule 9). Polls while any task is in flight.
 */
import {
  API,
  type Experiment,
  type PersonRef,
  type TaskSet,
  type TaskSyncPreview,
} from '@growth-os/contracts';
import { Button, EmptyState, SectionHeader, Skeleton, SyncStatusTag } from '@growth-os/ui';
import { useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { pollWhile, SYNC_IN_FLIGHT, useApiQuery, useCommand } from '../../lib/query';
import { dayMonth, dayTime } from '../decisions/dates';

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
  return (
    <>
      <SectionHeader title="Validation tasks" subtitle="Preview before anything is written to another tool" />
      {experiment?.taskSetId ? (
        <TaskSetCard
          taskSetId={experiment.taskSetId}
          canCreate={!!viewer && viewer.id === experiment.owner.id}
          authorizedBy={authorizedBy}
        />
      ) : (
        <EmptyState title="No tasks yet">
          Validation tasks can be created once G1 approves the validation spend.
        </EmptyState>
      )}
    </>
  );
}

function TaskSetCard({
  taskSetId,
  canCreate,
  authorizedBy,
}: {
  taskSetId: string;
  canCreate: boolean;
  authorizedBy: string | null;
}) {
  const set = useApiQuery(
    API.taskSync.get,
    { params: { id: taskSetId } },
    {
      refetchInterval: pollWhile<TaskSet>((d) => d.tasks.some((t) => SYNC_IN_FLIGHT.has(t.sync.status))),
    },
  );
  const [preview, setPreview] = useState<TaskSyncPreview | null>(null);
  const previewCmd = useCommand(API.taskSync.preview, { onSuccess: (p) => setPreview(p) });
  const send = useCommand(API.taskSync.send, { onSuccess: () => setPreview(null) });

  if (set.isPending) return <Skeleton height={220} />;
  if (set.error || !set.data) return <ProblemBanner error={set.error} />;
  const s = set.data;
  const notSent = s.tasks.every((t) => t.sync.status === 'not_sent');
  const confirmedAt = s.tasks.map((t) => t.sync.confirmedAt).find(Boolean);
  const title = preview ? 'Preview · nothing sent yet' : s.summaryText;
  const destination = preview
    ? `Destination ${preview.destination.tool} · project ${preview.destination.project} · ${preview.assigneesText} · ${preview.permissionsText}`
    : (s.destinationLabel ?? '');
  const note = preview
    ? `Check owners and dates. Creating writes ${preview.willCreate} issues once; retries never duplicate.`
    : s.summary.confirmed === s.summary.total && confirmedAt
      ? `Created ${dayTime(confirmedAt)} under G1 approval.`
      : !notSent
        ? 'Waiting for the task tool to confirm each task.'
        : (authorizedBy ?? '');

  return (
    <div className="ws8c-card" style={{ overflow: 'hidden' }}>
      <div className="ws8c-card__bar">
        <b>{title}</b>
        <span>{destination}</span>
      </div>
      <ul className="ws8c-tasks" aria-label="Validation tasks">
        {s.tasks.map((t) => (
          <li key={t.id}>
            <span>{t.title}</span>
            <span className="ws8c-secondary">{t.owner?.displayName ?? 'Unassigned'}</span>
            <span className="ws8c-secondary">{t.dueOn ? dayMonth(t.dueOn) : '—'}</span>
            <span>
              {preview ? (
                <SyncStatusTag status="in_preview" />
              ) : (
                <SyncStatusTag
                  status={t.sync.status}
                  externalKey={t.sync.externalKey}
                  error={t.sync.lastErrorMessage}
                />
              )}
            </span>
          </li>
        ))}
      </ul>
      {previewCmd.error ? <ProblemBanner error={previewCmd.error} /> : null}
      {send.error ? <ProblemBanner error={send.error} /> : null}
      <div className="ws8c-card__foot">
        {canCreate && notSent && !preview ? (
          <Button
            variant="primary"
            icon="eye"
            disabled={previewCmd.isPending}
            disabledReason="Preparing the preview…"
            onClick={() => previewCmd.mutate({ params: { id: s.id } })}
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
              {`Create ${preview.willCreate} tasks in ${preview.destination.tool}`}
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </>
        ) : null}
        <span role="status" className="ws8c-secondary" style={{ fontSize: 12.5 }}>
          {note}
        </span>
      </div>
    </div>
  );
}
