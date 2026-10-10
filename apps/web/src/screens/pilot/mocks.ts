/**
 * S11 Pilot mocks (WS8d). The case sits after Elena's G2 decision (27 Nov 2026, approved with C1
 * and C2). Journey (acceptance steps 21–24): task 2 has no owner → activation blocked; C1 open →
 * blocked; activate; preview 6 tasks for project PIL; create → permission fault on task 2
 * ("5 of 6 tasks confirmed in Jira · 1 failed (permission)"); retry only the failed task → 6 of 6.
 * Variants: timeout-after-success (Checking → Confirmed), expired connector (CSV export), approval
 * invalidated after activation (unsent tasks paused, sent tasks kept).
 *
 * Every response is validated against the contract by `mock()`.
 */
import {
  API,
  API_PREFIX,
  toFingerprint,
  type Blocker,
  type Condition,
  type PilotPlanView,
  type Task,
  type TaskSet,
  type TaskSyncPreview,
} from '@growth-os/contracts';
import {
  cases,
  fid,
  gates,
  journeyMoments as J,
  pilotBudget,
  pilotMilestones,
  pilotPreview,
  pilotTasks,
  people,
} from '@growth-os/fixtures-aster';
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { z } from 'zod';
import { G2_HASH, G2_SNAPSHOT_ID, hashFor, mockId, P, personRef } from '../../mocks/data';
import { mock, MockProblem, mswPath, problem } from '../../mocks/define';
import { session } from '../../mocks/state';
import { scoped } from '../mandate/mock-kit';
import { at, audit, save, ws8d, type TaskSyncState } from '../history/journey';

type In<S extends z.ZodTypeAny> = z.input<S>;

const ME104 = cases[0];
export const PILOT_PLAN_ID = mockId(1001);
export const TASK_SET_ID = mockId(1002);
const PLAN_VERSION_ID = mockId(1003);
const MESSAGE_DRAFT_ID = mockId(1005);
const C1_ID = fid('condition', 1);
const C2_ID = fid('condition', 2);
const TASK2_ID = pilotTasks[1].id;
const PERMISSION_MESSAGE = 'assignee [Operations lead] is not a member of project PIL';

const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');
const isMe104 = (ref: string) => ref === ME104.key || ref === ME104.id;
/** taskSync.* is shared with the validation mocks (VAL task set); these claim the PIL set only. */
const ownsPilotTaskSet = (p: Record<string, string>) => p.id === TASK_SET_ID;

function requireCase(ref: string) {
  if (!isMe104(ref)) throw notFound();
}

/** Pilot owner acts on the plan; the case owner may edit the draft; admins never act. */
function requirePilotOwner(viewerId: string | null, what: string) {
  if (viewerId === people.admin.id)
    throw new MockProblem('FORBIDDEN', 'Administrators configure settings and never run pilots.');
  if (viewerId !== people.jonas.id)
    throw new MockProblem('FORBIDDEN', `Only the pilot owner, Jonas Klein, can ${what}.`);
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

const activated = () => ws8d().activatedAt !== null;
const invalidated = () => ws8d().pilotVariant === 'invalidated';
const expired = () => ws8d().pilotVariant === 'expired';

function conditions(): In<typeof Condition>[] {
  const s = ws8d();
  return gates.g2.conditions.map((c, i) => {
    const met = c.key === 'C1' && s.c1Evidence !== null;
    return {
      id: i === 0 ? C1_ID : C2_ID,
      key: c.key,
      text: c.text,
      owner: personRef(c.ownerId),
      dueOn: c.dueOn,
      dueRule: c.dueRule,
      flag: c.blocksExecution ? 'blocks_execution' : 'monitor_only',
      status: met ? 'met' : 'open',
      addedBy: P('maya'),
      metEvidence: met ? s.c1Evidence : null,
      metAt: met ? s.c1MetAt : null,
    };
  });
}

function syncFor(taskId: string): TaskSyncState {
  const s = ws8d();
  const existing = s.sync[taskId];
  if (existing) return existing;
  return {
    status: 'not_sent',
    externalKey: null,
    attempts: 0,
    lastErrorCode: expired() ? 'token_expired' : null,
    lastErrorMessage: expired() ? 'connection expired' : null,
    retryable: false,
    confirmedAt: null,
    checkingReads: 0,
  };
}

function taskOwnerId(t: (typeof pilotTasks)[number]): string | null {
  return t.id === TASK2_ID ? ws8d().task2OwnerId : t.ownerId;
}

export function tasks(): In<typeof Task>[] {
  const s = ws8d();
  return pilotTasks.map((t) => {
    const m = pilotMilestones[t.milestone - 1]!;
    const ownerId = taskOwnerId(t);
    const sync = syncFor(t.id);
    const deps = t.dependsOn as readonly number[];
    return {
      id: t.id,
      caseId: ME104.id,
      taskSetId: TASK_SET_ID,
      ordinal: t.ordinal,
      title: t.title,
      milestoneId: m.id,
      milestoneLabel: `${m.name} · ${m.windowText}`,
      function: t.function,
      owner: ownerId ? personRef(ownerId) : null,
      dependsOnTaskIds: deps.map((n) => fid('task', n)),
      dependsOnLabel:
        deps.length === 0 ? '—' : deps.length === 1 ? `Task ${deps[0]}` : `Tasks ${deps.join(', ')}`,
      dueOn: t.dueOn,
      dueRule: t.dueRule,
      deliverable: t.deliverable,
      conditionKey: 'conditionKey' in t ? t.conditionKey : null,
      status:
        s.taskStatus?.[t.id]?.status ??
        (s.blockedTasks[t.id] ? 'blocked' : activated() && t.ordinal === 1 ? 'in_progress' : 'not_started'),
      sync: {
        status: sync.status,
        connectionId: fid('connection', 2),
        externalKey: sync.externalKey,
        externalUrl: sync.externalKey ? `https://jira.simulated.example/browse/${sync.externalKey}` : null,
        attempts: sync.attempts,
        lastErrorCode: sync.lastErrorCode,
        lastErrorMessage: sync.lastErrorMessage,
        retryable: sync.retryable,
        confirmedAt: sync.confirmedAt,
      },
      rowVersion: s.taskStatus?.[t.id]?.rowVersion ?? 1,
    };
  });
}

const ERROR_REASON: Record<string, string> = {
  permission_denied: 'permission',
  timeout: 'timeout',
  token_expired: 'connection expired',
  http_5xx: 'Jira unavailable',
};

/** Honest summary: counts what the connector confirmed; never "Synced". */
export function taskSet(): In<typeof TaskSet> {
  const list = tasks();
  const by = (st: string[]) => list.filter((t) => st.includes(t.sync.status));
  const confirmed = list.filter((t) => t.sync.status === 'confirmed' && t.sync.externalKey).length;
  const failed = by(['failed']);
  const checking = by(['checking', 'sending', 'retry_scheduled']);
  const paused = by(['paused_approval_changed', 'paused_connector']);
  const pending = by(['not_sent', 'in_preview', 'sending', 'checking', 'retry_scheduled']).length;
  const total = list.length;
  const anySent = list.some((t) => t.sync.attempts > 0);
  let text: string;
  if (!anySent) text = `${total} tasks · not sent to Jira yet`;
  else {
    const parts = [`${confirmed} of ${total} tasks confirmed in Jira`];
    if (failed.length) {
      const reason = ERROR_REASON[failed[0]!.sync.lastErrorCode ?? ''] ?? 'error';
      parts.push(`${failed.length} failed (${reason})`);
    }
    if (checking.length) parts.push(`${checking.length} checking`);
    if (paused.length) parts.push(`${paused.length} paused — approval changed`);
    text = parts.join(' · ');
  }
  return {
    id: TASK_SET_ID,
    caseId: ME104.id,
    ownerType: 'pilot_plan_version',
    ownerId: PLAN_VERSION_ID,
    authorizingGateRequestId: gates.g2.id,
    connectionId: fid('connection', 2),
    destinationLabel: 'Jira · project PIL · Aster Pilots',
    tasks: list,
    summary: { total, confirmed, failed: failed.length, pending, paused: paused.length },
    summaryText: text,
  };
}

function blockers(): Blocker[] {
  if (activated()) return [];
  const s = ws8d();
  const out: Blocker[] = [];
  if (!s.task2OwnerId) {
    out.push({
      key: 'all_tasks_owned',
      message: '“Install monitoring at 4 sites” has no accountable owner. Assign one to activate the plan.',
      href: `/me/cases/${ME104.key}/pilot?task=${pilotTasks[1].id}`,
    });
  }
  if (!s.c1Evidence) {
    out.push({
      key: 'blocking_conditions_met',
      message:
        'Condition C1 blocks execution until met: Pilot limited to 4 sites as signed by the specialist.',
      gate: 'G2',
      ownerId: people.jonas.id,
    });
  }
  return out;
}

const money = (
  amount: string,
  measure: 'approved_budget' | 'committed_spend' | 'spent_to_date' | 'remaining_budget',
) => ({
  amount,
  currency: pilotBudget.currency,
  measure,
  timeBasis: 'budget' as const,
});

function planVersion(state: 'draft' | 'committed') {
  return {
    id: state === 'committed' ? PLAN_VERSION_ID : mockId(1004),
    pilotPlanId: PILOT_PLAN_ID,
    version: 1,
    state,
    baselineSnapshotId: G2_SNAPSHOT_ID,
    budgetCeiling: gates.g2.amount,
    currency: gates.g2.currency,
    windowStart: gates.g2.windowStart,
    windowEnd: gates.g2.windowEnd,
    scopeText: 'Up to 4 sites · Germany · food processing',
    thresholdsText: ['Paid use and continuation: 4 of 4', 'Deployment effort within [hours per site]'],
    milestones: pilotMilestones.map((m) => ({ ...m })),
    rowVersion: ws8d().draftRowVersion,
  };
}

export function pilotView(): In<typeof PilotPlanView> {
  return {
    pilotPlanId: PILOT_PLAN_ID,
    status: !activated() ? 'ready' : invalidated() ? 'paused' : 'active',
    baseline: {
      gateRequestId: gates.g2.id,
      snapshotId: G2_SNAPSHOT_ID,
      snapshotVersion: 3,
      fingerprint: toFingerprint(G2_HASH),
      approvedAt: J.g2Approved,
      statusText: invalidated()
        ? 'G2 · Invalidated · spend ceiling changed · 4 Dec'
        : 'G2 · Approved with conditions · 27 Nov',
    },
    current: activated() ? planVersion('committed') : null,
    draft: activated() ? null : planVersion('draft'),
    conditions: conditions(),
    budget: {
      gateRequestId: gates.g2.id,
      asOf: pilotBudget.asOf,
      approved: money(pilotBudget.approved, 'approved_budget'),
      committed: money(pilotBudget.committed, 'committed_spend'),
      spent: money(pilotBudget.spent, 'spent_to_date'),
      remaining: money(pilotBudget.approved, 'remaining_budget'),
      note: 'Spend above €120k is blocked without a scope-change request.',
    },
    taskSet: taskSet(),
    activationBlockers: blockers(),
    messageDrafts: [messageDraft()],
    connectorBanner: expired()
      ? {
          status: 'expired',
          title: 'Jira connection expired · 30 Nov',
          body: 'Internal tasks stay active and tracked here. Ask your administrator to reconnect, or export CSV.',
        }
      : null,
  };
}

function messageDraft() {
  const d = ws8d().messageDraft;
  return {
    id: MESSAGE_DRAFT_ID,
    caseId: ME104.id,
    title: d.title,
    body: d.body,
    origin: d.origin,
    status: 'draft' as const,
    notice: 'Draft — not authorized to send' as const,
    rowVersion: d.rowVersion,
  };
}

// ---------------------------------------------------------------------------
// Sync behaviour (simulated connector with one fault per variant)
// ---------------------------------------------------------------------------

/** A read while "checking": the reconcile finds the issue on the second read (no resend). */
/**
 * A task in Checking is reconciled (found by its idempotency key) on the second read that comes at
 * least RECONCILE_MS after the timeout, so the screen always shows "Checking" before "Confirmed"
 * (the post-send refetch alone never confirms it).
 */
export const RECONCILE_MS = 1500;

function advanceChecking() {
  const s = ws8d();
  let changed = false;
  for (const t of pilotTasks) {
    const st = s.sync[t.id];
    if (st?.status !== 'checking') continue;
    st.checkingReads += 1;
    if (st.checkingReads >= 2 && Date.now() - (st.checkingSince ?? 0) >= RECONCILE_MS) {
      st.status = 'confirmed';
      st.externalKey = t.externalKey;
      st.confirmedAt = at(J.pilotActivated);
      st.lastErrorCode = null;
      st.lastErrorMessage = null;
      st.retryable = false;
      confirmedAudit(t.id, t.title, t.externalKey, st.attempts, 'reconciled after a timeout');
    }
    changed = true;
  }
  if (changed) save();
}

function confirmedAudit(id: string, title: string, key: string, attempt: number, how?: string) {
  audit({
    at: at(J.pilotActivated),
    actorId: null,
    actorKind: 'system',
    actorRole: null,
    action: 'external_task.confirmed',
    objectType: 'task',
    objectId: id,
    objectVersion: attempt,
    summary: `Confirmed in Jira · ${key} · “${title}”${how ? ` · ${how}` : ''}`,
    rule: 'outbox.dispatch',
  });
}

function sendOne(t: (typeof pilotTasks)[number]) {
  const s = ws8d();
  const st = syncFor(t.id);
  st.attempts += 1;
  if (s.permissionFaultArmed && t.id === TASK2_ID) {
    s.permissionFaultArmed = false;
    Object.assign(st, {
      status: 'failed',
      lastErrorCode: 'permission_denied',
      lastErrorMessage: PERMISSION_MESSAGE,
      retryable: true,
    });
    audit({
      at: at(J.pilotActivated),
      actorId: null,
      actorKind: 'system',
      actorRole: null,
      action: 'external_task.failed',
      objectType: 'task',
      objectId: t.id,
      objectVersion: st.attempts,
      summary: `Not created in Jira · “${t.title}” · ${PERMISSION_MESSAGE}`,
      rule: 'outbox.dispatch',
    });
  } else if (s.timeoutFaultArmed && t.ordinal === 4) {
    s.timeoutFaultArmed = false;
    Object.assign(st, {
      status: 'checking',
      lastErrorCode: 'timeout',
      lastErrorMessage: 'Jira did not answer in time · checking before any retry',
      retryable: false,
      checkingReads: 0,
      checkingSince: Date.now(),
    });
  } else {
    Object.assign(st, {
      status: 'confirmed',
      externalKey: t.externalKey,
      confirmedAt: at(J.pilotActivated),
      lastErrorCode: null,
      lastErrorMessage: null,
      retryable: false,
    });
    confirmedAudit(t.id, t.title, t.externalKey, st.attempts);
  }
  s.sync[t.id] = st;
}

function previewFor(): In<typeof TaskSyncPreview> {
  const s = ws8d();
  const n = (s.preview?.n ?? 0) + 1;
  const id = mockId(1100 + n);
  const hash = hashFor('A1B2·C3D4', n);
  s.preview = { id, hash, n };
  save();
  const created = at(J.pilotActivated);
  const expires = new Date(new Date(created).getTime() + 15 * 60_000).toISOString();
  return {
    id,
    taskSetId: TASK_SET_ID,
    planVersionId: PLAN_VERSION_ID,
    contentHash: hash,
    destination: { ...pilotPreview.destination },
    willCreate: pilotPreview.willCreate,
    linkText: pilotPreview.linkText,
    assigneesText: pilotPreview.assigneesText,
    permissionsText: pilotPreview.permissionsText,
    repeatsText: pilotPreview.repeatsText,
    items: tasks().map((t) => ({
      taskId: t.id,
      title: t.title,
      assignee: t.owner?.displayName ?? null,
      fields: { 'Issue type': 'Task', Due: t.dueRule ?? t.dueOn ?? '—', Link: 'ME-104 · G2 v3' },
    })),
    problems: [],
    connectionStatus: 'connected',
    createdAt: created,
    expiresAt: expires,
  };
}

function requireTaskSet(id: string) {
  if (id !== TASK_SET_ID) throw notFound();
}

function requireSendable() {
  if (!activated())
    throw new MockProblem('INVALID_TRANSITION', 'Activate the approved plan before creating external tasks.');
  if (expired()) throw new MockProblem('CONNECTOR_UNAVAILABLE', 'Jira connection expired. Nothing was sent.');
  if (invalidated())
    throw new MockProblem(
      'APPROVAL_INVALIDATED',
      'The G2 approval changed. Sending is paused until a new authorization.',
    );
}

/** Variant seeding that needs task ids (sent tasks kept, unsent paused). */
function ensureVariantSync() {
  const s = ws8d();
  if (s.pilotVariant !== 'invalidated' || Object.keys(s.sync).length) return;
  for (const t of pilotTasks) {
    const sent = t.ordinal === 1 || t.ordinal === 3;
    s.sync[t.id] = {
      status: sent ? 'confirmed' : 'paused_approval_changed',
      externalKey: sent ? t.externalKey : null,
      attempts: sent ? 1 : 0,
      lastErrorCode: sent ? null : 'approval_invalidated',
      lastErrorMessage: sent ? null : 'approval changed · not sent',
      retryable: false,
      confirmedAt: sent ? '2026-12-01T09:41:00+01:00' : null,
      checkingReads: 0,
    };
  }
  save();
}

function readView() {
  ensureVariantSync();
  advanceChecking();
  return pilotView();
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const handlers: HttpHandler[] = [
  mock(API.pilot.get, ({ params }) => {
    requireCase(params.caseRef);
    return readView();
  }),

  mock(API.pilot.saveDraft, ({ params, body, viewerId, ifMatch }) => {
    requireCase(params.caseRef);
    if (viewerId !== people.jonas.id && viewerId !== people.maya.id)
      throw new MockProblem('FORBIDDEN', 'Only the pilot owner or case owner can edit the plan draft.');
    const s = ws8d();
    if (activated())
      throw new MockProblem('INVALID_TRANSITION', 'The plan is active. Changes need a scope-change request.');
    if (ifMatch !== s.draftRowVersion)
      throw new MockProblem('VERSION_CONFLICT', 'Someone saved a newer version of the plan.');
    const t2 = body.tasks?.find((t) => t.id === TASK2_ID);
    if (t2) {
      const before = s.task2OwnerId;
      s.task2OwnerId = t2.ownerId;
      if (t2.ownerId && t2.ownerId !== before) {
        audit({
          at: at(J.pilotActivated, 1),
          actorId: viewerId,
          actorKind: 'human',
          actorRole: viewerId === people.jonas.id ? 'pilot_owner' : 'case_owner',
          action: 'pilot_plan.task_owner_set',
          objectType: 'pilot_plan_version',
          objectId: mockId(1004),
          objectVersion: 1,
          summary: `Assigned ${personRef(t2.ownerId).displayName} to “Install monitoring at 4 sites”`,
          rule: 'pilot.edit_draft',
        });
      }
    }
    s.draftRowVersion += 1;
    save();
    return pilotView();
  }),

  mock(API.gates.markConditionMet, ({ params, body, viewerId }) => {
    if (params.id !== C1_ID && params.id !== C2_ID) throw notFound();
    if (viewerId !== people.jonas.id)
      throw new MockProblem('FORBIDDEN', 'Only the condition owner, Jonas Klein, can mark it met.');
    if (params.id === C2_ID)
      throw new MockProblem('INVALID_TRANSITION', 'C2 is a monitor-only condition; it is tracked weekly.');
    const s = ws8d();
    if (!s.c1Evidence) {
      s.c1Evidence = body.evidence;
      s.c1MetAt = at(J.pilotActivated, 1);
      audit({
        at: s.c1MetAt,
        actorId: viewerId,
        actorKind: 'human',
        actorRole: 'pilot_owner',
        action: 'condition.met',
        objectType: 'condition',
        objectId: C1_ID,
        objectVersion: 1,
        summary: 'Marked C1 met · Pilot limited to 4 sites as signed by the specialist',
        rule: 'condition.owner',
      });
      save();
    }
    return conditions()[0]!;
  }),

  mock(API.pilot.activate, ({ params, viewerId }) => {
    requireCase(params.caseRef);
    requirePilotOwner(viewerId, 'activate the plan');
    const s = ws8d();
    if (activated()) return pilotView();
    const b = blockers();
    if (b.length) throw new MockProblem('PRECONDITIONS_UNMET', 'Activation is blocked.', { blockers: b });
    s.activatedAt = at(J.pilotActivated, 1);
    audit({
      at: s.activatedAt,
      actorId: viewerId,
      actorKind: 'human',
      actorRole: 'pilot_owner',
      action: 'pilot_plan.activated',
      objectType: 'pilot_plan_version',
      objectId: PLAN_VERSION_ID,
      objectVersion: 1,
      summary: 'Activated the approved pilot plan v1 · stage Pilot running',
      rule: 'pilot.activate',
    });
    save();
    return pilotView();
  }),

  mock(API.pilot.messageDrafts, ({ params }) => {
    requireCase(params.caseRef);
    return { items: [messageDraft()] };
  }),

  mock(API.pilot.updateMessageDraft, ({ params, body, viewerId, ifMatch }) => {
    if (params.id !== MESSAGE_DRAFT_ID) throw notFound();
    if (viewerId === people.admin.id)
      throw new MockProblem('FORBIDDEN', 'Administrators cannot edit drafts.');
    const d = ws8d().messageDraft;
    if (ifMatch !== d.rowVersion)
      throw new MockProblem('VERSION_CONFLICT', 'Someone saved this draft. Reload to see the latest.');
    if (body.title !== undefined) d.title = body.title;
    if (body.body !== undefined) d.body = body.body;
    if (d.origin === 'ai') d.origin = 'ai_edited';
    d.rowVersion += 1;
    save();
    return messageDraft();
  }),

  mock(API.pilot.requestScopeChange, ({ params, body, viewerId }) => {
    requireCase(params.caseRef);
    if (viewerId === people.admin.id)
      throw new MockProblem('FORBIDDEN', 'Administrators cannot request scope changes.');
    const s = ws8d();
    s.scopeChanges += 1;
    const createdAt = at(J.pilotActivated, 1);
    audit({
      at: createdAt,
      actorId: viewerId,
      actorKind: 'human',
      actorRole: viewerId === people.jonas.id ? 'pilot_owner' : 'case_owner',
      action: 'scope_change.requested',
      objectType: 'scope_change_request',
      objectId: mockId(1200 + s.scopeChanges),
      objectVersion: null,
      summary: 'Requested a scope change · needs a new authorization',
      rule: 'pilot.scope_change',
    });
    save();
    return {
      id: mockId(1200 + s.scopeChanges),
      caseId: ME104.id,
      requestedBy: personRef(viewerId!),
      description: body.description,
      requestedChanges: body.requestedChanges,
      status: 'open' as const,
      gateRequestId: null,
      createdAt,
    };
  }),

  // tasks.update (S11, My Work): internal status only; never changes sync status or passes a gate.
  mock(API.pilot.updateTask, ({ params, body, viewerId, ifMatch }) => {
    const t = tasks().find((x) => x.id === params.id);
    if (!t) throw notFound();
    if (viewerId === people.admin.id)
      throw new MockProblem('FORBIDDEN', 'Administrators cannot change task status.');
    if (viewerId !== t.owner?.id && viewerId !== people.jonas.id && viewerId !== people.maya.id)
      throw new MockProblem(
        'FORBIDDEN',
        'Only the task owner, the pilot owner or the case owner can update it.',
      );
    if (ifMatch !== t.rowVersion)
      throw new MockProblem('VERSION_CONFLICT', 'Someone updated this task. Reload to see the latest.');
    const st = ws8d();
    const status = body.status ?? t.status;
    if (status !== 'blocked') delete st.blockedTasks[t.id];
    (st.taskStatus ??= {})[t.id] = { status, rowVersion: t.rowVersion + 1 };
    audit({
      at: at(J.pilotActivated, 1),
      actorId: viewerId,
      actorKind: 'human',
      actorRole: viewerId === people.jonas.id ? 'pilot_owner' : null,
      action: 'task.updated',
      objectType: 'task',
      objectId: t.id,
      objectVersion: t.rowVersion + 1,
      summary: `Set “${t.title}” to ${status.replace(/_/g, ' ')}`,
      rule: 'task.update',
    });
    save();
    return tasks().find((x) => x.id === params.id)!;
  }),

  mock(API.pilot.reportBlocker, ({ params, body, viewerId }) => {
    const t = tasks().find((x) => x.id === params.id);
    if (!t) throw notFound();
    if (viewerId === people.admin.id)
      throw new MockProblem('FORBIDDEN', 'Administrators cannot report blockers.');
    const st = ws8d();
    st.blockedTasks[t.id] = body.text;
    (st.taskStatus ??= {})[t.id] = { status: 'blocked', rowVersion: t.rowVersion + 1 };
    audit({
      at: at(J.pilotActivated, 1),
      actorId: viewerId,
      actorKind: 'human',
      actorRole: viewerId === people.jonas.id ? 'pilot_owner' : null,
      action: 'task.blocker_reported',
      objectType: 'task',
      objectId: t.id,
      objectVersion: 1,
      summary: `Reported a blocker on “${t.title}”`,
      rule: 'task.update',
    });
    save();
    return tasks().find((x) => x.id === params.id)!;
  }),

  scoped(
    API.taskSync.get,
    ownsPilotTaskSet,
    mock(API.taskSync.get, ({ params }) => {
      requireTaskSet(params.id);
      ensureVariantSync();
      advanceChecking();
      return taskSet();
    }),
  ),

  scoped(
    API.taskSync.preview,
    ownsPilotTaskSet,
    mock(API.taskSync.preview, ({ params, viewerId }) => {
      requireTaskSet(params.id);
      requirePilotOwner(viewerId, 'preview external tasks');
      requireSendable();
      return previewFor();
    }),
  ),

  scoped(
    API.taskSync.send,
    ownsPilotTaskSet,
    mock(API.taskSync.send, ({ params, body, viewerId }) => {
      requireTaskSet(params.id);
      requirePilotOwner(viewerId, 'create external tasks');
      requireSendable();
      const s = ws8d();
      if (!s.preview || s.preview.id !== body.previewId || s.preview.hash !== body.previewHash)
        throw new MockProblem('PRECONDITIONS_UNMET', 'Preview the tasks again before creating them.', {
          blockers: [{ key: 'preview_current', message: 'The preview is not current.' }],
        });
      audit({
        at: at(J.pilotActivated, 1),
        actorId: viewerId,
        actorKind: 'human',
        actorRole: 'pilot_owner',
        action: 'task_set.send_requested',
        objectType: 'task_set',
        objectId: TASK_SET_ID,
        objectVersion: s.preview.n,
        summary: 'Created 6 tasks in Jira project PIL from preview',
        rule: 'task_sync.send',
      });
      for (const t of pilotTasks) {
        const st = syncFor(t.id);
        if (st.status === 'confirmed' || st.status === 'checking') continue; // never re-sent
        sendOne(t);
      }
      save();
      return taskSet();
    }),
  ),

  scoped(
    API.taskSync.retry,
    ownsPilotTaskSet,
    mock(API.taskSync.retry, ({ params, body, viewerId }) => {
      requireTaskSet(params.id);
      requirePilotOwner(viewerId, 'retry external tasks');
      requireSendable();
      const s = ws8d();
      const failed = pilotTasks.filter((t) => s.sync[t.id]?.status === 'failed');
      const chosen = body.taskIds?.length ? failed.filter((t) => body.taskIds!.includes(t.id)) : failed;
      audit({
        at: at(J.pilotActivated, 1),
        actorId: viewerId,
        actorKind: 'human',
        actorRole: 'pilot_owner',
        action: 'task_set.retry_requested',
        objectType: 'task_set',
        objectId: TASK_SET_ID,
        objectVersion: null,
        summary: `Retried ${chosen.length} failed task${chosen.length === 1 ? '' : 's'} · same references`,
        rule: 'task_sync.retry',
      });
      for (const t of chosen) sendOne(t);
      save();
      return taskSet();
    }),
  ),

  // CSV export (outage fallback). Not JSON, so it is a raw handler with the same session rule.
  http.get(mswPath(API.taskSync.exportCsv), ({ params }) => {
    if (!session.viewerId) return problem('UNAUTHENTICATED', 'Sign in to continue.');
    if (params.id !== TASK_SET_ID) return problem('NOT_FOUND', 'Not found.');
    const rows = tasks().map((t) =>
      [
        t.ordinal,
        t.title,
        t.milestoneLabel ?? '',
        t.owner?.displayName ?? 'Unassigned',
        t.dependsOnLabel,
        t.dueRule ?? t.dueOn ?? '',
        t.deliverable,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = ['Task,Title,Milestone,Owner,Depends on,Due,Deliverable', ...rows].join('\n');
    return new HttpResponse(csv, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
  }),
];

/** Path of the CSV export (for tests). */
export const EXPORT_PATH = `${API_PREFIX}/me/task-sets/${TASK_SET_ID}/export.csv`;
