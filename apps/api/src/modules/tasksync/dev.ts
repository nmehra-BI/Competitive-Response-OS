/**
 * Dev/test-only simulator controls (`auth: 'dev_only'`): the server registers these routes only when
 * AUTH_MODE=dev. They also answer only for illustrative tenants, and the connection must belong to
 * the caller's tenant (read under RLS), so one tenant can neither fault nor inspect another's tool.
 */
import { createPgSimStore } from '@growth-os/connectors';
import { API } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import type { Authorization, Identity } from '../../platform/context';
import { notFound } from '../../platform/errors';
import { command, query, type HandlerMap } from '../../platform/pipeline';

async function connectionOf(tx: Tx, id: string): Promise<{ id: string; name: string; provider: string }> {
  const c = await tx
    .selectFrom('platform.connection')
    .select(['id', 'name', 'provider'])
    .where('id', '=', id)
    .where('kind', '=', 'task_tool')
    .executeTakeFirst();
  if (!c) throw notFound();
  return c;
}

function devAccess(identity: Identity): Authorization {
  if (identity.actor.kind !== 'human')
    return { allow: false, rule: 'dev:simulator', code: 'AGENT_IDENTITY_FORBIDDEN', reason: 'People only.' };
  if (!identity.tenant.illustrative)
    return {
      allow: false,
      rule: 'dev:simulator',
      code: 'FORBIDDEN',
      reason: 'Simulator controls are for illustrative workspaces only.',
    };
  return { allow: true, rule: 'dev:simulator', authorityGrantId: null, role: null };
}

export const devHandlers: HandlerMap = {
  [API.dev.setFaults.id]: command(API.dev.setFaults, {
    load: (ctx, tx) => connectionOf(tx, ctx.body.connectionId),
    authorize: (ctx) => devAccess(ctx.identity),
    handle: async (ctx, t, conn) => {
      const rules = await createPgSimStore(ctx.deps.db).setFaultRules(
        conn.id,
        ctx.body.rules.map((r) => ({ mode: r.mode, match: r.match, times: r.times })),
      );
      await t.audit({
        action: 'dev.connector_faults_set',
        objectType: 'connection',
        objectId: conn.id,
        summary:
          `Simulator faults set on ${conn.name}: ${rules.map((r) => r.mode).join(', ') || 'none'}`.slice(
            0,
            280,
          ),
        details: { rules: rules.length },
      });
      return { rules };
    },
  }),

  [API.dev.simulatedIssues.id]: query(API.dev.simulatedIssues, {
    load: (ctx, tx) => connectionOf(tx, ctx.query.connectionId),
    authorize: (ctx) => devAccess(ctx.identity),
    handle: async (ctx, _t, conn) => {
      const issues = await createPgSimStore(ctx.deps.db).listIssues(conn.id);
      return {
        items: issues.map((i) => ({
          key: i.key,
          title: i.title,
          idempotencyKey: i.idempotencyKey,
          assignee: i.assignee,
          createdAt: i.createdAt,
        })),
      };
    },
  }),
};
