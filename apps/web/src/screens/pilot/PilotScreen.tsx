/**
 * S11 Pilot (prototype Pilot.dc.html). Pinned approved baseline, budget meter, milestones and
 * tasks with internal status and external sync kept apart, activation blockers, dry-run preview,
 * honest sync summary ("5 of 6 tasks confirmed in Jira · 1 failed (permission)"; never "Synced"),
 * retry of failed tasks only, Checking → Confirmed after a timeout, expired connector with CSV
 * export, paused sending after an approval change, and message drafts that are never sent.
 *
 * Deep links: `task` (task id, PIL key or number) highlights a row; `view=preview` opens the preview.
 */
import {
  API,
  type Condition,
  type PersonRef,
  type PilotPlanView,
  type Task,
  type TaskSyncPreview,
} from '@growth-os/contracts';
import {
  AiBadge,
  Banner,
  Button,
  ConditionItem,
  DataTable,
  GateChip,
  Icon,
  Mono,
  OwnerPicker,
  SectionHeader,
  Skeleton,
  SyncStatusTag,
  TaskStatusTag,
  TextAreaField,
  formatBudget,
  formatNotAvailable,
  type DataTableColumn,
} from '@growth-os/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Modal } from '../../app/shell/Modal';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { api } from '../../lib/api-client';
import { pollWhile, SYNC_IN_FLIGHT, useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import { fmtDate, fmtDateTime, fmtPeriod } from '../history/dates';
import '../history/ws8d.css';

type View = PilotPlanView;
type Money = NonNullable<View['budget']>['approved'];
type MoneyOr = NonNullable<View['budget']>['spent'];

const FUNCTION_LABEL: Record<Task['function'], string> = {
  product: 'Product',
  sales: 'Sales',
  marketing: 'Marketing',
  operations: 'Operations',
  strategy: 'Strategy',
  finance: 'Finance',
  specialist: 'Specialist',
};

function moneyText(m: Money | MoneyOr): string {
  return 'unavailable' in m ? formatNotAvailable(m.reason) : formatBudget(m.amount, m.currency);
}

function share(part: MoneyOr, total: Money): number {
  if ('unavailable' in part) return 0;
  const t = Number(total.amount);
  return t > 0 ? Math.min(100, Math.max(0, (Number(part.amount) / t) * 100)) : 0;
}

const inFlight = (v: View | undefined) => !!v?.taskSet?.tasks.some((t) => SYNC_IN_FLIGHT.has(t.sync.status));

function matchesTask(t: Task, ref: string | null): boolean {
  if (!ref) return false;
  return t.id === ref || t.sync.externalKey === ref || String(t.ordinal) === ref;
}

/** Everyone the plan names (task owners, condition owners). The contract has no case-people list. */
function peopleOf(v: View, viewer: PersonRef | undefined): PersonRef[] {
  const map = new Map<string, PersonRef>();
  for (const t of v.taskSet?.tasks ?? []) if (t.owner) map.set(t.owner.id, t.owner);
  for (const c of v.conditions) map.set(c.owner.id, c.owner);
  if (viewer) map.set(viewer.id, viewer);
  return [...map.values()];
}

export default function PilotScreen() {
  const { caseKey = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const viewer = useViewer();
  const q = useApiQuery(
    API.pilot.get,
    { params: { caseRef: caseKey } },
    { refetchInterval: pollWhile<View>((d) => inFlight(d)) },
  );
  if (q.isPending) {
    return (
      <div className="ws8d-page" aria-busy="true">
        <Skeleton height={24} width={260} />
        <Skeleton height={160} />
        <Skeleton height={240} />
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <div className="ws8d-page">
        <h2 className="gos-sr-only">Pilot</h2>
        <ProblemBanner error={q.error} />
      </div>
    );
  }
  const isPilotOwner = !!viewer.data?.roles.some((r) => r.role === 'pilot_owner' && !r.revokedAt);
  return (
    <PilotView
      caseKey={caseKey}
      v={q.data}
      viewerPerson={viewer.data?.person}
      canOperate={isPilotOwner}
      search={search}
      setSearch={setSearch}
    />
  );
}

type Dialog =
  | { kind: 'owner'; task: Task }
  | { kind: 'condition'; condition: Condition }
  | { kind: 'activate' }
  | { kind: 'scope' }
  | { kind: 'blocker' }
  | { kind: 'draft' }
  | null;

function PilotView({
  caseKey,
  v,
  viewerPerson,
  canOperate,
  search,
  setSearch,
}: {
  caseKey: string;
  v: View;
  viewerPerson: PersonRef | undefined;
  canOperate: boolean;
  search: URLSearchParams;
  setSearch: (s: URLSearchParams, o?: { replace?: boolean }) => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [preview, setPreview] = useState<TaskSyncPreview | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lastError, setLastError] = useState<unknown>(null);
  const caseRef = caseKey;
  const ts = v.taskSet;
  const tasks = ts?.tasks ?? [];
  const selected = search.get('task');
  const active = v.status === 'active' || v.status === 'paused' || v.status === 'completed';
  const expired = v.connectorBanner?.status === 'expired';
  const paused = tasks.some((t) => t.sync.status === 'paused_approval_changed');
  const failed = tasks.filter((t) => t.sync.status === 'failed');
  const checking = tasks.filter((t) => t.sync.status === 'checking');
  const anySent = tasks.some((t) => t.sync.attempts > 0);
  const allConfirmed =
    tasks.length > 0 && tasks.every((t) => t.sync.status === 'confirmed' && t.sync.externalKey);

  const previewCmd = useCommand(API.taskSync.preview);
  const sendCmd = useCommand(API.taskSync.send);
  const retryCmd = useCommand(API.taskSync.retry);
  const activateCmd = useCommand(API.pilot.activate);

  const run = async <T,>(p: Promise<T>, ok?: (r: T) => void) => {
    setLastError(null);
    try {
      const r = await p;
      ok?.(r);
      return r;
    } catch (e) {
      setLastError(e);
      return undefined;
    }
  };

  const setView = (view: string | null) => {
    const next = new URLSearchParams(search);
    if (view) next.set('view', view);
    else next.delete('view');
    setSearch(next, { replace: true });
  };

  const openPreview = () =>
    ts &&
    run(previewCmd.mutateAsync({ params: { id: ts.id } }), (p) => {
      setPreview(p);
      setNote('Review destination, assignees and permissions.');
      setView('preview');
    });

  // Deep link: view=preview opens the dry run (it writes nothing external).
  const autoPreviewed = useRef(false);
  useEffect(() => {
    if (autoPreviewed.current || search.get('view') !== 'preview') return;
    if (!ts || !canOperate || v.status !== 'active' || expired || anySent) return;
    autoPreviewed.current = true;
    void openPreview();
  }, [search, ts?.id, canOperate, v.status, expired, anySent]);

  const create = () =>
    ts &&
    preview &&
    run(
      sendCmd.mutateAsync({
        params: { id: ts.id },
        body: { previewId: preview.id, previewHash: preview.contentHash },
      }),
      () => {
        setPreview(null);
        setView(null);
        setNote(null);
      },
    );

  const retry = () =>
    ts &&
    run(retryCmd.mutateAsync({ params: { id: ts.id }, body: { taskIds: failed.map((t) => t.id) } }), () =>
      setNote(null),
    );

  const exportCsv = async () => {
    if (!ts) return;
    const csv = await run(api(API.taskSync.exportCsv, { params: { id: ts.id } }));
    if (csv === undefined) return;
    const url = URL.createObjectURL(new Blob([String(csv)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${caseKey}-pilot-tasks.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setNote('CSV exported · internal tasks stay tracked here.');
  };

  const firstBlocker = v.activationBlockers[0];
  const ownerBlocker = v.activationBlockers.find((b) => b.key === 'task_owner_missing');
  const conditionBlocker = v.activationBlockers.find((b) => b.key === 'condition_open');
  const operateReason = 'Only the pilot owner can do this.';

  const statusNote =
    note ??
    (!active
      ? ownerBlocker
        ? 'Assign an owner to every task to activate.'
        : 'Activation starts the pilot window. It does not create external tasks.'
      : expired
        ? 'Plan active. External task creation is unavailable until Jira is reconnected.'
        : paused
          ? 'Sending is paused. Tasks already in Jira are kept.'
          : failed.length
            ? `${tasks.length - failed.length} confirmed · ${failed.length} failed · retry affects only the failed task.`
            : checking.length
              ? 'Checking Jira before retrying.'
              : allConfirmed
                ? 'All tasks confirmed.'
                : 'Plan active. Preview before writing to Jira.');

  const columns: DataTableColumn<Task>[] = [
    {
      key: 'task',
      header: 'Task · milestone',
      cell: (t) => (
        <div>
          <Link
            to={`?task=${encodeURIComponent(t.sync.externalKey ?? t.id)}`}
            replace
            className="gos-link"
            style={{ fontWeight: 500, color: 'var(--text-primary)' }}
          >
            {t.title}
          </Link>
          <div className="ws8d-sub" style={{ marginTop: 2 }}>
            {t.milestoneLabel ?? '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'fn',
      header: 'Function',
      cell: (t) => <span className="ws8d-note">{FUNCTION_LABEL[t.function]}</span>,
    },
    {
      key: 'owner',
      header: 'Owner',
      cell: (t) =>
        t.owner ? (
          <span style={{ fontSize: 13 }}>{t.owner.displayName}</span>
        ) : (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            <span className="ws8d-row-flag" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <Icon name="alert" size={13} />
              Unassigned
            </span>
            {!active ? (
              <Button
                variant="ghost"
                onClick={() => setDialog({ kind: 'owner', task: t })}
                ariaLabel={`Assign owner to ${t.title}`}
              >
                Assign owner
              </Button>
            ) : null}
          </span>
        ),
    },
    { key: 'dep', header: 'Depends on', cell: (t) => <span className="ws8d-note">{t.dependsOnLabel}</span> },
    {
      key: 'due',
      header: 'Due',
      cell: (t) => <span className="ws8d-note">{t.dueRule ?? fmtDate(t.dueOn, { year: false })}</span>,
    },
    {
      key: 'del',
      header: 'Deliverable',
      cell: (t) => <span style={{ fontSize: 12.5 }}>{t.deliverable}</span>,
    },
    { key: 'status', header: 'Status', cell: (t) => <TaskStatusTag status={t.status} /> },
    {
      key: 'sync',
      header: 'External sync',
      cell: (t) => (
        <div aria-live="polite">
          <SyncStatusTag status={t.sync.status} externalKey={t.sync.externalKey} />
          {t.sync.lastErrorMessage && t.sync.status !== 'confirmed' ? (
            <div className="ws8d-sub" style={{ marginTop: 2 }}>
              {t.sync.lastErrorMessage}
            </div>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="ws8d-page">
      <h2 className="gos-sr-only">Pilot</h2>

      {v.connectorBanner ? (
        <Banner
          tone="warn"
          title={v.connectorBanner.title}
          body={v.connectorBanner.body}
          actions={
            <Button variant="secondary" icon="download" onClick={exportCsv}>
              Export CSV instead
            </Button>
          }
        />
      ) : null}
      {ownerBlocker ? (
        <Banner tone="warn" title="Missing owner blocks activation" body={ownerBlocker.message} />
      ) : conditionBlocker ? (
        <Banner tone="warn" title="Open condition C1 blocks activation" body={conditionBlocker.message} />
      ) : null}
      {paused && ts ? (
        <Banner
          tone="warn"
          title="Approval changed · sending paused"
          body={`${ts.summaryText}. Tasks already created in Jira are kept; unsent tasks wait for a new authorization.`}
        />
      ) : failed.length && ts ? (
        <Banner
          tone="danger"
          title={ts.summaryText}
          body={`“${failed[0]!.title}”: ${failed[0]!.sync.lastErrorMessage ?? 'not created'}. Nothing was duplicated. Retry only the failed task after the permission is fixed.`}
          actions={
            canOperate ? (
              <Button variant="secondary" icon="refresh" onClick={retry}>
                {`Retry ${failed.length} failed task${failed.length === 1 ? '' : 's'}`}
              </Button>
            ) : undefined
          }
        />
      ) : checking.length && ts ? (
        <Banner
          tone="info"
          title={ts.summaryText}
          body="Jira did not answer in time. We check whether the issue exists before any retry, so nothing is duplicated."
        />
      ) : allConfirmed && ts ? (
        <Banner
          tone="ok"
          title={ts.summaryText}
          body={`Each issue links back to ${caseKey} · G2 v${v.baseline?.snapshotVersion ?? ''}. Task completion does not pass any gate.`}
        />
      ) : null}

      <div className="ws8d-grid">
        <Baseline
          v={v}
          canOperate={canOperate}
          onMarkMet={(c) => setDialog({ kind: 'condition', condition: c })}
          onScope={() => setDialog({ kind: 'scope' })}
          onBlocker={() => setDialog({ kind: 'blocker' })}
        />
        <BudgetMeterView v={v} />
      </div>

      <div className="ws8d-row">
        {!active ? (
          <Button
            variant="primary"
            icon="rocket"
            disabled={!canOperate || !!firstBlocker}
            disabledReason={!canOperate ? operateReason : firstBlocker?.message}
            onClick={() => setDialog({ kind: 'activate' })}
          >
            Activate approved plan
          </Button>
        ) : null}
        {active && !anySent && !preview && !expired && !paused ? (
          <Button
            variant="primary"
            icon="eye"
            disabled={!canOperate}
            disabledReason={operateReason}
            onClick={openPreview}
          >
            Preview tasks
          </Button>
        ) : null}
        {failed.length && canOperate ? (
          <Button variant="primary" icon="refresh" onClick={retry}>
            {`Retry ${failed.length} failed task${failed.length === 1 ? '' : 's'}`}
          </Button>
        ) : null}
        {expired ? (
          <Button variant="secondary" icon="download" onClick={exportCsv}>
            Export CSV instead
          </Button>
        ) : null}
        <span role="status" aria-live="polite" className="ws8d-note">
          {statusNote}
        </span>
      </div>
      {lastError ? <ProblemBanner error={lastError} /> : null}

      {preview ? (
        <PreviewPanel
          p={preview}
          busy={sendCmd.isPending}
          onCreate={create}
          onBack={() => {
            setPreview(null);
            setView(null);
            setNote(null);
          }}
        />
      ) : null}

      <SectionHeader
        title="Milestones and tasks"
        subtitle="Product · sales · marketing · operations · review. Internal status is separate from external sync."
      />
      {ts?.destinationLabel ? <p className="ws8d-muted">Destination: {ts.destinationLabel}</p> : null}
      <div className="gos-card" style={{ overflow: 'hidden' }}>
        <TaskTable tasks={tasks} columns={columns} selected={selected} />
      </div>

      {v.messageDrafts.map((d) => (
        <section key={d.id} className="ws8d-section" aria-labelledby={`om-${d.id}`}>
          <h2 id={`om-${d.id}`}>Outbound messages</h2>
          <div className="ws8d-section ws8d-section--dashed">
            <div className="ws8d-row">
              <Icon name="mail" size={15} />
              <b style={{ fontWeight: 600, fontSize: 13.5 }}>{d.title}</b>
              <span className="ws8d-tag ws8d-tag--warn">
                <Icon name="lock" size={12} />
                {d.notice}
              </span>
              {d.origin !== 'human' ? <AiBadge variant="draft" /> : null}
            </div>
            <p className="ws8d-serif" style={{ margin: 0, color: 'var(--text-secondary)' }}>
              “{d.body}”
            </p>
            <div className="ws8d-row">
              <Button variant="secondary" icon="pencil" onClick={() => setDialog({ kind: 'draft' })}>
                Edit draft
              </Button>
              <Button
                variant="secondary"
                disabled
                disabledReason="Task authorization does not authorize sending prospect communications."
              >
                Send
              </Button>
            </div>
          </div>
        </section>
      ))}

      {dialog?.kind === 'owner' ? (
        <OwnerDialog
          v={v}
          task={dialog.task}
          people={peopleOf(v, viewerPerson)}
          caseRef={caseRef}
          onClose={() => setDialog(null)}
          onDone={(name) => setNote(`${name} owns “${dialog.task.title}”.`)}
        />
      ) : null}
      {dialog?.kind === 'condition' ? (
        <ConditionDialog
          condition={dialog.condition}
          onClose={() => setDialog(null)}
          onDone={() => setNote(`${dialog.condition.key} marked met.`)}
        />
      ) : null}
      {dialog?.kind === 'activate' ? (
        <ConfirmDialog
          title="Activate approved plan?"
          body={`Activation starts the pilot window (${(v.current ?? v.draft) ? fmtPeriod((v.current ?? v.draft)!.windowStart, (v.current ?? v.draft)!.windowEnd) : 'approved window'}) and commits plan v${(v.current ?? v.draft)?.version ?? 1}. It does not create external tasks.`}
          confirm="Activate approved plan"
          busy={activateCmd.isPending}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const r = await run(activateCmd.mutateAsync({ params: { caseRef } }));
            setDialog(null);
            if (r) setNote('Plan active. Preview before writing to Jira.');
          }}
        />
      ) : null}
      {dialog?.kind === 'scope' ? (
        <ScopeDialog caseRef={caseRef} onClose={() => setDialog(null)} onDone={setNote} />
      ) : null}
      {dialog?.kind === 'blocker' ? (
        <BlockerDialog tasks={tasks} onClose={() => setDialog(null)} onDone={setNote} />
      ) : null}
      {dialog?.kind === 'draft' && v.messageDrafts[0] ? (
        <DraftDialog draft={v.messageDrafts[0]} onClose={() => setDialog(null)} onDone={setNote} />
      ) : null}
    </div>
  );
}

function TaskTable({
  tasks,
  columns,
  selected,
}: {
  tasks: Task[];
  columns: DataTableColumn<Task>[];
  selected: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sel = tasks.find((t) => matchesTask(t, selected));
  useEffect(() => {
    if (!ref.current) return;
    ref.current
      .querySelectorAll('.ws8d-selected-row')
      .forEach((r) => r.classList.remove('ws8d-selected-row'));
    if (!sel) return;
    const row = ref.current.querySelector(`[data-task="${sel.id}"]`);
    row?.closest('tr')?.classList.add('ws8d-selected-row');
    (row as HTMLElement | null)?.scrollIntoView?.({ block: 'center' });
  }, [sel]);
  const cols = columns.map((c) =>
    c.key === 'task'
      ? {
          ...c,
          cell: (t: Task) => (
            <div data-task={t.id} aria-current={sel?.id === t.id ? 'true' : undefined}>
              {c.cell(t)}
            </div>
          ),
        }
      : c,
  );
  return (
    <div ref={ref}>
      <DataTable columns={cols} rows={tasks} rowKey={(t) => t.id} ariaLabel="Pilot tasks" minWidth={1120} />
    </div>
  );
}

function Baseline({
  v,
  canOperate,
  onMarkMet,
  onScope,
  onBlocker,
}: {
  v: View;
  canOperate: boolean;
  onMarkMet: (c: Condition) => void;
  onScope: () => void;
  onBlocker: () => void;
}) {
  const b = v.baseline;
  const plan = v.current ?? v.draft;
  const invalid = /invalidated/i.test(b?.statusText ?? '');
  return (
    <section className="ws8d-section ws8d-section--pinned" aria-labelledby="pilot-baseline">
      <div className="ws8d-row">
        <Icon name="lock" size={15} />
        <h2 id="pilot-baseline">Approved baseline · pinned</h2>
        {b ? (
          <GateChip status={invalid ? 'invalidated' : 'approved_with_conditions'} text={b.statusText} />
        ) : null}
        {b ? (
          <span className="ws8d-note" style={{ fontSize: 12.5 }}>
            Snapshot v{b.snapshotVersion} · <Mono size={12}>{b.fingerprint}</Mono>
          </span>
        ) : null}
      </div>
      {plan ? (
        <dl className="ws8d-facts">
          <div>
            <dt>Budget ceiling</dt>
            <dd className="ws8d-big">{formatBudget(plan.budgetCeiling, plan.currency)}</dd>
          </div>
          <div>
            <dt>Window</dt>
            <dd>{fmtPeriod(plan.windowStart, plan.windowEnd)}</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>{plan.scopeText}</dd>
          </div>
          <div>
            <dt>Thresholds (pre-registered)</dt>
            <dd>{plan.thresholdsText.join(' · ')}</dd>
          </div>
        </dl>
      ) : null}
      <div className="ws8d-grid" style={{ gap: 8 }}>
        {v.conditions.map((c) => (
          <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ConditionItem
              conditionKey={c.key}
              text={c.text}
              owner={c.owner.displayName}
              due={c.dueRule ?? fmtDate(c.dueOn, { year: false })}
              flag={c.flag}
              status={c.status}
            />
            {c.status === 'open' && c.flag === 'blocks_execution' ? (
              <div>
                <Button
                  variant="secondary"
                  icon="check"
                  disabled={!canOperate}
                  disabledReason={`Only the condition owner, ${c.owner.displayName}, can mark it met.`}
                  onClick={() => onMarkMet(c)}
                >
                  {`Mark ${c.key} met`}
                </Button>
              </div>
            ) : c.metEvidence ? (
              <p className="ws8d-muted">
                Evidence: {c.metEvidence}
                {c.metAt ? ` · ${fmtDateTime(c.metAt)}` : ''}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <div className="ws8d-row">
        <Button variant="secondary" icon="pencil" onClick={onScope}>
          Request scope change
        </Button>
        <Button variant="secondary" icon="alert" onClick={onBlocker}>
          Report blocker
        </Button>
        <span className="ws8d-muted">Changing budget, sites or dates needs a new authorization.</span>
      </div>
    </section>
  );
}

function BudgetMeterView({ v }: { v: View }) {
  const b = v.budget;
  if (!b) {
    return (
      <section className="ws8d-section" aria-labelledby="pilot-budget">
        <h2 id="pilot-budget">Budget</h2>
        <p className="ws8d-note">{formatNotAvailable('no approved budget yet')}</p>
      </section>
    );
  }
  const committed = share(b.committed, b.approved);
  const spent = share(b.spent, b.approved);
  const label = `Approved ${moneyText(b.approved)}, committed ${moneyText(b.committed)}, spent ${moneyText(b.spent)}, remaining ${moneyText(b.remaining)}`;
  return (
    <section className="ws8d-section" aria-labelledby="pilot-budget">
      <div className="ws8d-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 id="pilot-budget">Budget · G2 · v{v.baseline?.snapshotVersion ?? '—'}</h2>
        <span className="ws8d-sub">
          As of {fmtDate(b.asOf)} · {b.approved.currency}
        </span>
      </div>
      <div className="ws8d-meter" role="img" aria-label={label}>
        <span className="ws8d-meter__spent" style={{ width: `${spent}%` }} />
        <span className="ws8d-meter__committed" style={{ width: `${Math.max(0, committed - spent)}%` }} />
      </div>
      <dl className="ws8d-budget">
        {(
          [
            ['Approved', b.approved],
            ['Committed', b.committed],
            ['Spent', b.spent],
            ['Remaining', b.remaining],
          ] as const
        ).map(([k, m]) => (
          <div key={k}>
            <dt className="ws8d-sub">{k}</dt>
            <dd>{moneyText(m)}</dd>
          </div>
        ))}
      </dl>
      <p className="ws8d-muted">{b.note}</p>
    </section>
  );
}

function PreviewPanel({
  p,
  busy,
  onCreate,
  onBack,
}: {
  p: TaskSyncPreview;
  busy: boolean;
  onCreate: () => void;
  onBack: () => void;
}) {
  const ready = p.problems.length === 0 && p.connectionStatus === 'connected';
  return (
    <section className="ws8d-section ws8d-section--info" aria-labelledby="pilot-preview">
      <div className="ws8d-row">
        <span style={{ color: 'var(--info-fg)', display: 'inline-flex' }}>
          <Icon name="eye" size={16} />
        </span>
        <h2 id="pilot-preview">Preview · nothing has been sent</h2>
      </div>
      <dl className="ws8d-meta">
        <dt>Destination</dt>
        <dd>
          {p.destination.tool} · project <Mono strong>{p.destination.project}</Mono>
          {p.destination.projectName ? ` · ${p.destination.projectName}` : ''}
        </dd>
        <dt>Will create</dt>
        <dd>
          {p.willCreate} issues, {p.linkText}
        </dd>
        <dt>Assignees</dt>
        <dd>{p.assigneesText}</dd>
        <dt>Permissions</dt>
        <dd>{p.permissionsText}</dd>
        <dt>Repeats</dt>
        <dd>{p.repeatsText}</dd>
      </dl>
      {p.problems.length ? (
        <Banner
          tone="warn"
          title="Fix before creating"
          body={
            <ul className="ws8d-list">
              {p.problems.map((x) => (
                <li key={x.key}>{x.message}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      <div className="ws8d-row">
        <Button
          variant="primary"
          icon="send"
          disabled={!ready || busy}
          disabledReason={busy ? 'Sending…' : 'Resolve the problems above first.'}
          onClick={onCreate}
        >
          {`Create ${p.willCreate} tasks in ${p.destination.tool}`}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function DialogFrame({
  label,
  onClose,
  children,
  actions,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Modal label={label} onClose={onClose}>
      <div className="ws8d-dialog">
        <h2>{label}</h2>
        {children}
        <div className="ws8d-row">{actions}</div>
      </div>
    </Modal>
  );
}

function ConfirmDialog({
  title,
  body,
  confirm,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  confirm: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogFrame
      label={title}
      onClose={onClose}
      actions={
        <>
          <Button variant="primary" disabled={busy} disabledReason="Working…" onClick={onConfirm}>
            {confirm}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <p className="ws8d-note" style={{ margin: 0 }}>
        {body}
      </p>
    </DialogFrame>
  );
}

function OwnerDialog({
  v,
  task,
  people,
  caseRef,
  onClose,
  onDone,
}: {
  v: View;
  task: Task;
  people: PersonRef[];
  caseRef: string;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const [owner, setOwner] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const save = useCommand(API.pilot.saveDraft);
  const submit = async () => {
    if (!owner || !v.draft || !v.taskSet) return;
    setErr(null);
    try {
      await save.mutateAsync({
        params: { caseRef },
        ifMatch: v.draft.rowVersion,
        body: {
          tasks: v.taskSet.tasks.map((t) => ({
            id: t.id,
            title: t.title,
            milestoneId: t.milestoneId,
            function: t.function,
            ownerId: t.id === task.id ? owner : (t.owner?.id ?? null),
            dependsOnTaskIds: t.dependsOnTaskIds,
            dueOn: t.dueOn,
            dueRule: t.dueRule,
            deliverable: t.deliverable,
            conditionKey: t.conditionKey,
          })),
        },
      });
      onDone(people.find((p) => p.id === owner)?.displayName ?? 'Owner');
      onClose();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <DialogFrame
      label={`Assign owner · ${task.title}`}
      onClose={onClose}
      actions={
        <>
          <Button
            variant="primary"
            disabled={!owner || save.isPending}
            disabledReason={!owner ? 'Choose one accountable owner.' : 'Saving…'}
            onClick={submit}
          >
            Save owner
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <OwnerPicker
        label="Accountable owner"
        required
        value={owner}
        onChange={setOwner}
        options={people}
        hint="One accountable person. Ownership never grants approval."
      />
      {err ? <ProblemBanner error={err} /> : null}
    </DialogFrame>
  );
}

function ConditionDialog({
  condition,
  onClose,
  onDone,
}: {
  condition: Condition;
  onClose: () => void;
  onDone: () => void;
}) {
  const [evidence, setEvidence] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.gates.markConditionMet);
  const submit = async () => {
    setErr(null);
    try {
      await cmd.mutateAsync({ params: { id: condition.id }, body: { evidence: evidence.trim() } });
      onDone();
      onClose();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <DialogFrame
      label={`Mark ${condition.key} met`}
      onClose={onClose}
      actions={
        <>
          <Button
            variant="primary"
            disabled={!evidence.trim() || cmd.isPending}
            disabledReason={!evidence.trim() ? 'Evidence is required.' : 'Saving…'}
            onClick={submit}
          >
            {`Mark ${condition.key} met`}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <p className="ws8d-note" style={{ margin: 0 }}>
        {condition.key} · {condition.text}
      </p>
      <TextAreaField label="Evidence" required value={evidence} onChange={setEvidence} />
      {err ? <ProblemBanner error={err} /> : null}
    </DialogFrame>
  );
}

function ScopeDialog({
  caseRef,
  onClose,
  onDone,
}: {
  caseRef: string;
  onClose: () => void;
  onDone: (n: string) => void;
}) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.pilot.requestScopeChange);
  const submit = async () => {
    try {
      await cmd.mutateAsync({
        params: { caseRef },
        body: { description: text.trim(), requestedChanges: {} },
      });
      onDone('Scope change requested · it needs a new authorization before anything changes.');
      onClose();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <DialogFrame
      label="Request scope change"
      onClose={onClose}
      actions={
        <>
          <Button
            variant="primary"
            disabled={!text.trim() || cmd.isPending}
            disabledReason="Describe the change first."
            onClick={submit}
          >
            Request scope change
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <p className="ws8d-note" style={{ margin: 0 }}>
        Changing budget, sites or dates needs a new authorization. The current plan keeps running.
      </p>
      <TextAreaField label="What should change and why?" required value={text} onChange={setText} />
      {err ? <ProblemBanner error={err} /> : null}
    </DialogFrame>
  );
}

function BlockerDialog({
  tasks,
  onClose,
  onDone,
}: {
  tasks: Task[];
  onClose: () => void;
  onDone: (n: string) => void;
}) {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? '');
  const [text, setText] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.pilot.reportBlocker);
  const submit = async () => {
    try {
      await cmd.mutateAsync({ params: { id: taskId }, body: { text: text.trim() } });
      onDone('Blocker reported · the case owner is notified.');
      onClose();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <DialogFrame
      label="Report blocker"
      onClose={onClose}
      actions={
        <>
          <Button
            variant="primary"
            disabled={!text.trim() || !taskId || cmd.isPending}
            disabledReason="Choose a task and describe the blocker."
            onClick={submit}
          >
            Report blocker
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <label className="ws8d-form" style={{ gap: 0 }}>
        Task
        <select className="ws8d-input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {`Task ${t.ordinal} · ${t.title}`}
            </option>
          ))}
        </select>
      </label>
      <TextAreaField label="What is blocking it?" required value={text} onChange={setText} />
      {err ? <ProblemBanner error={err} /> : null}
    </DialogFrame>
  );
}

function DraftDialog({
  draft,
  onClose,
  onDone,
}: {
  draft: View['messageDrafts'][number];
  onClose: () => void;
  onDone: (n: string) => void;
}) {
  const [body, setBody] = useState(draft.body);
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.pilot.updateMessageDraft);
  const changed = useMemo(() => body !== draft.body, [body, draft.body]);
  const submit = async () => {
    try {
      // Row version added by D-068; an API that predates it answers without one.
      await cmd.mutateAsync({ params: { id: draft.id }, body: { body }, ifMatch: draft.rowVersion ?? 0 });
      onDone('Draft saved · it stays a draft and is not sent.');
      onClose();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <DialogFrame
      label="Edit draft"
      onClose={onClose}
      actions={
        <>
          <Button
            variant="primary"
            disabled={!changed || cmd.isPending}
            disabledReason="No changes yet."
            onClick={submit}
          >
            Save draft
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <p className="ws8d-note" style={{ margin: 0 }}>
        {draft.title} · {draft.notice}
      </p>
      <TextAreaField label="Message" value={body} onChange={setBody} rows={5} />
      {err ? <ProblemBanner error={err} /> : null}
    </DialogFrame>
  );
}
