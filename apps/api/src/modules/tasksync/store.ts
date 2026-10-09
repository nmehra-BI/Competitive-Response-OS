/**
 * Task-set reads for the task-sync endpoints, all under RLS (another tenant's set is simply not
 * found). Also the request-time authorization facts: approval effectiveness (the worker re-checks
 * the same facts at send time, apps/worker/src/jobs/outbox/facts.ts), blocking conditions, owners.
 */
import { externalTaskIdempotencyKey, type ExternalTaskInput } from '@growth-os/connectors';
import {
  type ConnectorStatus,
  type GateRequestStatus,
  type SyncStatus,
  type Task,
  type TaskFunction,
  type TaskSet,
  type TaskSetOwnerType,
  type TaskStatus,
} from '@growth-os/contracts';
import { sql, type Tx } from '@growth-os/db';
import type { ApprovalEffectiveness } from '@growth-os/domain';
import { casesByIds, type CaseRow } from '../../platform/cases';
import { notFound } from '../../platform/errors';
import { isoDateOrNull, isoDateTimeOrNull, personRef } from '../../platform/serialize';
import { dependsOnLabel, summarize, summaryText, toolLabel } from './text';

export interface ConnectionRow {
  id: string;
  provider: string;
  name: string;
  status: ConnectorStatus;
  scopeText: string;
  config: Record<string, unknown>;
}

export interface MappingRow {
  id: string;
  project: string;
  issueType: string;
  assigneeMap: Record<string, string>;
}

export interface LinkRow {
  id: string;
  taskId: string;
  idempotencyKey: string;
  status: SyncStatus;
  externalKey: string | null;
  externalUrl: string | null;
  attempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  retryable: boolean;
  confirmedAt: string | null;
}

export interface TaskRow {
  id: string;
  ordinal: number;
  title: string;
  milestoneId: string | null;
  milestoneLabel: string | null;
  function: TaskFunction;
  owner: { id: string; display_name: string; title: string | null; initials: string } | null;
  dependsOn: { id: string; ordinal: number }[];
  dueOn: string | null;
  dueRule: string | null;
  deliverable: string;
  conditionKey: string | null;
  status: TaskStatus;
  rowVersion: number;
}

export interface LoadedSet {
  id: string;
  ownerType: TaskSetOwnerType;
  ownerId: string;
  gateRequestId: string;
  kase: CaseRow;
  connection: ConnectionRow | null;
  mapping: MappingRow | null;
  tasks: TaskRow[];
  links: Map<string, LinkRow>;
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export async function loadTaskSet(
  tx: Tx,
  id: string,
  opts: { lockLinks?: boolean } = {},
): Promise<LoadedSet> {
  const set = await tx.selectFrom('platform.task_set').selectAll().where('id', '=', id).executeTakeFirst();
  if (!set) throw notFound();
  const [kase] = await casesByIds(tx, [set.case_id]);
  if (!kase) throw notFound();
  const conn = set.connection_id
    ? await tx
        .selectFrom('platform.connection')
        .select(['id', 'provider', 'name', 'status', 'scope_text', 'config'])
        .where('id', '=', set.connection_id)
        .executeTakeFirst()
    : undefined;
  const mapping = set.mapping_id
    ? await tx
        .selectFrom('platform.connector_mapping')
        .select(['id', 'destination_project', 'issue_type', 'assignee_map'])
        .where('id', '=', set.mapping_id)
        .executeTakeFirst()
    : undefined;
  const tasks = await tx
    .selectFrom('platform.task as t')
    .leftJoin('platform.milestone as m', 'm.id', 't.milestone_id')
    .leftJoin('platform.app_user as u', 'u.id', 't.owner_user_id')
    .select([
      't.id',
      't.ordinal',
      't.title',
      't.milestone_id',
      'm.name as milestone_name',
      'm.window_text',
      't.function',
      't.owner_user_id',
      'u.display_name',
      'u.title as owner_title',
      'u.initials',
      't.due_on',
      't.due_rule',
      't.deliverable',
      't.condition_key',
      't.status',
      't.row_version',
    ])
    .where('t.task_set_id', '=', set.id)
    .orderBy('t.ordinal')
    .execute();
  const deps = tasks.length
    ? await tx
        .selectFrom('platform.task_dependency as d')
        .innerJoin('platform.task as dt', 'dt.id', 'd.depends_on_task_id')
        .select(['d.task_id', 'dt.id', 'dt.ordinal'])
        .where(
          'd.task_id',
          'in',
          tasks.map((t) => t.id),
        )
        .execute()
    : [];
  let linkQuery = tx
    .selectFrom('platform.external_task_link')
    .selectAll()
    .where('connection_id', '=', set.connection_id ?? '00000000-0000-0000-0000-000000000000')
    .where('task_id', 'in', tasks.length ? tasks.map((t) => t.id) : ['00000000-0000-0000-0000-000000000000']);
  if (opts.lockLinks) linkQuery = linkQuery.forUpdate();
  const links = await linkQuery.execute();

  return {
    id: set.id,
    ownerType: set.owner_type as TaskSetOwnerType,
    ownerId: set.owner_id,
    gateRequestId: set.authorizing_gate_request_id,
    kase,
    connection: conn
      ? {
          id: conn.id,
          provider: conn.provider,
          name: conn.name,
          status: conn.status as ConnectorStatus,
          scopeText: conn.scope_text,
          config: asObject(conn.config),
        }
      : null,
    mapping: mapping
      ? {
          id: mapping.id,
          project: mapping.destination_project,
          issueType: mapping.issue_type,
          assigneeMap: Object.fromEntries(
            Object.entries(asObject(mapping.assignee_map)).filter(([, v]) => typeof v === 'string'),
          ) as Record<string, string>,
        }
      : null,
    tasks: tasks.map((t) => ({
      id: t.id,
      ordinal: t.ordinal,
      title: t.title,
      milestoneId: t.milestone_id,
      milestoneLabel: t.milestone_name ? `${t.milestone_name} · ${t.window_text}` : null,
      function: t.function as TaskFunction,
      owner:
        t.owner_user_id && t.display_name
          ? {
              id: t.owner_user_id,
              display_name: t.display_name,
              title: t.owner_title,
              initials: t.initials ?? '',
            }
          : null,
      dependsOn: deps.filter((d) => d.task_id === t.id).map((d) => ({ id: d.id, ordinal: d.ordinal })),
      dueOn: isoDateOrNull(t.due_on),
      dueRule: t.due_rule,
      deliverable: t.deliverable,
      conditionKey: t.condition_key,
      status: t.status as TaskStatus,
      rowVersion: t.row_version,
    })),
    links: new Map(
      links.map((k) => [
        k.task_id,
        {
          id: k.id,
          taskId: k.task_id,
          idempotencyKey: k.idempotency_key.trim(),
          status: k.sync_status as SyncStatus,
          externalKey: k.external_key,
          externalUrl: k.external_url,
          attempts: k.attempts,
          lastErrorCode: k.last_error_code,
          lastErrorMessage: k.last_error_message,
          retryable: k.retryable,
          confirmedAt: isoDateTimeOrNull(k.confirmed_at),
        },
      ]),
    ),
  };
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function destinationOf(
  s: LoadedSet,
): { tool: string; project: string; projectName: string | null } | null {
  if (!s.connection || !s.mapping) return null;
  const names = asObject(s.connection.config.projectNames);
  const projectName =
    typeof names[s.mapping.project] === 'string' ? (names[s.mapping.project] as string) : null;
  return {
    tool: toolLabel(s.connection.provider, s.connection.name),
    project: s.mapping.project,
    projectName,
  };
}

export function toTaskSetView(s: LoadedSet): TaskSet {
  const dest = destinationOf(s);
  const tasks: Task[] = s.tasks.map((t) => {
    const link = s.links.get(t.id);
    return {
      id: t.id,
      caseId: s.kase.id,
      taskSetId: s.id,
      ordinal: t.ordinal,
      title: t.title,
      milestoneId: t.milestoneId,
      milestoneLabel: t.milestoneLabel,
      function: t.function,
      owner: t.owner ? personRef(t.owner) : null,
      dependsOnTaskIds: t.dependsOn.map((d) => d.id),
      dependsOnLabel: dependsOnLabel(t.dependsOn.map((d) => d.ordinal)),
      dueOn: t.dueOn,
      dueRule: t.dueRule,
      deliverable: t.deliverable,
      conditionKey: t.conditionKey,
      status: t.status,
      sync: {
        status: link?.status ?? 'not_sent',
        connectionId: s.connection?.id ?? null,
        externalKey: link?.externalKey ?? null,
        externalUrl: link?.externalUrl ?? null,
        attempts: link?.attempts ?? 0,
        lastErrorCode: link?.lastErrorCode ?? null,
        lastErrorMessage: link?.lastErrorMessage ?? null,
        retryable: link?.retryable ?? true,
        confirmedAt: link?.confirmedAt ?? null,
      },
      rowVersion: t.rowVersion,
    };
  });
  const counts = tasks.map((t) => ({ status: t.sync.status, lastErrorCode: t.sync.lastErrorCode }));
  return {
    id: s.id,
    caseId: s.kase.id,
    ownerType: s.ownerType,
    ownerId: s.ownerId,
    authorizingGateRequestId: s.gateRequestId,
    connectionId: s.connection?.id ?? null,
    destinationLabel: dest
      ? [dest.tool, `project ${dest.project}`, dest.projectName].filter(Boolean).join(' · ')
      : null,
    tasks,
    summary: summarize(counts),
    summaryText: summaryText(counts, dest?.tool ?? 'the task tool'),
  };
}

// ---------------------------------------------------------------------------
// Authorization facts at request time
// ---------------------------------------------------------------------------

export interface GateContext {
  approval: ApprovalEffectiveness;
  approvalId: string | null;
  snapshotHash: string | null;
  /** "G2 v4": gate and the version of the approved snapshot. */
  gateLabel: string;
  blockingConditionsMet: boolean;
}

export async function loadGateContext(tx: Tx, gateRequestId: string, now: Date): Promise<GateContext> {
  const g = await sql<{
    gate_code: string;
    status: GateRequestStatus;
    expires_at: Date | null;
    approval_id: string | null;
    snapshot_hash: string | null;
    snapshot_version: number | null;
    current_version: number | null;
    has_invalidation: boolean;
    has_expired: boolean;
    executed: boolean;
    open_blocking: number;
  }>`
    SELECT g.gate_code, g.status, g.expires_at,
      ea.id AS approval_id, ea.snapshot_hash, es.version AS snapshot_version,
      (SELECT s.version FROM platform.decision_snapshot s WHERE s.id = g.current_snapshot_id) AS current_version,
      EXISTS (SELECT 1 FROM platform.approval a JOIN platform.approval_invalidation i ON i.approval_id = a.id
               WHERE a.gate_request_id = g.id) AS has_invalidation,
      EXISTS (SELECT 1 FROM platform.approval a JOIN platform.approval_invalidation i ON i.approval_id = a.id
               WHERE a.gate_request_id = g.id AND i.kind = 'expired') AS has_expired,
      (g.gate_code IN ('G0','G3')
        OR EXISTS (SELECT 1 FROM me.pilot_plan pp WHERE pp.gate_request_id = g.id AND pp.activated_at IS NOT NULL)
        OR EXISTS (SELECT 1 FROM me.experiment e WHERE e.locked_by_gate_request_id = g.id
                     AND e.lifecycle IN ('running','result_recorded'))
        OR EXISTS (SELECT 1 FROM platform.outbox_message o
                    WHERE o.authorization_ref->>'gateRequestId' = g.id::text
                      AND (o.sent_at IS NOT NULL OR o.status IN ('sending','checking','confirmed')))) AS executed,
      (SELECT count(*)::int FROM platform.condition c
        WHERE c.gate_request_id = g.id AND c.blocks_execution AND c.status = 'open') AS open_blocking
    FROM platform.gate_request g
    LEFT JOIN LATERAL (
      SELECT a.id, a.snapshot_id, a.snapshot_hash FROM platform.approval a
       WHERE a.gate_request_id = g.id AND a.disposition IN ('approve','approve_with_conditions')
         AND NOT EXISTS (SELECT 1 FROM platform.approval_invalidation i WHERE i.approval_id = a.id)
       ORDER BY a.decided_at DESC LIMIT 1) ea ON true
    LEFT JOIN platform.decision_snapshot es ON es.id = ea.snapshot_id
    WHERE g.id = ${gateRequestId}`.execute(tx);
  const row = g.rows[0];
  if (!row)
    return {
      approval: 'missing',
      approvalId: null,
      snapshotHash: null,
      gateLabel: '',
      blockingConditionsMet: false,
    };
  let approval: ApprovalEffectiveness;
  if (row.status === 'invalidated') approval = 'invalidated';
  else if (row.status === 'expired') approval = 'expired';
  else if ((row.status === 'approved' || row.status === 'approved_with_conditions') && row.approval_id)
    approval =
      row.expires_at && new Date(row.expires_at).getTime() <= now.getTime() && !row.executed
        ? 'expired'
        : 'effective';
  else approval = row.has_expired ? 'expired' : row.has_invalidation ? 'invalidated' : 'missing';
  const version = row.snapshot_version ?? row.current_version;
  return {
    approval,
    approvalId: row.approval_id,
    snapshotHash: row.snapshot_hash?.trim() ?? null,
    gateLabel: version ? `${row.gate_code} v${version}` : row.gate_code,
    blockingConditionsMet: row.open_blocking === 0,
  };
}

/**
 * The plan version that keys the external writes: the pilot plan version owning the set, or the
 * experiment's pre-registered (original) plan version locked at G1.
 */
export async function planVersionIdOf(tx: Tx, s: LoadedSet): Promise<string> {
  if (s.ownerType === 'pilot_plan_version') return s.ownerId;
  const v = await tx
    .selectFrom('me.experiment_plan_version')
    .select('id')
    .where('experiment_id', '=', s.ownerId)
    .orderBy('is_original', 'desc')
    .orderBy('version')
    .executeTakeFirst();
  return v?.id ?? s.ownerId;
}

/**
 * Is the plan that owns the set still the one in force? Pilot: the activated plan version is current
 * (WS4b hand-off); experiment: still locked by the authorizing gate and not cancelled. The worker
 * re-checks the same rule at send time.
 */
export async function planIsCurrent(tx: Tx, s: LoadedSet): Promise<boolean> {
  const r =
    s.ownerType === 'pilot_plan_version'
      ? await sql<{ ok: boolean }>`
          SELECT EXISTS (SELECT 1 FROM me.pilot_plan p WHERE p.current_version_id = ${s.ownerId}) AS ok`.execute(
          tx,
        )
      : await sql<{ ok: boolean }>`
          SELECT EXISTS (SELECT 1 FROM me.experiment e
                          WHERE e.id = ${s.ownerId} AND e.lifecycle <> 'cancelled'
                            AND e.locked_by_gate_request_id = ${s.gateRequestId}) AS ok`.execute(tx);
  return r.rows[0]?.ok ?? false;
}

/** The external write for one task. Existing links keep their key forever (stable across retries). */
export function externalInput(
  s: LoadedSet,
  t: TaskRow,
  ctx: { tenantId: string; planVersionId: string; gateLabel: string; project?: string },
): ExternalTaskInput {
  const project = ctx.project ?? s.mapping!.project;
  const link = s.links.get(t.id);
  return {
    idempotencyKey:
      link?.idempotencyKey ??
      externalTaskIdempotencyKey({
        tenantId: ctx.tenantId,
        planVersionId: ctx.planVersionId,
        taskId: t.id,
        connectionId: s.connection!.id,
        project,
      }),
    project,
    issueType: s.mapping!.issueType,
    title: t.title,
    description: `${s.kase.key} · ${ctx.gateLabel} · Deliverable: ${t.deliverable}`,
    assignee: t.owner ? (s.mapping!.assigneeMap[t.owner.id] ?? null) : null,
    dueOn: t.dueOn,
    labels: ['growth-os', s.kase.key],
    links: {
      caseKey: s.kase.key,
      gateLabel: ctx.gateLabel,
      url: `/me/cases/${s.kase.key}/${s.ownerType === 'pilot_plan_version' ? 'pilot' : 'validation'}`,
    },
  };
}
