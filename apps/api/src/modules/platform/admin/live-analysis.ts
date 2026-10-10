/**
 * S14 › Live analysis (D-120 §4, D-130). Off per tenant by default. An administrator turns it on only
 * after the signed addendum is recorded (reference and date) and a manual eval run passed on the
 * configured provider; the database refuses `live_enabled` otherwise. Enabling and disabling are
 * audited. The setting records documents, never a model identifier (the model is configuration).
 * The worker checks this setting before any call to a live provider.
 */
import { API, type LiveAnalysisSetting } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { roleAllows } from '../../../platform/authz';
import { ApiError } from '../../../platform/errors';
import { command, query, type HandlerMap } from '../../../platform/pipeline';
import { isoDate, isoDateTime, isoDateTimeOrNull, personRef } from '../../../platform/serialize';

/** The deployment runs a live provider (anything but the deterministic fixture provider). */
export const liveProviderConfigured = (env: NodeJS.ProcessEnv = process.env): boolean =>
  (env.ANALYSIS_PROVIDER ?? 'fixture') !== 'fixture';

async function settingOf(tx: Tx): Promise<LiveAnalysisSetting> {
  const r = await tx.selectFrom('platform.tenant_ai_setting').selectAll().executeTakeFirst();
  const who = r?.changed_by
    ? await tx
        .selectFrom('platform.app_user')
        .select(['id', 'display_name', 'title', 'initials'])
        .where('id', '=', r.changed_by)
        .executeTakeFirst()
    : undefined;
  return {
    enabled: r?.live_enabled ?? false,
    addendumRef: r?.addendum_ref ?? null,
    addendumSignedOn: r?.addendum_signed_on ? isoDate(r.addendum_signed_on) : null,
    evalRunRef: r?.eval_run_ref ?? null,
    evalPassedAt: isoDateTimeOrNull(r?.eval_passed_at ?? null),
    liveProviderConfigured: liveProviderConfigured(),
    changedBy: who ? personRef(who) : null,
    changedAt: r ? isoDateTime(r.changed_at) : null,
  };
}

const invalid = (path: string, message: string) =>
  new ApiError('VALIDATION_FAILED', message, { errors: [{ path, code: 'invalid', message }] });

export const liveAnalysisHandlers: HandlerMap = {
  [API.admin.liveAnalysis.id]: query(API.admin.liveAnalysis, {
    authorize: (ctx) => roleAllows(ctx.identity.subject, 'admin.configure'),
    handle: async (_ctx, { tx }) => settingOf(tx),
  }),

  [API.admin.setLiveAnalysis.id]: command(API.admin.setLiveAnalysis, {
    authorize: (ctx) => roleAllows(ctx.identity.subject, 'admin.configure'),
    handle: async (ctx, t) => {
      const b = ctx.body;
      const today = ctx.now.toISOString().slice(0, 10);
      if (b.enabled) {
        if (!b.addendumRef || !b.addendumSignedOn)
          throw invalid(
            'body.addendumRef',
            'Record the signed data-processing addendum (reference and date) before turning live analysis on',
          );
        if (!b.evalRunRef || !b.evalPassedAt)
          throw invalid(
            'body.evalRunRef',
            'Record a passing manual eval run on the configured provider before turning live analysis on',
          );
        if (b.addendumSignedOn > today)
          throw invalid('body.addendumSignedOn', 'The addendum cannot be signed in the future');
        if (Date.parse(b.evalPassedAt) > ctx.now.getTime())
          throw invalid('body.evalPassedAt', 'The eval run cannot have passed in the future');
      }
      const before = await settingOf(t.tx);
      const values = {
        live_enabled: b.enabled,
        addendum_ref: b.addendumRef,
        addendum_signed_on: b.addendumSignedOn,
        eval_run_ref: b.evalRunRef,
        eval_passed_at: b.evalPassedAt ? new Date(b.evalPassedAt) : null,
        changed_by: ctx.userId,
        changed_at: ctx.now,
      };
      await t.tx
        .insertInto('platform.tenant_ai_setting')
        .values({ tenant_id: ctx.tenantId, ...values })
        .onConflict((oc) => oc.column('tenant_id').doUpdateSet(values))
        .execute();
      const after = await settingOf(t.tx);
      await t.audit({
        action: b.enabled ? 'admin.live_analysis_enabled' : 'admin.live_analysis_disabled',
        objectType: 'tenant_ai_setting',
        objectId: ctx.tenantId,
        summary: b.enabled
          ? `Live analysis turned on · addendum ${b.addendumRef} · eval ${b.evalRunRef}`.slice(0, 280)
          : 'Live analysis turned off',
        details: {
          enabled: b.enabled,
          addendumRef: b.addendumRef,
          evalRunRef: b.evalRunRef,
          liveProviderConfigured: after.liveProviderConfigured,
        },
        before,
        after,
      });
      return after;
    },
  }),
};
