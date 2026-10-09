/**
 * Read models for S11: pilot plan view, task set (internal status and honest external sync status kept
 * separate), budget meter, activation blockers.
 */
import type {
  Blocker,
  BudgetMeter,
  MessageDraft,
  PilotPlanVersion,
  PilotPlanView,
  Task,
  TaskSet,
} from '@growth-os/contracts';
import { GATE_STATUS_LABELS, toFingerprint } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { caseMachine, type ApprovalEffectiveness } from '@growth-os/domain';
import { isoDate, isoDateOrNull, isoDateTime, isoDateTimeOrNull } from '../../../platform/serialize';
import {
  approvalEffectiveness,
  cents,
  fromCents,
  peopleOf,
  shortDate,
  type CaseLite,
  type People,
} from '../gates/lib/common';
import { conditionRows, toCondition } from '../gates/lib/serialize';

export async function pilotPlanOf(tx: Tx, caseId: string) {
  return tx.selectFrom('me.pilot_plan').selectAll().where('case_id', '=', caseId).executeTakeFirst();
}
export type PilotPlanRow = NonNullable<Awaited<ReturnType<typeof pilotPlanOf>>>;

export async function versionById(tx: Tx, id: string | null) {
  if (!id) return undefined;
  return tx.selectFrom('me.pilot_plan_version').selectAll().where('id', '=', id).executeTakeFirst();
}
export type VersionRow = NonNullable<Awaited<ReturnType<typeof versionById>>>;

async function toVersion(tx: Tx, v: VersionRow): Promise<PilotPlanVersion> {
  const ms = v.task_set_id
    ? await tx
        .selectFrom('platform.milestone')
        .selectAll()
        .where('task_set_id', '=', v.task_set_id)
        .orderBy('ordinal')
        .execute()
    : [];
  return {
    id: v.id,
    pilotPlanId: v.pilot_plan_id,
    version: v.version,
    state: v.state as PilotPlanVersion['state'],
    baselineSnapshotId: v.baseline_snapshot_id,
    budgetCeiling: v.budget_ceiling,
    currency: v.currency,
    windowStart: isoDate(v.window_start as unknown as string),
    windowEnd: isoDate(v.window_end as unknown as string),
    scopeText: v.scope_text,
    thresholdsText: v.thresholds_text,
    milestones: ms.map((m) => ({ id: m.id, name: m.name, windowText: m.window_text, ordinal: m.ordinal })),
    rowVersion: v.row_version,
  };
}

const PENDING = ['not_sent', 'in_preview', 'sending', 'retry_scheduled', 'checking'];
const PAUSED = ['paused_approval_changed', 'paused_connector'];

export async function taskRows(tx: Tx, taskSetId: string) {
  return tx
    .selectFrom('platform.task')
    .selectAll()
    .where('task_set_id', '=', taskSetId)
    .orderBy('ordinal')
    .execute();
}
export type TaskRow = Awaited<ReturnType<typeof taskRows>>[number];

export async function toTasks(tx: Tx, rows: TaskRow[], people?: People): Promise<Task[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [deps, links, ms] = await Promise.all([
    tx.selectFrom('platform.task_dependency').selectAll().where('task_id', 'in', ids).execute(),
    tx.selectFrom('platform.external_task_link').selectAll().where('task_id', 'in', ids).execute(),
    tx
      .selectFrom('platform.milestone')
      .selectAll()
      .where('task_set_id', 'in', [...new Set(rows.map((r) => r.task_set_id))])
      .execute(),
  ]);
  const p =
    people ??
    (await peopleOf(
      tx,
      rows.map((r) => r.owner_user_id),
    ));
  const ordinal = new Map(rows.map((r) => [r.id, r.ordinal]));
  return rows.map((t) => {
    const d = deps.filter((x) => x.task_id === t.id).map((x) => x.depends_on_task_id);
    const nums = d
      .map((x) => ordinal.get(x))
      .filter((x): x is number => x !== undefined)
      .sort((a, b) => a - b);
    const link = links.find((l) => l.task_id === t.id);
    const m = ms.find((x) => x.id === t.milestone_id);
    return {
      id: t.id,
      caseId: t.case_id,
      taskSetId: t.task_set_id,
      ordinal: t.ordinal,
      title: t.title,
      milestoneId: t.milestone_id,
      milestoneLabel: m ? `${m.name} · ${m.window_text}` : null,
      function: t.function as Task['function'],
      owner: t.owner_user_id ? p(t.owner_user_id) : null,
      dependsOnTaskIds: d,
      dependsOnLabel:
        nums.length === 0 ? '—' : nums.length === 1 ? `Task ${nums[0]}` : `Tasks ${nums.join(', ')}`,
      dueOn: isoDateOrNull(t.due_on as unknown as string | null),
      dueRule: t.due_rule,
      deliverable: t.deliverable,
      conditionKey: t.condition_key,
      status: t.status as Task['status'],
      sync: link
        ? {
            status: link.sync_status as Task['sync']['status'],
            connectionId: link.connection_id,
            externalKey: link.external_key,
            externalUrl: link.external_url,
            attempts: link.attempts,
            lastErrorCode: link.last_error_code,
            lastErrorMessage: link.last_error_message,
            retryable: link.retryable,
            confirmedAt: isoDateTimeOrNull(link.confirmed_at),
          }
        : {
            status: 'not_sent',
            connectionId: null,
            externalKey: null,
            externalUrl: null,
            attempts: 0,
            lastErrorCode: null,
            lastErrorMessage: null,
            retryable: true,
            confirmedAt: null,
          },
      rowVersion: t.row_version,
    };
  });
}

export async function taskSetView(tx: Tx, taskSetId: string): Promise<TaskSet | null> {
  const s = await tx
    .selectFrom('platform.task_set')
    .selectAll()
    .where('id', '=', taskSetId)
    .executeTakeFirst();
  if (!s) return null;
  const tasks = await toTasks(tx, await taskRows(tx, s.id));
  const conn = s.connection_id
    ? await tx
        .selectFrom('platform.connection')
        .select(['name', 'provider'])
        .where('id', '=', s.connection_id)
        .executeTakeFirst()
    : undefined;
  const mapping = s.mapping_id
    ? await tx
        .selectFrom('platform.connector_mapping')
        .select('destination_project')
        .where('id', '=', s.mapping_id)
        .executeTakeFirst()
    : undefined;
  const count = (f: (x: Task) => boolean) => tasks.filter(f).length;
  const confirmed = count((x) => x.sync.status === 'confirmed');
  const failed = count((x) => x.sync.status === 'failed');
  const paused = count((x) => PAUSED.includes(x.sync.status));
  const pending = count((x) => PENDING.includes(x.sync.status));
  const tool = conn?.provider?.startsWith('jira') ? 'Jira' : (conn?.name ?? 'the task tool');
  const anySent = tasks.some((x) => x.sync.status !== 'not_sent');
  return {
    id: s.id,
    caseId: s.case_id,
    ownerType: s.owner_type as TaskSet['ownerType'],
    ownerId: s.owner_id,
    authorizingGateRequestId: s.authorizing_gate_request_id,
    connectionId: s.connection_id,
    destinationLabel: conn ? `${tool}${mapping ? ` · project ${mapping.destination_project}` : ''}` : null,
    tasks,
    summary: { total: tasks.length, confirmed, failed, pending, paused },
    summaryText: !anySent
      ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} · not sent yet`
      : `${confirmed} of ${tasks.length} tasks confirmed in ${tool}${failed ? ` · ${failed} failed` : ''}${paused ? ` · ${paused} paused` : ''}`,
  };
}

/** Budget meter for an approved gate budget (one-time pilot money of one gate; never mixed). */
export async function budgetMeter(tx: Tx, gateRequestId: string, asOf: string): Promise<BudgetMeter | null> {
  const g = await tx
    .selectFrom('platform.gate_request')
    .select(['requested_amount', 'currency'])
    .where('id', '=', gateRequestId)
    .executeTakeFirst();
  if (!g?.requested_amount || !g.currency) return null;
  const entries = await tx
    .selectFrom('me.budget_entry')
    .select(['kind', 'amount', 'currency'])
    .where('gate_request_id', '=', gateRequestId)
    .execute();
  const sum = (k: string) => entries.filter((e) => e.kind === k).reduce((a, e) => a + cents(e.amount), 0n);
  const money = (
    amount: string,
    measure: 'approved_budget' | 'committed_spend' | 'spent_to_date' | 'remaining_budget',
  ) => ({
    amount,
    currency: g.currency!,
    measure,
    timeBasis: 'budget' as const,
  });
  const spent = sum('spent');
  return {
    gateRequestId,
    asOf,
    approved: money(g.requested_amount, 'approved_budget'),
    committed: money(fromCents(sum('committed')), 'committed_spend'),
    spent: money(fromCents(spent), 'spent_to_date'),
    remaining: money(fromCents(cents(g.requested_amount) - spent), 'remaining_budget'),
    note: `Spend above ${g.currency === 'EUR' ? '€' : g.currency + ' '}${g.requested_amount} is blocked without a scope-change request.`,
  };
}

export interface ActivationFacts {
  approval: ApprovalEffectiveness;
  blockingConditionsMet: boolean;
  allTasksOwned: boolean;
  blockers: Blocker[];
}

/** Activation facts and the "Why?" list: missing owners and open blocking conditions together. */
export async function activationFacts(
  tx: Tx,
  plan: PilotPlanRow,
  draft: VersionRow | undefined,
  now: Date,
): Promise<ActivationFacts> {
  const approval = await approvalEffectiveness(tx, plan.gate_request_id, now);
  const conds = plan.gate_request_id ? await conditionRows(tx, [plan.gate_request_id]) : [];
  const open = conds.filter((c) => c.blocks_execution && c.status === 'open');
  const tasks = draft?.task_set_id ? await taskRows(tx, draft.task_set_id) : [];
  const unowned = tasks.filter((t) => t.owner_user_id === null);
  const blockers: Blocker[] = [];
  if (approval !== 'effective')
    blockers.push({
      key: 'approval_effective',
      message:
        approval === 'invalidated'
          ? 'G2 approval no longer applies after a material change'
          : approval === 'expired'
            ? 'G2 approval expired unused'
            : 'G2 is not approved',
      gate: 'G2',
    });
  for (const t of unowned)
    blockers.push({ key: 'all_tasks_owned', message: `Task ${t.ordinal} · ${t.title} has no owner` });
  for (const c of open)
    blockers.push({
      key: 'blocking_conditions_met',
      message: `${c.key} · ${c.text} · open`,
      ownerId: c.owner_user_id,
    });
  if (!draft) blockers.push({ key: 'plan_draft', message: 'There is no plan draft to activate' });
  return {
    approval,
    blockingConditionsMet: open.length === 0,
    allTasksOwned: tasks.length > 0 && unowned.length === 0,
    blockers,
  };
}

export async function messageDrafts(tx: Tx, caseId: string): Promise<MessageDraft[]> {
  const rows = await tx
    .selectFrom('me.message_draft')
    .selectAll()
    .where('case_id', '=', caseId)
    .orderBy('created_at')
    .execute();
  return rows.map(toMessageDraft);
}

export function toMessageDraft(r: {
  id: string;
  case_id: string;
  title: string;
  body: string;
  origin: string;
}): MessageDraft {
  return {
    id: r.id,
    caseId: r.case_id,
    title: r.title,
    body: r.body,
    origin: r.origin as MessageDraft['origin'],
    status: 'draft',
    notice: 'Draft — not authorized to send',
  };
}

export async function pilotView(
  tx: Tx,
  c: CaseLite,
  plan: PilotPlanRow,
  asOf: string,
  now: Date,
): Promise<PilotPlanView> {
  const [current, draft] = await Promise.all([
    versionById(tx, plan.current_version_id),
    versionById(tx, plan.draft_version_id),
  ]);
  const gate = plan.gate_request_id
    ? await tx
        .selectFrom('platform.gate_request')
        .select(['id', 'status', 'current_snapshot_id', 'decided_at', 'gate_code'])
        .where('id', '=', plan.gate_request_id)
        .executeTakeFirst()
    : undefined;
  const decided =
    gate && ['approved', 'approved_with_conditions', 'invalidated', 'expired'].includes(gate.status);
  const snap =
    decided && gate.current_snapshot_id
      ? await tx
          .selectFrom('platform.decision_snapshot')
          .select(['id', 'version', 'content_hash'])
          .where('id', '=', gate.current_snapshot_id)
          .executeTakeFirst()
      : undefined;
  const conds = gate ? await conditionRows(tx, [gate.id]) : [];
  const people = await peopleOf(
    tx,
    conds.flatMap((x) => [x.owner_user_id, x.added_by]),
  );
  const setId = (current ?? draft)?.task_set_id ?? null;
  const taskSet = setId ? await taskSetView(tx, setId) : null;
  const act = await activationFacts(tx, plan, draft, now);
  const conn = taskSet?.connectionId
    ? await tx
        .selectFrom('platform.connection')
        .select(['status', 'name'])
        .where('id', '=', taskSet.connectionId)
        .executeTakeFirst()
    : undefined;
  const stageAllows = caseMachine.commandsFrom(c.stage as never).includes('pilot_activated');
  return {
    pilotPlanId: plan.id,
    status: plan.status as PilotPlanView['status'],
    baseline:
      decided && snap && gate.decided_at
        ? {
            gateRequestId: gate.id,
            snapshotId: snap.id,
            snapshotVersion: snap.version,
            fingerprint: toFingerprint(snap.content_hash),
            approvedAt: isoDateTime(gate.decided_at),
            statusText: `G2 · ${GATE_STATUS_LABELS[gate.status as 'approved']} · ${shortDate(gate.decided_at)}`,
          }
        : null,
    current: current ? await toVersion(tx, current) : null,
    draft: draft ? await toVersion(tx, draft) : null,
    conditions: conds.map((x) => toCondition(x, people)),
    budget: decided && gate ? await budgetMeter(tx, gate.id, asOf) : null,
    taskSet,
    activationBlockers:
      plan.status === 'active'
        ? []
        : stageAllows
          ? act.blockers
          : [
              {
                key: 'case_stage',
                message: `Activation needs Pilot approved (stage is ${c.stage.replace(/_/g, ' ')})`,
              },
              ...act.blockers,
            ],
    messageDrafts: await messageDrafts(tx, c.id),
    connectorBanner:
      conn && conn.status !== 'connected'
        ? {
            status: conn.status as 'expired',
            title: `${conn.name}: ${conn.status.replace(/_/g, ' ')}`,
            body: 'Internal tasks continue. Reconnect the task tool or export CSV instead.',
          }
        : null,
  };
}
