/**
 * Administration (S14). Tenant administrators configure roles, delegated authority, policies,
 * connections and mappings, and read diagnostics. Invariants (never-rule 6, D-016):
 *  - admins configure but never approve: no grant to a tenant administrator, no decision role
 *    (sponsor, investment committee) together with tenant_admin, no change to one's own roles or grants;
 *  - only human principals hold roles or authority;
 *  - self-approval cannot be enabled: gate policy bodies carry selfApprovalAllowed: false (frozen schema);
 *  - policies are versioned: publishing retires the previous active version, which stays readable.
 */
import {
  API,
  AnalysisRun,
  ROLE_LABELS,
  RUN_STATUS_LABELS,
  type AuthorityGrant,
  type Connection,
  type ConnectorMapping,
  type GateCode,
  type Policy,
  type RoleAssignment,
  type RoleCode,
} from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { matchingRole, roleAllows } from '../../../platform/authz';
import type { Authorization, Identity } from '../../../platform/context';
import { ApiError, forbidden, notFound } from '../../../platform/errors';
import { command, query, type HandlerMap } from '../../../platform/pipeline';
import { isoDate, isoDateTime, isoDateTimeOrNull, personRef } from '../../../platform/serialize';

const configure = (identity: Identity): Authorization => roleAllows(identity.subject, 'admin.configure');
const DECISION_ROLES: readonly RoleCode[] = ['sponsor', 'investment_committee'];
const GATES: readonly GateCode[] = ['G0', 'G1', 'G2', 'G3', 'X'];

const invalid = (path: string, message: string) =>
  new ApiError('VALIDATION_FAILED', 'Request validation failed', {
    errors: [{ path, code: 'invalid', message }],
  });

// ----- serializers -----------------------------------------------------------------------------

type RoleRow = {
  id: string;
  user_id: string;
  role: string;
  business_unit_id: string | null;
  case_id: string | null;
  granted_by: string;
  granted_at: Date;
  revoked_at: Date | null;
};
const toRole = (r: RoleRow): RoleAssignment => ({
  id: r.id,
  userId: r.user_id,
  role: r.role as RoleCode,
  businessUnitId: r.business_unit_id,
  caseId: r.case_id,
  grantedBy: r.granted_by,
  grantedAt: isoDateTime(r.granted_at),
  revokedAt: isoDateTimeOrNull(r.revoked_at),
});

type GrantRow = {
  id: string;
  user_id: string;
  gate_code: string;
  business_unit_id: string;
  ceiling_amount: string | null;
  currency: string | null;
  valid_from: Date | string;
  valid_to: Date | string | null;
  granted_by: string;
  revoked_at: Date | null;
};
const toGrant = (g: GrantRow): AuthorityGrant => ({
  id: g.id,
  userId: g.user_id,
  gateCode: g.gate_code as GateCode,
  businessUnitId: g.business_unit_id,
  ceilingAmount: g.ceiling_amount,
  currency: g.currency,
  validFrom: isoDate(g.valid_from),
  validTo: g.valid_to === null ? null : isoDate(g.valid_to),
  grantedBy: g.granted_by,
  revokedAt: isoDateTimeOrNull(g.revoked_at),
});

type PolicyRow = {
  id: string;
  kind: string;
  key: string;
  version: number;
  status: string;
  body: unknown;
  created_by: string;
  created_at: Date;
};
const toPolicy = (p: PolicyRow): Policy => ({
  id: p.id,
  kind: p.kind as Policy['kind'],
  key: p.key,
  version: p.version,
  status: p.status as Policy['status'],
  body: p.body,
  createdBy: p.created_by,
  createdAt: isoDateTime(p.created_at),
});

type ConnRow = {
  id: string;
  kind: string;
  provider: string;
  name: string;
  scope_text: string;
  status: string;
  last_success_at: Date | null;
  last_checked_at: Date | null;
  used_for: string;
};
const toConnection = (c: ConnRow): Connection => ({
  id: c.id,
  kind: c.kind as Connection['kind'],
  provider: c.provider,
  name: c.name,
  scopeText: c.scope_text,
  status: c.status as Connection['status'],
  lastSuccessAt: isoDateTimeOrNull(c.last_success_at),
  lastCheckedAt: isoDateTimeOrNull(c.last_checked_at),
  usedFor: c.used_for,
});

type MappingRow = {
  id: string;
  connection_id: string;
  purpose: string;
  destination_project: string;
  issue_type: string;
  assignee_map: unknown;
};
const toMapping = (m: MappingRow): ConnectorMapping => ({
  id: m.id,
  connectionId: m.connection_id,
  purpose: m.purpose as ConnectorMapping['purpose'],
  destinationProject: m.destination_project,
  issueType: m.issue_type,
  assigneeMap: (m.assignee_map ?? {}) as Record<string, string>,
});

async function humanUser(tx: Tx, userId: string): Promise<void> {
  const u = await tx
    .selectFrom('platform.app_user')
    .select(['kind', 'is_active'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!u) throw invalid('body.userId', 'Unknown user');
  if (u.kind !== 'human')
    throw new ApiError('AGENT_IDENTITY_FORBIDDEN', 'Only people can hold roles or authority.');
}

async function activeRoles(tx: Tx, userId: string, exceptId?: string): Promise<RoleCode[]> {
  let q = tx
    .selectFrom('platform.role_assignment')
    .select(['id', 'role'])
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null);
  if (exceptId) q = q.where('id', '<>', exceptId);
  return (await q.execute()).map((r) => r.role as RoleCode);
}

async function connectionRow(tx: Tx, id: string) {
  const c = await tx.selectFrom('platform.connection').selectAll().where('id', '=', id).executeTakeFirst();
  if (!c) throw notFound();
  return c;
}

// ----- handlers -------------------------------------------------------------------------------

export const adminHandlers: HandlerMap = {
  [API.admin.roles.id]: query(API.admin.roles, {
    authorize: (ctx) => configure(ctx.identity),
    handle: async (_ctx, { tx }) => ({
      items: (
        await tx
          .selectFrom('platform.role_assignment')
          .selectAll()
          .orderBy('granted_at')
          .orderBy('id')
          .execute()
      ).map(toRole),
    }),
  }),

  [API.admin.setRole.id]: command(API.admin.setRole, {
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t) => {
      const b = ctx.body;
      if (b.userId === ctx.userId) throw forbidden('Administrators cannot change their own roles.');
      await humanUser(t.tx, b.userId);
      if (b.businessUnitId) {
        const bu = await t.tx
          .selectFrom('platform.business_unit')
          .select('id')
          .where('id', '=', b.businessUnitId)
          .executeTakeFirst();
        if (!bu) throw invalid('body.businessUnitId', 'Unknown business unit');
      }
      if (b.caseId) {
        const c = await t.tx
          .selectFrom('platform.workflow_case')
          .select('id')
          .where('id', '=', b.caseId)
          .executeTakeFirst();
        if (!c) throw invalid('body.caseId', 'Unknown case');
      }
      const existing = await t.tx
        .selectFrom('platform.role_assignment')
        .selectAll()
        .where('id', '=', ctx.params.id)
        .executeTakeFirst();
      if (existing && existing.user_id !== b.userId)
        throw invalid('body.userId', 'A role assignment cannot move to another person');
      if (!b.revoked) {
        const others = await activeRoles(t.tx, b.userId, ctx.params.id);
        const resulting = new Set([...others, b.role]);
        if (resulting.has('tenant_admin') && DECISION_ROLES.some((r) => resulting.has(r)))
          throw forbidden(
            'Administrators configure but never approve: tenant administrator and decision roles cannot be combined.',
          );
        if (b.role === 'tenant_admin') {
          const grants = await t.tx
            .selectFrom('platform.authority_grant')
            .select('id')
            .where('user_id', '=', b.userId)
            .where('revoked_at', 'is', null)
            .execute();
          if (grants.length > 0)
            throw forbidden(
              'This person holds delegated authority; revoke it before making them an administrator.',
            );
        }
      }
      const values = {
        role: b.role,
        business_unit_id: b.businessUnitId,
        case_id: b.caseId,
        revoked_at: b.revoked ? (existing?.revoked_at ?? ctx.now) : null,
      };
      const row = existing
        ? await t.tx
            .updateTable('platform.role_assignment')
            .set(values)
            .where('id', '=', ctx.params.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await t.tx
            .insertInto('platform.role_assignment')
            .values({
              id: ctx.params.id,
              tenant_id: ctx.tenantId,
              user_id: b.userId,
              granted_by: ctx.userId,
              granted_at: ctx.now,
              ...values,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
      await t.audit({
        action: b.revoked ? 'admin.role_revoked' : existing ? 'admin.role_changed' : 'admin.role_granted',
        objectType: 'role_assignment',
        objectId: row.id,
        caseId: b.caseId,
        summary: `${b.revoked ? 'Revoked' : 'Granted'} role ${ROLE_LABELS[b.role]}`,
        details: { userId: b.userId, role: b.role, businessUnitId: b.businessUnitId },
        before: existing ? toRole(existing) : undefined,
        after: toRole(row),
      });
      return toRole(row);
    },
  }),

  [API.admin.authority.id]: query(API.admin.authority, {
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, { tx }) => {
      const grants = await tx
        .selectFrom('platform.authority_grant')
        .selectAll()
        .orderBy('created_at')
        .execute();
      const bus = await tx
        .selectFrom('platform.business_unit')
        .select(['id', 'name'])
        .orderBy('key')
        .execute();
      const today = ctx.now.toISOString().slice(0, 10);
      const effective = grants.filter(
        (g) =>
          !g.revoked_at &&
          isoDate(g.valid_from) <= today &&
          (g.valid_to === null || isoDate(g.valid_to) >= today),
      );
      const gaps = bus.flatMap((bu) =>
        GATES.filter(
          (gate) => !effective.some((g) => g.business_unit_id === bu.id && g.gate_code === gate),
        ).map((gate) => ({
          gateCode: gate,
          businessUnitId: bu.id,
          message: `No ${gate} approver in ${bu.name} · Authority gap`,
        })),
      );
      return { items: grants.map(toGrant), gaps };
    },
  }),

  [API.admin.setAuthority.id]: command(API.admin.setAuthority, {
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t) => {
      const b = ctx.body;
      if (b.userId === ctx.userId) throw forbidden('Administrators cannot grant authority to themselves.');
      await humanUser(t.tx, b.userId);
      if (!b.revoked && (await activeRoles(t.tx, b.userId)).includes('tenant_admin'))
        throw forbidden(
          'Tenant administrators configure but never approve: they cannot hold delegated authority.',
        );
      if ((b.ceilingAmount === null) !== (b.currency === null))
        throw invalid('body.currency', 'Set both a ceiling and its currency, or neither (no-spend gate)');
      if (b.validTo !== null && b.validTo < b.validFrom)
        throw invalid('body.validTo', 'Valid to must be on or after valid from');
      const bu = await t.tx
        .selectFrom('platform.business_unit')
        .select('id')
        .where('id', '=', b.businessUnitId)
        .executeTakeFirst();
      if (!bu) throw invalid('body.businessUnitId', 'Unknown business unit');
      const existing = await t.tx
        .selectFrom('platform.authority_grant')
        .selectAll()
        .where('id', '=', ctx.params.id)
        .executeTakeFirst();
      if (existing && existing.user_id !== b.userId)
        throw invalid('body.userId', 'A grant cannot move to another person');
      const values = {
        gate_code: b.gateCode,
        business_unit_id: b.businessUnitId,
        ceiling_amount: b.ceilingAmount,
        currency: b.currency,
        valid_from: b.validFrom,
        valid_to: b.validTo,
        revoked_at: b.revoked ? (existing?.revoked_at ?? ctx.now) : null,
      };
      const row = existing
        ? await t.tx
            .updateTable('platform.authority_grant')
            .set(values)
            .where('id', '=', ctx.params.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await t.tx
            .insertInto('platform.authority_grant')
            .values({
              id: ctx.params.id,
              tenant_id: ctx.tenantId,
              user_id: b.userId,
              granted_by: ctx.userId,
              created_at: ctx.now,
              ...values,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
      await t.audit({
        action: b.revoked
          ? 'admin.authority_revoked'
          : existing
            ? 'admin.authority_changed'
            : 'admin.authority_granted',
        objectType: 'authority_grant',
        objectId: row.id,
        summary: `${b.revoked ? 'Revoked' : 'Set'} ${b.gateCode} authority`,
        details: {
          userId: b.userId,
          gateCode: b.gateCode,
          businessUnitId: b.businessUnitId,
          ceiling: b.ceilingAmount,
          currency: b.currency,
        },
        before: existing ? toGrant(existing) : undefined,
        after: toGrant(row),
      });
      return toGrant(row);
    },
  }),

  [API.admin.policies.id]: query(API.admin.policies, {
    authorize: (ctx) => configure(ctx.identity),
    handle: async (_ctx, { tx }) => ({
      items: (
        await tx
          .selectFrom('platform.policy')
          .selectAll()
          .where('status', '=', 'active')
          .orderBy('kind')
          .orderBy('key')
          .execute()
      ).map(toPolicy),
    }),
  }),

  [API.admin.publishPolicy.id]: command(API.admin.publishPolicy, {
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t) => {
      const { kind, key, body } = ctx.body;
      if (kind === 'gate' && body.gateCode !== key)
        throw invalid('body.key', 'Gate policy key must be its gate code');
      const prev = await t.tx
        .selectFrom('platform.policy')
        .select(['id', 'version', 'status'])
        .where('kind', '=', kind)
        .where('key', '=', key)
        .orderBy('version', 'desc')
        .forUpdate()
        .execute();
      await t.tx
        .updateTable('platform.policy')
        .set({ status: 'retired' })
        .where('kind', '=', kind)
        .where('key', '=', key)
        .where('status', '=', 'active')
        .execute();
      const row = await t.tx
        .insertInto('platform.policy')
        .values({
          tenant_id: ctx.tenantId,
          kind,
          key,
          version: (prev[0]?.version ?? 0) + 1,
          status: 'active',
          body: JSON.stringify(body),
          created_by: ctx.userId,
          created_at: ctx.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'admin.policy_published',
        objectType: 'policy',
        objectId: row.id,
        objectVersion: row.version,
        summary: `Published ${kind.replace(/_/g, ' ')} policy ${key} v${row.version}`,
        details: { kind, key, version: row.version },
        after: body,
      });
      return toPolicy(row);
    },
  }),

  [API.admin.entitlements.id]: query(API.admin.entitlements, {
    authorize: (ctx) => configure(ctx.identity),
    handle: async (_ctx, { tx }) => {
      const licenses = await tx.selectFrom('platform.license').selectAll().orderBy('key').execute();
      const ents = await tx.selectFrom('platform.source_entitlement').selectAll().execute();
      const users = await tx.selectFrom('platform.app_user').select(['id', 'display_name']).execute();
      const nameOf = (e: (typeof ents)[number]) =>
        e.principal_type === 'user'
          ? (users.find((u) => u.id === e.principal)?.display_name ?? 'Unknown person')
          : e.principal === 'case_member'
            ? 'Case members'
            : e.principal === '*'
              ? 'Everyone'
              : (ROLE_LABELS[e.principal as RoleCode] ?? e.principal);
      return {
        items: licenses.map((l) => {
          const mine = ents.filter((e) => e.license_id === l.id);
          return {
            licenseId: l.id,
            sourceLabel: l.name,
            licenseText: l.boundary_text,
            excerptVisibleTo: mine.filter((e) => e.access === 'excerpt').map(nameOf),
            othersSee: (mine.find((e) => e.principal_type === 'role' && e.principal === '*')?.access ??
              'none') as 'excerpt' | 'aggregate_only' | 'none',
          };
        }),
      };
    },
  }),

  [API.admin.connections.id]: query(API.admin.connections, {
    // Health rows are also shown on S03 and S11, so case roles may read them (no secrets in the shape).
    authorize: (ctx) => {
      const admin = configure(ctx.identity);
      if (admin.allow) return admin;
      const role = matchingRole(ctx.identity.subject, 'case.read', { businessUnitId: null, caseId: null });
      return role ? { allow: true, rule: 'connections.health_read', authorityGrantId: null, role } : admin;
    },
    handle: async (_ctx, { tx }) => ({
      items: (
        await tx.selectFrom('platform.connection').selectAll().orderBy('created_at').orderBy('name').execute()
      ).map(toConnection),
      mappings: (
        await tx.selectFrom('platform.connector_mapping').selectAll().orderBy('purpose').execute()
      ).map(toMapping),
    }),
  }),

  [API.admin.testConnection.id]: command(API.admin.testConnection, {
    load: (ctx, tx) => connectionRow(tx, ctx.params.id),
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t, c) => {
      // Health is the stored connection state; a live probe through the TaskConnector (WS6) can
      // replace this without changing the contract. A healthy check refreshes last success.
      const healthy = c.status === 'connected';
      const row = await t.tx
        .updateTable('platform.connection')
        .set({ last_checked_at: ctx.now, ...(healthy ? { last_success_at: ctx.now } : {}) })
        .where('id', '=', c.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'admin.connection_tested',
        objectType: 'connection',
        objectId: c.id,
        summary: `Tested connection ${c.name}: ${c.status}`,
        details: { status: c.status, kind: c.kind },
      });
      return toConnection(row);
    },
  }),

  [API.admin.reconnect.id]: command(API.admin.reconnect, {
    load: (ctx, tx) => connectionRow(tx, ctx.params.id),
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t, c) => {
      // Re-authorization is simulated in dev. Paused sync is NOT resumed here: the outbox (WS6)
      // resumes paused rows only after its own reconcile and authorization re-check.
      const row = await t.tx
        .updateTable('platform.connection')
        .set({ status: 'connected', last_checked_at: ctx.now, last_success_at: ctx.now })
        .where('id', '=', c.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'admin.connection_reconnected',
        objectType: 'connection',
        objectId: c.id,
        summary: `Reconnected ${c.name}`,
        details: { from: c.status, kind: c.kind },
        before: { status: c.status },
        after: { status: 'connected' },
      });
      return toConnection(row);
    },
  }),

  [API.admin.setMapping.id]: command(API.admin.setMapping, {
    authorize: (ctx) => configure(ctx.identity),
    handle: async (ctx, t) => {
      const b = ctx.body;
      await connectionRow(t.tx, b.connectionId);
      const existing = await t.tx
        .selectFrom('platform.connector_mapping')
        .selectAll()
        .where('id', '=', ctx.params.id)
        .executeTakeFirst();
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
            .returningAll()
            .executeTakeFirstOrThrow();
      await t.audit({
        action: 'admin.mapping_set',
        objectType: 'connector_mapping',
        objectId: row.id,
        summary: `Set ${b.purpose.replace(/_/g, ' ')} destination to ${b.destinationProject}`.slice(0, 280),
        details: {
          connectionId: b.connectionId,
          purpose: b.purpose,
          assignees: Object.keys(b.assigneeMap).length,
        },
        before: existing ? toMapping(existing) : undefined,
        after: toMapping(row),
      });
      return toMapping(row);
    },
  }),

  [API.admin.runDiagnostics.id]: query(API.admin.runDiagnostics, {
    authorize: (ctx) => roleAllows(ctx.identity.subject, 'diagnostics.read'),
    handle: async (_ctx, { tx }) => {
      const r = await tx
        .selectFrom('platform.agent_run')
        .selectAll()
        .where('id', '=', _ctx.params.id)
        .executeTakeFirst();
      if (!r) throw notFound();
      const requester = await tx
        .selectFrom('platform.app_user')
        .select(['id', 'display_name', 'title', 'initials'])
        .where('id', '=', r.requested_by)
        .executeTakeFirstOrThrow();
      const steps = await tx
        .selectFrom('platform.agent_run_step')
        .selectAll()
        .where('run_id', '=', r.id)
        .orderBy('seq')
        .execute();
      const calls = await tx
        .selectFrom('platform.tool_call')
        .selectAll()
        .where('run_id', '=', r.id)
        .orderBy('created_at')
        .execute();
      const run = AnalysisRun.parse({
        id: r.id,
        caseId: r.case_id,
        mandateId: r.subject_type === 'mandate' ? r.subject_id : null,
        skill: r.skill_key,
        skillVersion: r.skill_version,
        goal: r.goal,
        status: r.status,
        statusLabel: RUN_STATUS_LABELS[r.status as keyof typeof RUN_STATUS_LABELS],
        statusDetail: r.status_detail,
        requestedBy: personRef(requester),
        provider: r.provider,
        modelConfig: r.model_config,
        inputSnapshotHash: r.input_snapshot_hash,
        budget: r.budget,
        usage: r.usage,
        lastCheckpointSeq: r.last_checkpoint_seq,
        needsInput: r.needs_input ?? null,
        error: r.error ?? null,
        createdAt: isoDateTime(r.created_at),
        startedAt: isoDateTimeOrNull(r.started_at),
        finishedAt: isoDateTimeOrNull(r.finished_at),
        correlationId: r.correlation_id,
      });
      return {
        run,
        steps: steps.map((s) => ({
          id: s.id,
          runId: s.run_id,
          seq: s.seq,
          kind: s.kind as 'provider_call',
          status: s.status as 'started',
          summary: s.summary,
          startedAt: isoDateTime(s.started_at),
          finishedAt: isoDateTimeOrNull(s.finished_at),
        })),
        toolCalls: calls.map((c) => ({
          id: c.id,
          runId: c.run_id,
          tool: c.tool_name as 'evidence.get',
          toolVersion: c.tool_version,
          argsHash: c.args_hash,
          argsRedacted: (c.args_redacted ?? {}) as Record<string, unknown>,
          scopeCheck: c.scope_check as {
            tenant: boolean;
            entitlement: boolean | null;
            schema: boolean;
            budget: boolean;
          },
          outcome: c.outcome as 'ok',
          resultSummary: c.result_summary,
          latencyMs: c.latency_ms,
          createdAt: isoDateTime(c.created_at),
        })),
      };
    },
  }),
};
