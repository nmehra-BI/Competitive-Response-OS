/**
 * My Work (prototype: MyWork.dc.html). Tabs Tasks · Reviews · Approvals; the selected task's
 * "Brief for this task" explains why it exists, what done looks like, the approved limits and what
 * it is measured against. Completing a task never passes a gate; owning tasks never grants approval.
 *
 * Deep links: tab=tasks|reviews|approvals, item=<work item id>.
 */
import { API, TASK_STATUS_LABELS, type TaskStatus, type WorkItem } from '@growth-os/contracts';
import {
  Button,
  Eyebrow,
  GateDiamond,
  Icon,
  Mono,
  TaskStatusTag,
  TextAreaField,
  UiLink,
} from '@growth-os/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { api, queryKey } from '../../lib/api-client';
import { invalidateAfter, useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import { ErrorPage, LoadingPage, PageHeader, useDocumentTitle } from '../overview/shared';
import { TabPanel, WorkTabs } from './WorkTabs';

type Tab = 'tasks' | 'reviews' | 'approvals';
const STATUS_BY_LABEL = Object.fromEntries(
  Object.entries(TASK_STATUS_LABELS).map(([k, v]) => [v, k as TaskStatus]),
) as Record<string, TaskStatus>;

function StatusText({ text }: { text: string }) {
  const s = STATUS_BY_LABEL[text];
  if (s) return <TaskStatusTag status={s} />;
  return (
    <span className="dx-inline" style={{ color: 'var(--info-fg)' }}>
      <Icon name="clock" size={13} />
      <span style={{ color: 'var(--text-primary)' }}>{text}</span>
    </span>
  );
}

export default function MyWorkScreen() {
  useDocumentTitle('My Work');
  const [params, setParams] = useSearchParams();
  const viewer = useViewer();
  const work = useApiQuery(API.work.myWork, { query: {} });
  const inbox = useApiQuery(API.work.reviewsInbox, { query: {} });
  if (work.isPending || inbox.isPending) return <LoadingPage label="My Work" />;
  if (work.error || inbox.error) return <ErrorPage title="My Work" error={work.error ?? inbox.error} />;

  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'reviews' || tabParam === 'approvals' ? tabParam : 'tasks';
  const tasks = work.data.items.filter((i) => i.kind !== 'review_request' && i.kind !== 'gate_decision');
  const reviews = work.data.items.filter((i) => i.kind === 'review_request');
  const approvals = inbox.data.gateDecisions;
  const items = tab === 'tasks' ? tasks : tab === 'reviews' ? reviews : [];
  const itemParam = params.get('item');
  const selected =
    items.find((i) => i.id === itemParam || (itemParam && i.href.includes(`=${itemParam}`))) ??
    items[0] ??
    null;
  const count = (k: string, fallback: number) => work.data.tabs.find((t) => t.key === k)?.count ?? fallback;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  const person = viewer.data?.person;

  return (
    <div className="app-page dx-page">
      <PageHeader
        title="My Work"
        subtitle={person ? `${person.displayName}${person.title ? ` · ${person.title}` : ''}` : undefined}
      />
      <WorkTabs<Tab>
        label="My Work"
        idPrefix="mw"
        value={tab}
        onChange={(t) => set({ tab: t === 'tasks' ? null : t, item: null })}
        tabs={[
          { key: 'tasks', label: 'Tasks', count: count('tasks', tasks.length) },
          { key: 'reviews', label: 'Reviews', count: count('reviews', reviews.length) },
          { key: 'approvals', label: 'Approvals', count: approvals.length },
        ]}
      />
      <TabPanel idPrefix="mw" value={tab}>
        <div className="dx-split" style={{ gap: 20 }}>
          <div className="dx-split__main dx-list" style={{ flexBasis: 480 }}>
            {tab === 'approvals' ? (
              approvals.length ? (
                <ul className="dx-items" aria-label="Gate decisions awaiting you">
                  {approvals.map((a) => (
                    <li key={a.gateRequestId}>
                      <UiLink href={a.href} className="dx-item">
                        <span className="dx-item__title dx-inline">
                          <GateDiamond status="awaiting_decision" size={14} />
                          {a.buttonLabel}
                        </span>
                        <span className="dx-item__due">{a.dueText}</span>
                        <span className="dx-item__sub">
                          <Mono size={12}>{a.caseKey}</Mono> · Gate decision
                        </span>
                        <span className="dx-item__status" style={{ color: 'var(--info-fg)' }}>
                          Awaiting your decision
                        </span>
                      </UiLink>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="dx-empty-center">
                  <span className="dx-muted">
                    <Icon name="scale" size={22} />
                  </span>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>No approvals for you</h2>
                  <p>{work.data.approvalsNotice ?? 'No gate decision is waiting for you.'}</p>
                </div>
              )
            ) : items.length ? (
              <ul
                className="dx-items"
                aria-label={tab === 'tasks' ? 'Your tasks' : 'Reviews assigned to you'}
              >
                {items.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      className="dx-item"
                      aria-current={i.id === selected?.id ? 'true' : undefined}
                      onClick={() => set({ item: i.id })}
                    >
                      <span className="dx-item__title">{i.title}</span>
                      <span className="dx-item__due">{i.dueText ? `Due ${i.dueText}` : 'No due date'}</span>
                      <span className="dx-item__sub">{i.subtitle}</span>
                      <span className="dx-item__status">
                        <StatusText text={i.statusText} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dx-empty-center">
                <span className="dx-muted">
                  <Icon name="checksq" size={22} />
                </span>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                  {tab === 'tasks' ? 'No tasks for you' : 'No reviews for you'}
                </h2>
                <p>
                  {tab === 'tasks'
                    ? 'Tasks appear here when an approved plan assigns them to you.'
                    : 'Review requests assigned to you appear here and in Reviews.'}
                </p>
              </div>
            )}
          </div>
          <div className="dx-split__side" style={{ flexBasis: 360 }}>
            {tab !== 'approvals' && selected?.brief ? <Brief key={selected.id} item={selected} /> : null}
          </div>
        </div>
      </TabPanel>
    </div>
  );
}

function Brief({ item }: { item: WorkItem }) {
  const b = item.brief!;
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [blocking, setBlocking] = useState(false);
  const [blocker, setBlocker] = useState('');
  const report = useCommand(API.pilot.reportBlocker, {
    onSuccess: () => {
      setBlocking(false);
      setBlocker('');
    },
  });
  const isTask = item.kind === 'task';
  const status = STATUS_BY_LABEL[item.statusText];

  /** tasks.update needs the task's row version, read from the pilot plan (the S11 source of truth). */
  const setStatus = async (next: TaskStatus) => {
    setBusy(true);
    setError(null);
    try {
      const plan = await qc.fetchQuery({
        queryKey: queryKey(API.pilot.get, { caseRef: item.caseKey }),
        queryFn: () => api(API.pilot.get, { params: { caseRef: item.caseKey } }),
        staleTime: 0,
      });
      const task = plan.taskSet?.tasks.find((t) => t.id === item.id);
      if (!task) throw new Error('task not in plan');
      await api(API.pilot.updateTask, {
        params: { id: task.id },
        body: { status: next },
        ifMatch: task.rowVersion,
      });
      await invalidateAfter(qc, API.pilot.updateTask.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="dx-brief" aria-labelledby="brief-title">
      <div className="dx-brief__head">
        <div className="dx-small dx-faint" style={{ fontWeight: 500 }}>
          Brief for this {isTask ? 'task' : 'review'}
        </div>
        <h2 id="brief-title">{item.title}</h2>
        <div className="dx-row dx-muted" style={{ gap: '6px 12px', marginTop: 6, fontSize: 12.5 }}>
          <Mono size={12}>{item.caseKey}</Mono>
          <span>{b.gateText}</span>
          <span className="dx-inline" style={{ gap: 4 }}>
            <span className="dx-glyph-ok">
              <Icon name="link" size={13} />
            </span>
            <span style={{ color: 'var(--text-primary)' }}>{b.syncText}</span>
          </span>
        </div>
      </div>
      <div className="dx-brief__body">
        <div>
          <Eyebrow>Why this {isTask ? 'task' : 'review'}</Eyebrow>
          <p className="dx-reading" style={{ fontSize: 15.5, lineHeight: '24px' }}>
            {b.why}
          </p>
        </div>
        <div>
          <Eyebrow>Done looks like</Eyebrow>
          <p>{b.doneLooksLike}</p>
        </div>
        <div>
          <Eyebrow>{isTask ? 'Stay inside' : 'What to check'}</Eyebrow>
          <ul>
            {b.stayInside.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <Eyebrow>Measured against</Eyebrow>
          <p className="dx-muted">{b.measuredAgainst}</p>
        </div>
        {error ? <ProblemBanner error={error} /> : null}
        {report.error ? <ProblemBanner error={report.error} /> : null}
        {blocking ? (
          <form
            className="dx-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (blocker.trim()) report.mutate({ params: { id: item.id }, body: { text: blocker.trim() } });
            }}
          >
            <TextAreaField
              label="What blocks this task?"
              required
              value={blocker}
              onChange={setBlocker}
              rows={2}
            />
            <div className="dx-row">
              <Button
                variant="primary"
                type="submit"
                disabled={!blocker.trim() || report.isPending}
                disabledReason={report.isPending ? 'Reporting…' : 'Describe the blocker.'}
              >
                Report blocker
              </Button>
              <Button variant="ghost" onClick={() => setBlocking(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="dx-actions">
            {isTask && status === 'not_started' ? (
              <Button
                variant="secondary"
                disabled={busy}
                disabledReason="Saving…"
                onClick={() => void setStatus('in_progress')}
              >
                Mark in progress
              </Button>
            ) : null}
            {isTask && status === 'in_progress' ? (
              <Button
                variant="primary"
                icon="check"
                disabled={busy}
                disabledReason="Saving…"
                onClick={() => void setStatus('done')}
              >
                Mark done
              </Button>
            ) : null}
            {isTask && status !== 'done' ? (
              <Button variant="secondary" icon="alert" onClick={() => setBlocking(true)}>
                Report blocker
              </Button>
            ) : null}
            <Button variant="ghost" href={item.href}>
              {isTask ? (item.href.includes('/pilot') ? 'Open pilot plan' : 'Open in case') : 'Open review'}
            </Button>
          </div>
        )}
        <p role="status" className="dx-small dx-faint" style={{ margin: 0 }}>
          {status === 'done'
            ? 'Done. Completing tasks does not pass a gate.'
            : isTask
              ? 'Status syncs to Jira; the case stays the source of truth.'
              : 'Your response is recorded with your reason. A review is not a gate decision.'}
        </p>
      </div>
    </aside>
  );
}
