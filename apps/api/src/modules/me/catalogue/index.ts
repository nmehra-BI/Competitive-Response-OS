/**
 * Scope options for S02 and S14 (D-068 §13, D-079): the business units the viewer can see, the tenant's
 * product and segment catalogue, and the countries in use (mandate geographies and opportunity
 * countries). Names only; nothing here is restricted content.
 */
import { API, type ScopeOptions } from '@growth-os/contracts';
import { notFound } from '../../../platform/errors';
import { query, type HandlerMap } from '../../../platform/pipeline';
import { businessUnitOr404, directoryReader } from '../../platform/directory';

export const catalogueHandlers: HandlerMap = {
  [API.directory.scopeOptions.id]: query(API.directory.scopeOptions, {
    load: (ctx, tx) => businessUnitOr404(tx, ctx.query.businessUnitId),
    authorize: (ctx) => directoryReader(ctx.identity, 'catalogue.scope_options'),
    handle: async (ctx, { tx }) => {
      const active = ctx.identity.roles.filter((r) => !r.revokedAt);
      const caseIds = active.filter((r) => r.caseId).map((r) => r.caseId!);
      const caseBus = caseIds.length
        ? await tx
            .selectFrom('platform.workflow_case')
            .select('business_unit_id')
            .where('id', 'in', caseIds)
            .execute()
        : [];
      const tenantWide = active.some((r) => !r.businessUnitId && !r.caseId);
      const visible = new Set([
        ...active.flatMap((r) => (r.businessUnitId ? [r.businessUnitId] : [])),
        ...caseBus.map((c) => c.business_unit_id),
      ]);
      const bu = ctx.query.businessUnitId;
      if (bu && !tenantWide && !visible.has(bu)) throw notFound();
      const businessUnits = (
        await tx.selectFrom('platform.business_unit').select(['id', 'key', 'name']).orderBy('name').execute()
      ).filter((b) => tenantWide || visible.has(b.id));
      const products = await tx
        .selectFrom('platform.product')
        .select(['id', 'key', 'name'])
        .orderBy('name')
        .execute();
      const segments = await tx
        .selectFrom('platform.segment')
        .select(['id', 'key', 'name'])
        .orderBy('name')
        .execute();
      const buIds = bu ? [bu] : businessUnits.map((b) => b.id);
      const mandates = buIds.length
        ? await tx
            .selectFrom('me.mandate as m')
            .leftJoin('me.mandate_version as v', (j) =>
              j.on((eb) => eb('v.id', '=', eb.fn.coalesce('m.current_version_id', 'm.draft_version_id'))),
            )
            .select(['m.id', 'v.geography_codes'])
            .where('m.business_unit_id', 'in', buIds)
            .execute()
        : [];
      const opps = mandates.length
        ? await tx
            .selectFrom('me.opportunity')
            .select('country_code')
            .where(
              'mandate_id',
              'in',
              mandates.map((m) => m.id),
            )
            .where('country_code', 'is not', null)
            .execute()
        : [];
      const countries = [
        ...new Set([
          ...mandates.flatMap((m) => m.geography_codes ?? []),
          ...opps.map((o) => o.country_code!),
        ]),
      ].sort();
      const out: ScopeOptions = { businessUnits, products, segments, countries };
      return out;
    },
  }),
};
