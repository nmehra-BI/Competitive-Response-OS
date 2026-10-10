/**
 * S14 task mapping editor (D-114 §1, D-134): "Check with Jira" (`admin.checkMapping`) and Save
 * (`admin.setMapping`, replacing the handler in ./index.ts — spread after `adminHandlers`).
 *
 * Check is a dry lookup through the connector's `preview()` with one synthetic item per person (never
 * a write in the tool, never a row here): the project, the issue type and each person's account come
 * back Mapped, Unmapped (no account in the map) or Not found (the tool's `problemCodes`). It also says
 * what saving would do: a project or issue-type change on a mapping used by an approved, unsent task set
 * is `plan_destination_changed` (material by default), dry-run through the tenant's materiality policy.
 *
 * Save refuses such a change until the administrator acknowledges the impact
 * (`acknowledgeMaterialImpact: true`); then `applyMateriality` runs in the same transaction (the
 * approval is invalidated and unsent tasks pause; never-rule 10). Assignee edits are not material: the
 * next preview shows the new assignee, and a send refuses an older preview (content hash).
 */
import { randomUUID } from 'node:crypto';
import {
  ConnectorError,
  createConnectorFactory,
  createPgSimStore,
  createSimulatedConnector,
  SIMULATED_PROVIDER,
  type ExternalTaskInput,
  type PreviewItemResult,
  type TaskConnector,
} from '@growth-os/connectors';
import {
  API,
  MaterialityPolicyBody,
  ROLE_LABELS,
  type ConnectorMapping,
  type ConnectorMappingCheck,
  type ConnectorStatus,
  type RoleCode,
} from '@growth-os/contracts';
import { sql, type Db, type Tx } from '@growth-os/db';
import {
  createMaterialityEvaluator,
  impactLines,
  type ChangeDescriptor,
  type MaterialityOutcome,
} from '@growth-os/domain';
import { roleAllows } from '../../../platform/authz';
import type { Authorization, Identity } from '../../../platform/context';
import { ApiError, notFound } from '../../../platform/errors';
import { applyMateriality, findPins, tenantLocalIso, tenantTimeZone } from '../../../platform/materiality';
import { command, type HandlerMap, type Tools } from '../../../platform/pipeline';
import { isoDateTime, personRef } from '../../../platform/serialize';

const configure = (identity: Identity): Authorization => roleAllows(identity.subject, 'admin.configure');

type MappingBody = Omit<ConnectorMapping, 'id'>;

interface MappingRow {
  id: string;
  connection_id: string;
  purpose: string;
  destination_project: string;
  issue_type: string;
  assignee_map: unknown;
}

const asMap = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (Object.fromEntries(
        Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string'),
      ) as Record<string, string>)
    : {};

const toMapping = (m: MappingRow): ConnectorMapping => ({
  id: m.id,
  connectionId: m.connection_id,
  purpose: m.purpose as ConnectorMapping['purpose'],
  destinationProject: m.destination_project,
  issueType: m.issue_type,
  assigneeMap: asMap(m.assignee_map),
});

async function connectionOf(tx: Tx, id: string) {
  const c = await tx
    .selectFrom('platform.connection')
    .select(['id', 'provider', 'name', 'status', 'kind', 'config'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!c) throw notFound();
  if (c.kind !== 'task_tool')
    throw new ApiError('VALIDATION_FAILED', 'Task mappings belong to a task tool connection.', {
      errors: [{ path: 'body.connectionId', code: 'invalid', message: 'Not a task tool connection' }],
    });
  return c;
}

async function mappingRow(tx: Tx, id: string): Promise<MappingRow | undefined> {
  return tx.selectFrom('platform.connector_mapping').selectAll().where('id', '=', id).executeTakeFirst();
}

// ---------------------------------------------------------------------------
// Material impact (dry run and apply)
// ---------------------------------------------------------------------------

interface AffectedPlan {
  taskSetId: string;
  componentType: 'pilot_plan_version' | 'experiment_plan_version';
  objectId: string;
  unsent: number;
}

/**
 * Task sets that use this mapping and still have unsent tasks (never sent or only previewed). A set
 * whose tasks were all sent is not affected: retries keep the project of the first send.
 */
async function affectedPlans(tx: Tx, mappingId: string): Promise<AffectedPlan[]> {
  const rows = await sql<{
    id: string;
    owner_type: string;
    owner_id: string;
    unsent: number;
  }>`
    SELECT s.id, s.owner_type, s.owner_id,
      (SELECT count(*)::int FROM platform.task t
         LEFT JOIN platform.external_task_link l ON l.task_id = t.id AND l.connection_id = s.connection_id
        WHERE t.task_set_id = s.id AND t.removed_at IS NULL
          AND coalesce(l.sync_status, 'not_sent') IN ('not_sent', 'in_preview')) AS unsent
      FROM platform.task_set s
     WHERE s.mapping_id = ${mappingId}`.execute(tx);
  const out: AffectedPlan[] = [];
  for (const r of rows.rows) {
    if (r.unsent === 0) continue;
    if (r.owner_type === 'pilot_plan_version') {
      out.push({
        taskSetId: r.id,
        componentType: 'pilot_plan_version',
        objectId: r.owner_id,
        unsent: r.unsent,
      });
    } else {
      // The experiment's pre-registered plan version is what the G1 snapshot pins.
      const v = await tx
        .selectFrom('me.experiment_plan_version')
        .select('id')
        .where('experiment_id', '=', r.owner_id)
        .orderBy('is_original', 'desc')
        .orderBy('version')
        .executeTakeFirst();
      if (v)
        out.push({
          taskSetId: r.id,
          componentType: 'experiment_plan_version',
          objectId: v.id,
          unsent: r.unsent,
        });
    }
  }
  return out;
}

async function activePolicy(tx: Tx): Promise<MaterialityPolicyBody> {
  const row = await tx
    .selectFrom('platform.policy')
    .select('body')
    .where('kind', '=', 'materiality')
    .where('status', '=', 'active')
    .orderBy('version', 'desc')
    .executeTakeFirst();
  // Same fail-safe as applyMateriality: no policy → every change is uncertain.
  return row ? MaterialityPolicyBody.parse(row.body) : { rules: [], escalateTo: 'sponsor' };
}

const destinationChanged = (existing: MappingRow | undefined, body: MappingBody): boolean =>
  !!existing &&
  (existing.destination_project !== body.destinationProject || existing.issue_type !== body.issueType);

/** Dry run of `plan_destination_changed` over every affected plan: nothing is written. */
async function dryRunImpact(tx: Tx, mappingId: string, now: Date): Promise<ConnectorMappingCheck['impact']> {
  const plans = await affectedPlans(tx, mappingId);
  if (plans.length === 0) return null;
  const policy = await activePolicy(tx);
  const evaluator = createMaterialityEvaluator();
  const at = tenantLocalIso(now, await tenantTimeZone(tx));
  const lines: string[] = [];
  const gates = new Set<string>();
  let material = false;
  for (const p of plans) {
    const pins = await findPins(tx, p.componentType, p.objectId);
    if (pins.length === 0) continue;
    const versions = await tx
      .selectFrom('platform.decision_snapshot')
      .select(['id', 'version'])
      .where(
        'id',
        'in',
        pins.map((x) => x.snapshotId),
      )
      .execute();
    const byCase = new Map<string, typeof pins>();
    for (const pin of pins) byCase.set(pin.caseId, [...(byCase.get(pin.caseId) ?? []), pin]);
    for (const [caseId, casePins] of byCase) {
      const change: ChangeDescriptor = {
        caseId,
        changeType: 'plan_destination_changed',
        objectType: p.componentType,
        objectId: p.objectId,
        fromVersion: null,
        toVersion: null,
        committed: true,
        at,
      };
      const outcome: MaterialityOutcome = evaluator.evaluate(change, policy, casePins);
      if (outcome.impacts.length === 0) continue;
      material ||= outcome.classification === 'material';
      for (const pin of casePins)
        if (outcome.impacts.some((i) => i.snapshotId === pin.snapshotId)) gates.add(pin.gateRequestId);
      lines.push(
        ...impactLines(
          outcome,
          casePins.map((pin) => ({
            snapshotId: pin.snapshotId,
            gateRequestId: pin.gateRequestId,
            gateCode: pin.gateCode,
            snapshotVersion: versions.find((v) => v.id === pin.snapshotId)?.version ?? 0,
          })),
          p.unsent,
        ),
      );
    }
  }
  if (lines.length === 0) return null;
  return {
    material,
    changeType: 'plan_destination_changed',
    lines: [...new Set(lines)],
    affectedGateRequestIds: [...gates],
  };
}

async function applyDestinationChange(t: Tools, mappingId: string, now: Date, userId: string) {
  for (const p of await affectedPlans(t.tx, mappingId))
    await applyMateriality(
      t,
      {
        changeType: 'plan_destination_changed',
        objectType: p.componentType,
        objectId: p.objectId,
        componentType: p.componentType,
      },
      { now, actorUserId: userId },
    );
}

// ---------------------------------------------------------------------------
// "Check with Jira": dry lookup through the connector
// ---------------------------------------------------------------------------

async function people(tx: Tx, mappingId: string, body: MappingBody) {
  const owners = await sql<{ owner_user_id: string }>`
    SELECT DISTINCT t.owner_user_id FROM platform.task t
      JOIN platform.task_set s ON s.id = t.task_set_id
     WHERE s.mapping_id = ${mappingId} AND t.removed_at IS NULL AND t.owner_user_id IS NOT NULL`.execute(tx);
  const ids = [...new Set([...Object.keys(body.assigneeMap), ...owners.rows.map((r) => r.owner_user_id)])];
  if (ids.length === 0) return [];
  const users = await tx
    .selectFrom('platform.app_user')
    .select(['id', 'display_name', 'title', 'initials'])
    .where('id', 'in', ids)
    .where('kind', '=', 'human')
    .orderBy('display_name')
    .execute();
  const roles = await tx
    .selectFrom('platform.role_assignment')
    .select(['user_id', 'role'])
    .where(
      'user_id',
      'in',
      users.map((u) => u.id),
    )
    .where('revoked_at', 'is', null)
    .orderBy('granted_at')
    .execute();
  return users.map((u) => ({
    user: u,
    roleText:
      ROLE_LABELS[roles.find((r) => r.user_id === u.id && r.role !== 'tenant_admin')?.role as RoleCode] ??
      u.title ??
      'Person',
  }));
}

/**
 * The simulated tool has no membership table; it refuses an assignee through a `permission_denied`
 * fault rule (as a real project refuses a non-member). For the dry lookup, a person with such a rule
 * is not a member of the project, so the connector's own `preview()` reports Not found.
 */
async function connectorFor(db: Db, conn: { id: string; provider: string }, accounts: string[]) {
  if (conn.provider !== SIMULATED_PROVIDER) return createConnectorFactory({ sim: db })(conn);
  const r = await sql<{ assignee: string }>`
    SELECT match->>'assignee' AS assignee FROM sim.fault_rule
     WHERE connection_id = ${conn.id} AND mode = 'permission_denied' AND remaining > 0
       AND match ? 'assignee'`.execute(db);
  const denied = new Set(r.rows.map((x) => x.assignee));
  const store = createPgSimStore(db);
  const members = accounts.filter((a) => !denied.has(a));
  return createSimulatedConnector(conn.id, {
    ...store,
    // An empty list means "open project" to the simulator; keep a placeholder member so a project
    // that refuses everyone still reports each person.
    projectMembers: async () => (denied.size ? [...members, '(project members)'] : []),
  });
}

const NOT_FOUND_CODES = new Set(['assignee_not_found', 'assignee_not_in_project']);

async function checkMapping(
  tx: Tx,
  db: Db,
  mappingId: string,
  body: MappingBody,
  now: Date,
): Promise<ConnectorMappingCheck> {
  const conn = await connectionOf(tx, body.connectionId);
  const existing = await mappingRow(tx, mappingId);
  const persons = await people(tx, mappingId, body);
  const withAccount = persons.filter((p) => (body.assigneeMap[p.user.id] ?? '').trim() !== '');
  const items: ExternalTaskInput[] = withAccount.map((p) => ({
    // Synthetic and never written: a preview has no side effect in the tool.
    idempotencyKey: `mapping-check-${randomUUID()}`,
    project: body.destinationProject,
    issueType: body.issueType,
    title: `Mapping check · ${p.user.display_name}`,
    description: 'Dry lookup from Growth OS administration. Nothing is created.',
    assignee: body.assigneeMap[p.user.id]!.trim(),
    dueOn: null,
    labels: ['growth-os'],
    links: { caseKey: '', gateLabel: '', url: '/admin/connections' },
  }));

  let connectionStatus = conn.status as ConnectorStatus;
  let results: PreviewItemResult[] = [];
  let checked = false;
  if (connectionStatus === 'connected' && items.length > 0) {
    const connector: TaskConnector = await connectorFor(
      db,
      conn,
      items.map((i) => i.assignee!),
    );
    try {
      results = await connector.preview(items);
      checked = true;
    } catch (e) {
      if (!(e instanceof ConnectorError)) throw e;
      connectionStatus = e.kind === 'token_expired' ? 'expired' : 'unavailable';
    }
  } else if (connectionStatus === 'connected') checked = true;

  const codes = results.flatMap((r) => r.problemCodes ?? []);
  const names = (conn.config ?? {}) as { projectNames?: Record<string, unknown> };
  const projectName = names.projectNames?.[body.destinationProject];
  return {
    mappingId,
    project: {
      key: body.destinationProject,
      name: typeof projectName === 'string' ? projectName : null,
      found: checked && !codes.includes('project_not_found'),
    },
    issueType: { name: body.issueType, found: checked && !codes.includes('issue_type_not_found') },
    assignees: persons.map((p) => {
      const account = (body.assigneeMap[p.user.id] ?? '').trim() || null;
      const i = withAccount.indexOf(p);
      const r = i >= 0 ? results[i] : undefined;
      const notFound = (r?.problemCodes ?? []).some((c) => NOT_FOUND_CODES.has(c));
      return {
        userId: p.user.id,
        person: personRef(p.user),
        roleText: p.roleText,
        externalAccount: account,
        status: !account ? 'unmapped' : notFound ? 'not_found' : 'mapped',
        message: !account
          ? 'No account in the task tool'
          : notFound
            ? (r?.problems[0] ?? 'Not found in the task tool')
            : checked
              ? null
              : 'Not checked: the connection is not usable',
      } as const;
    }),
    impact: destinationChanged(existing, body) ? await dryRunImpact(tx, mappingId, now) : null,
    connectionStatus,
    checkedAt: isoDateTime(now),
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const mappingHandlers: HandlerMap = {
  // ---- POST /admin/connector-mappings/:id/check (no writes) --------------------------------------
  [API.admin.checkMapping.id]: command(API.admin.checkMapping, {
    authorize: (ctx) => configure(ctx.identity),
    audit: 'none',
    handle: (ctx, t) => checkMapping(t.tx, ctx.deps.db, ctx.params.id, ctx.body, ctx.now),
  }),

  // ---- PUT /admin/connector-mappings/:id (replaces the handler in ./index.ts) ---------------------
  [API.admin.setMapping.id]: command(API.admin.setMapping, {
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t) => {
      const { acknowledgeMaterialImpact, ...b } = ctx.body;
      await connectionOf(t.tx, b.connectionId);
      const existing = await mappingRow(t.tx, ctx.params.id);
      if (existing && existing.purpose !== b.purpose)
        throw new ApiError('VALIDATION_FAILED', 'A mapping keeps its purpose; add a new mapping instead.', {
          errors: [{ path: 'body.purpose', code: 'invalid', message: 'Purpose cannot change' }],
        });
      const unknown = Object.keys(b.assigneeMap).length
        ? await t.tx
            .selectFrom('platform.app_user')
            .select('id')
            .where('id', 'in', Object.keys(b.assigneeMap))
            .where('kind', '=', 'human')
            .execute()
        : [];
      if (unknown.length !== Object.keys(b.assigneeMap).length)
        throw new ApiError('VALIDATION_FAILED', 'Every mapped person must be a person in this workspace.', {
          errors: [{ path: 'body.assigneeMap', code: 'invalid', message: 'Unknown person' }],
        });

      const destination = destinationChanged(existing, b);
      const impact = destination ? await dryRunImpact(t.tx, ctx.params.id, ctx.now) : null;
      if (impact && !acknowledgeMaterialImpact)
        throw new ApiError(
          'PRECONDITIONS_UNMET',
          'Changing the destination affects an approved task set. Review the impact and confirm it.',
          { blockers: impact.lines.map((message, i) => ({ key: `impact-${i + 1}`, message })) },
        );

      const values = {
        connection_id: b.connectionId,
        purpose: b.purpose,
        destination_project: b.destinationProject,
        issue_type: b.issueType,
        assignee_map: JSON.stringify(b.assigneeMap),
      };
      const row = existing
        ? await t.tx
            .updateTable('platform.connector_mapping')
            .set(values)
            .where('id', '=', ctx.params.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await t.tx
            .insertInto('platform.connector_mapping')
            .values({ id: ctx.params.id, tenant_id: ctx.tenantId, ...values })
            // An id another tenant already holds is not visible here (RLS): never overwritten, 404.
            .onConflict((oc) => oc.column('id').doNothing())
            .returningAll()
            .executeTakeFirst();
      if (!row) throw notFound();
      const assigneesChanged =
        !existing || JSON.stringify(asMap(existing.assignee_map)) !== JSON.stringify(b.assigneeMap);
      await t.audit({
        action: 'admin.mapping_set',
        objectType: 'connector_mapping',
        objectId: row.id,
        summary: (destination
          ? `Changed ${b.purpose.replace(/_/g, ' ')} destination to ${b.destinationProject} · ${b.issueType}${impact ? ' (material: impact acknowledged)' : ''}`
          : `Set ${b.purpose.replace(/_/g, ' ')} destination to ${b.destinationProject}${existing && assigneesChanged ? ' · assignees updated (not material)' : ''}`
        ).slice(0, 280),
        details: {
          connectionId: b.connectionId,
          purpose: b.purpose,
          assignees: Object.keys(b.assigneeMap).length,
          destinationChanged: destination,
          material: !!impact?.material,
          acknowledged: !!acknowledgeMaterialImpact,
        },
        before: existing ? toMapping(existing) : undefined,
        after: toMapping(row),
      });
      if (impact) await applyDestinationChange(t, row.id, ctx.now, ctx.userId);
      return toMapping(row);
    },
  }),
};
