/**
 * Dev clock (`auth: 'dev_only'`, decisions.md D-091): the server registers these routes only with
 * AUTH_MODE=dev; they answer only in illustrative tenants (the table refuses others too). Moving the
 * clock is audited and enqueues the pilot-window and approval-expiry timers so their effect is visible
 * at once. Forward only: going back would make recorded business times lie, so reseed instead.
 */
import { API } from '@growth-os/contracts';
import { devClockOffsetMs } from '@growth-os/db';
import type { Authorization, Identity } from '../../../platform/context';
import { ApiError } from '../../../platform/errors';
import { command, query, type HandlerMap } from '../../../platform/pipeline';

const DAY_MS = 24 * 60 * 60 * 1000;

function devAccess(identity: Identity): Authorization {
  if (identity.actor.kind !== 'human')
    return { allow: false, rule: 'dev:clock', code: 'AGENT_IDENTITY_FORBIDDEN', reason: 'People only.' };
  if (!identity.tenant.illustrative || process.env.NODE_ENV === 'production')
    return {
      allow: false,
      rule: 'dev:clock',
      code: 'FORBIDDEN',
      reason: 'The dev clock is for illustrative workspaces only.',
    };
  return { allow: true, rule: 'dev:clock', authorityGrantId: null, role: null };
}

export const devClockHandlers: HandlerMap = {
  [API.dev.clock.id]: query(API.dev.clock, {
    authorize: (ctx) => devAccess(ctx.identity),
    handle: async (ctx, { tx }) => {
      const row = await tx
        .selectFrom('platform.dev_clock')
        .select(['offset_ms', 'set_at'])
        .executeTakeFirst();
      return {
        now: ctx.now.toISOString(),
        offsetMs: row ? Number(row.offset_ms) : 0,
        setAt: row ? new Date(row.set_at).toISOString() : null,
      };
    },
  }),

  [API.dev.setClock.id]: command(API.dev.setClock, {
    authorize: (ctx) => devAccess(ctx.identity),
    handle: async (ctx, t) => {
      const real = ctx.deps.now();
      const current = await devClockOffsetMs(t.tx);
      const target =
        ctx.body.to !== undefined
          ? new Date(ctx.body.to)
          : new Date(real.getTime() + current + ctx.body.advanceDays! * DAY_MS);
      const offset = target.getTime() - real.getTime();
      if (offset < current)
        throw new ApiError(
          'VALIDATION_FAILED',
          'The dev clock only moves forward. Reseed the workspace to start earlier.',
        );
      const row = await t.tx
        .insertInto('platform.dev_clock')
        .values({ tenant_id: ctx.tenantId, offset_ms: String(offset), set_by: ctx.userId, set_at: real })
        .onConflict((oc) =>
          oc.column('tenant_id').doUpdateSet({ offset_ms: String(offset), set_by: ctx.userId, set_at: real }),
        )
        .returning(['offset_ms', 'set_at'])
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'dev.clock_set',
        objectType: 'tenant',
        objectId: ctx.tenantId,
        summary: `Dev clock moved to ${target.toISOString().slice(0, 16).replace('T', ' ')} UTC (illustrative workspace)`,
        details: { offsetMs: offset, previousOffsetMs: current },
      });
      // Run the timers now (they read each tenant's business time), not at the next cron tick.
      await t.enqueue('timers.pilot_window', {});
      await t.enqueue('timers.approval_expiry', {});
      return {
        now: target.toISOString(),
        offsetMs: Number(row.offset_ms),
        setAt: new Date(row.set_at).toISOString(),
      };
    },
  }),
};
