/**
 * ⌘K search (ME-16). Matches display keys and titles/names of cases, mandates, opportunities,
 * assumptions, experiments and sources the viewer can access. It never searches source content
 * (passages): restricted text cannot leak through a hit, and sources the viewer may not see are
 * not returned or counted. Search never offers Approve.
 */
import { API, type SearchHit } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { canReadCase, matchingRole, roleAllows } from '../../../platform/authz';
import { casesByIds } from '../../../platform/cases';
import type { Identity } from '../../../platform/context';
import { query, type HandlerMap } from '../../../platform/pipeline';
import { sourceUses } from '../evidence/links';

/** ILIKE pattern with the user's wildcards escaped. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

async function searchAll(tx: Tx, identity: Identity, q: string, limit: number): Promise<SearchHit[]> {
  const like = likePattern(q.trim());
  const per = limit * 3;
  const [cases, mandates, opportunities, assumptions, experiments, sources] = await Promise.all([
    tx
      .selectFrom('platform.workflow_case')
      .select(['id', 'display_key', 'title', 'stage', 'business_unit_id', 'owner_user_id', 'sponsor_user_id'])
      .where((eb) => eb.or([eb('display_key', 'ilike', like), eb('title', 'ilike', like)]))
      .orderBy('display_key')
      .limit(per)
      .execute(),
    tx
      .selectFrom('me.mandate')
      .select(['id', 'display_key', 'title', 'business_unit_id', 'status'])
      .where((eb) => eb.or([eb('display_key', 'ilike', like), eb('title', 'ilike', like)]))
      .orderBy('display_key')
      .limit(per)
      .execute(),
    tx
      .selectFrom('me.opportunity as o')
      .innerJoin('me.mandate as m', 'm.id', 'o.mandate_id')
      .select([
        'o.id',
        'o.display_key',
        'o.name',
        'o.status',
        'm.display_key as mandate_key',
        'm.business_unit_id',
      ])
      .where((eb) => eb.or([eb('o.display_key', 'ilike', like), eb('o.name', 'ilike', like)]))
      .orderBy('o.display_key')
      .limit(per)
      .execute(),
    tx
      .selectFrom('platform.assumption')
      .select(['id', 'display_key', 'name', 'case_id'])
      .where((eb) => eb.or([eb('display_key', 'ilike', like), eb('name', 'ilike', like)]))
      .orderBy('display_key')
      .limit(per)
      .execute(),
    tx
      .selectFrom('me.experiment')
      .select(['id', 'display_key', 'title', 'case_id'])
      .where((eb) => eb.or([eb('display_key', 'ilike', like), eb('title', 'ilike', like)]))
      .orderBy('display_key')
      .limit(per)
      .execute(),
    roleAllows(identity.subject, 'source.read_metadata').allow
      ? tx
          .selectFrom('platform.source')
          .select(['id', 'display_key', 'title', 'publisher', 'freshness'])
          .where((eb) => eb.or([eb('display_key', 'ilike', like), eb('title', 'ilike', like)]))
          .orderBy('display_key')
          .limit(per)
          .execute()
      : Promise.resolve([]),
  ]);

  const uses = await sourceUses(
    tx,
    sources.map((s) => s.id),
  );
  const caseRows = await casesByIds(tx, [
    ...cases.map((c) => c.id),
    ...assumptions.map((a) => a.case_id),
    ...experiments.map((e) => e.case_id),
    ...uses.map((u) => u.caseId),
  ]);
  const caseById = new Map(caseRows.map((c) => [c.id, c]));
  const readable = (caseId: string) => {
    const c = caseById.get(caseId);
    return c !== undefined && canReadCase(identity.subject, c);
  };
  const buReadable = (bu: string) =>
    matchingRole(identity.subject, 'case.read', { businessUnitId: bu, caseId: null }) !== null;

  const hits: SearchHit[] = [
    ...cases
      .filter((c) => readable(c.id))
      .map((c) => ({
        type: 'case' as const,
        id: c.id,
        key: c.display_key,
        title: c.title,
        subtitle: `Expansion case · ${c.stage.replace(/_/g, ' ')}`,
        href: `/me/cases/${c.display_key}/thesis`,
      })),
    ...mandates
      .filter((m) => buReadable(m.business_unit_id))
      .map((m) => ({
        type: 'mandate' as const,
        id: m.id,
        key: m.display_key,
        title: m.title,
        subtitle: 'Mandate',
        href: `/me/mandates/${m.display_key}`,
      })),
    ...opportunities
      .filter((o) => buReadable(o.business_unit_id))
      .map((o) => ({
        type: 'opportunity' as const,
        id: o.id,
        key: o.display_key,
        title: o.name,
        subtitle: `Opportunity · ${o.mandate_key}`,
        href: `/me/opportunities?mandate=${o.mandate_key}&selected=${o.display_key}`,
      })),
    ...assumptions
      .filter((a) => readable(a.case_id))
      .map((a) => ({
        type: 'assumption' as const,
        id: a.id,
        key: a.display_key,
        title: a.name,
        subtitle: `Assumption · ${caseById.get(a.case_id)!.key}`,
        href: `/me/cases/${caseById.get(a.case_id)!.key}/validation`,
      })),
    ...experiments
      .filter((e) => readable(e.case_id))
      .map((e) => ({
        type: 'experiment' as const,
        id: e.id,
        key: e.display_key,
        title: e.title,
        subtitle: `Experiment · ${caseById.get(e.case_id)!.key}`,
        href: `/me/cases/${caseById.get(e.case_id)!.key}/validation`,
      })),
    ...sources
      .filter((s) => {
        const own = uses.filter((u) => u.sourceId === s.id);
        return own.length === 0 || own.some((u) => readable(u.caseId));
      })
      .map((s) => ({
        type: 'source' as const,
        id: s.id,
        key: s.display_key,
        title: s.title,
        subtitle: `Source${s.publisher ? ` · ${s.publisher}` : ''}`,
        href: `/evidence/${s.display_key}`,
      })),
  ];
  return hits.slice(0, limit);
}

export const searchHandlers: HandlerMap = {
  [API.search.search.id]: query(API.search.search, {
    // Any signed-in person may search; results are filtered to what they can access.
    authorize: () => ({ allow: true, rule: 'search.filtered', authorityGrantId: null, role: null }),
    handle: async (ctx, { tx }) => ({
      hits: await searchAll(tx, ctx.identity, ctx.query.q, ctx.query.limit),
    }),
  }),
};
