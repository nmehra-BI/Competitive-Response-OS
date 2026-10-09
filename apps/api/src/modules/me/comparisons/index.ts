/**
 * Comparison (S04, ME-04). Ratings are named reviewers' 1–3 assessments; Unknown is null, never 0.
 * Ranking is the WS2 RankingEngine (D-057) and its row order IS the rank order (never re-sorted here).
 * An incomparable boundary that is not excluded blocks the whole ranking. Weights are versioned.
 * Creating a comparison for a candidate set that already has one on the mandate returns it.
 */
import { API, type Comparison, type ComparisonAttribute, type ComparisonCell, type RankingWeights } from '@growth-os/contracts';
import { createRankingEngine, opportunityMachine, RANKING_FORMULA_TEXT, totalWeight, weightsValid, type RankingInputRow } from '@growth-os/domain';
import type { Tx } from '@growth-os/db';
import { roleAllows } from '../../../platform/authz';
import type { Authorization, Identity } from '../../../platform/context';
import { ApiError, notFound } from '../../../platform/errors';
import { command, query, type HandlerMap } from '../../../platform/pipeline';
import { machineRefusal } from '../cases/access';
import { chipsFor, sourceChips } from '../cases/sources';
import { findMandate, mandateVisible } from '../mandates';
import { findOpportunity } from '../opportunities/read';

const ranking = createRankingEngine();
const RATED: ComparisonAttribute[] = ['product_fit', 'channel_access', 'evidence_coverage'];
const LABEL = { 3: 'High', 2: 'Medium', 1: 'Low' } as const;
const DEFAULT_WEIGHTS = { productFit: 40, channelAccess: 30, evidenceCoverage: 30 };

type ComparisonRow = {
  id: string;
  mandate_id: string;
  opportunity_ids: string[];
  common_unit_text: string;
  selected_opportunity_id: string | null;
  created_at: Date;
};
type Mandate = NonNullable<Awaited<ReturnType<typeof findMandate>>>;

async function loadComparison(tx: Tx, id: string): Promise<{ cmp: ComparisonRow; mandate: Mandate }> {
  const cmp = (await tx.selectFrom('me.comparison').selectAll().where('id', '=', id).executeTakeFirst()) as
    | ComparisonRow
    | undefined;
  if (!cmp) throw notFound();
  const mandate = await findMandate(tx, cmp.mandate_id);
  if (!mandate) throw notFound();
  return { cmp, mandate };
}

function canTriage(identity: Identity, m: Mandate): Authorization {
  const v = mandateVisible(identity, m.business_unit_id);
  if (!v.allow) return v;
  return roleAllows(identity.subject, 'opportunity.triage', { businessUnitId: m.business_unit_id, caseId: null });
}

async function rankingInputs(tx: Tx, cmp: ComparisonRow): Promise<RankingInputRow[]> {
  const cells = await tx.selectFrom('me.comparison_cell').selectAll().where('comparison_id', '=', cmp.id).execute();
  const excluded = await tx.selectFrom('me.comparison_exclusion').select('opportunity_id').where('comparison_id', '=', cmp.id).execute();
  const rating = (o: string, a: string) => (cells.find((c) => c.opportunity_id === o && c.attribute === a)?.rating ?? null) as 1 | 2 | 3 | null;
  return cmp.opportunity_ids.map((o) => ({
    opportunityId: o,
    productFit: rating(o, 'product_fit'),
    channelAccess: rating(o, 'channel_access'),
    evidenceCoverage: rating(o, 'evidence_coverage'),
    excluded: excluded.some((e) => e.opportunity_id === o),
    incomparable: cells.some((c) => c.opportunity_id === o && c.incomparable),
  }));
}

async function weightRows(tx: Tx, id: string): Promise<RankingWeights[]> {
  const rows = await tx.selectFrom('me.comparison_weights_version').selectAll().where('comparison_id', '=', id).orderBy('version').execute();
  return rows.map((w) => ({
    version: w.version,
    productFit: w.product_fit,
    channelAccess: w.channel_access,
    evidenceCoverage: w.evidence_coverage,
  }));
}

export async function toComparison(tx: Tx, identity: Identity, cmp: ComparisonRow): Promise<Comparison> {
  const cells = await tx.selectFrom('me.comparison_cell').selectAll().where('comparison_id', '=', cmp.id).execute();
  const opps = await tx.selectFrom('me.opportunity').select(['id', 'name']).where('id', 'in', cmp.opportunity_ids).execute();
  const chips = await sourceChips(tx, identity, cells.flatMap((c) => c.source_ids));
  const out: ComparisonCell[] = [];
  for (const o of cmp.opportunity_ids) {
    for (const c of cells.filter((x) => x.opportunity_id === o))
      out.push({
        opportunityId: o,
        attribute: c.attribute as ComparisonAttribute,
        rating: c.rating,
        ratingLabel: c.rating ? LABEL[c.rating as 1 | 2 | 3] : null,
        valueText: c.value_text,
        detailText: c.detail_text,
        unknown: RATED.includes(c.attribute as ComparisonAttribute) && c.rating === null,
        incomparable: c.incomparable,
        sources: chipsFor(chips, c.source_ids),
      });
    for (const a of RATED)
      if (!cells.some((x) => x.opportunity_id === o && x.attribute === a))
        out.push({
          opportunityId: o,
          attribute: a,
          rating: null,
          ratingLabel: null,
          valueText: 'Unknown',
          detailText: null,
          unknown: true,
          incomparable: false,
          sources: [],
        });
  }
  const history = await weightRows(tx, cmp.id);
  const weights = history[history.length - 1] ?? { version: 1, ...DEFAULT_WEIGHTS };
  const inputs = await rankingInputs(tx, cmp);
  const ranked = ranking.rank(inputs, weights);
  return {
    id: cmp.id,
    mandateId: cmp.mandate_id,
    opportunityIds: cmp.opportunity_ids,
    commonUnitLabel: cmp.common_unit_text,
    cells: out,
    excludedOpportunityIds: inputs.filter((i) => i.excluded).map((i) => i.opportunityId),
    incomparableWarnings: cells
      .filter((c) => c.incomparable)
      .map((c) => ({
        opportunityId: c.opportunity_id,
        message: `${opps.find((o) => o.id === c.opportunity_id)?.name ?? 'Candidate'}: ${c.value_text ?? 'different boundary'} — not on the common unit. Exclude until normalized.`,
      })),
    weights,
    weightsHistory: history,
    ranking: ranked.ranking, // engine order = rank order
    formulaText: RANKING_FORMULA_TEXT,
    selectedOpportunityId: cmp.selected_opportunity_id,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

type WeightsBody = { productFit: number; channelAccess: number; evidenceCoverage: number };
function checkWeights(w: WeightsBody): void {
  if (!weightsValid(w))
    throw new ApiError('VALIDATION_FAILED', 'Weights must total 100%', {
      errors: [{ path: 'body', code: 'weights_total', message: `Weights total ${totalWeight(w)}%; they must total 100%` }],
    });
}

export const comparisonHandlers: HandlerMap = {
  [API.comparisons.create.id]: command(API.comparisons.create, {
    load: async (ctx, tx) => {
      const mandate = await findMandate(tx, ctx.body.mandateId);
      if (!mandate) throw notFound();
      const ids: string[] = [];
      for (const ref of ctx.body.opportunityRefs) {
        const o = await findOpportunity(tx, ref);
        if (!o || o.mandate_id !== mandate.id) throw notFound();
        if (!ids.includes(o.id)) ids.push(o.id);
      }
      if (ids.length < 2) throw new ApiError('VALIDATION_FAILED', 'Compare at least two different candidates.');
      return { mandate, ids };
    },
    authorize: (ctx, l) => canTriage(ctx.identity, l.mandate),
    handle: async (ctx, t, { mandate, ids }) => {
      const { tx } = t;
      const existing = ((await tx
        .selectFrom('me.comparison')
        .selectAll()
        .where('mandate_id', '=', mandate.id)
        .orderBy('created_at', 'desc')
        .execute()) as ComparisonRow[]).find((c) => sameSet(c.opportunity_ids, ids));
      if (existing) {
        await t.audit({
          action: 'comparison.reopened',
          objectType: 'comparison',
          objectId: existing.id,
          summary: `Existing comparison reopened for the same ${ids.length} candidates`,
        });
        return toComparison(tx, ctx.identity, existing);
      }
      const ver = await tx
        .selectFrom('me.mandate_version')
        .select(['currency', 'horizon_years'])
        .where('id', '=', (mandate.current_version_id ?? mandate.draft_version_id)!)
        .executeTakeFirst();
      const unit = `Common unit: annual spend · unique sites · ${ver?.currency ?? 'EUR'} · ${ctx.now.getUTCFullYear()} prices · horizon ${ver?.horizon_years ?? 3} years`;
      const cmp = (await tx
        .insertInto('me.comparison')
        .values({
          tenant_id: ctx.tenantId,
          mandate_id: mandate.id,
          opportunity_ids: ids,
          common_unit_text: unit,
          created_by: ctx.userId,
          created_at: ctx.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as ComparisonRow;
      await tx
        .insertInto('me.comparison_weights_version')
        .values({
          tenant_id: ctx.tenantId,
          comparison_id: cmp.id,
          version: 1,
          product_fit: DEFAULT_WEIGHTS.productFit,
          channel_access: DEFAULT_WEIGHTS.channelAccess,
          evidence_coverage: DEFAULT_WEIGHTS.evidenceCoverage,
          applied_by: ctx.userId,
          applied_at: ctx.now,
        })
        .execute();
      // Reviewers' ratings belong to the candidate: carry the latest ones from earlier comparisons.
      for (const o of ids) {
        const prior = await tx
          .selectFrom('me.comparison_cell as c')
          .innerJoin('me.comparison as p', 'p.id', 'c.comparison_id')
          .selectAll('c')
          .select('p.created_at as cmp_at')
          .where('c.opportunity_id', '=', o)
          .orderBy('p.created_at', 'desc')
          .execute();
        const seen = new Set<string>();
        for (const c of prior) {
          if (seen.has(c.attribute)) continue;
          seen.add(c.attribute);
          await tx
            .insertInto('me.comparison_cell')
            .values({
              tenant_id: ctx.tenantId,
              comparison_id: cmp.id,
              opportunity_id: o,
              attribute: c.attribute,
              rating: c.rating,
              value_text: c.value_text,
              detail_text: c.detail_text,
              incomparable: c.incomparable,
              rated_by: c.rated_by,
              source_ids: c.source_ids,
            })
            .execute();
        }
      }
      await t.audit({
        action: 'comparison.created',
        objectType: 'comparison',
        objectId: cmp.id,
        summary: `Comparison of ${ids.length} candidates created for ${mandate.display_key}`,
      });
      return toComparison(tx, ctx.identity, cmp);
    },
  }),

  [API.comparisons.get.id]: query(API.comparisons.get, {
    load: (ctx, tx) => loadComparison(tx, ctx.params.id),
    authorize: (ctx, l) => mandateVisible(ctx.identity, l.mandate.business_unit_id),
    handle: (ctx, { tx }, l) => toComparison(tx, ctx.identity, l.cmp),
  }),

  [API.comparisons.previewRanking.id]: query(API.comparisons.previewRanking, {
    load: (ctx, tx) => loadComparison(tx, ctx.params.id),
    authorize: (ctx, l) => mandateVisible(ctx.identity, l.mandate.business_unit_id),
    handle: async (ctx, { tx }, l) => {
      const r = ranking.rank(await rankingInputs(tx, l.cmp), ctx.body);
      return { ranking: r.ranking, totalWeight: totalWeight(ctx.body), valid: r.valid };
    },
  }),

  [API.comparisons.applyWeights.id]: command(API.comparisons.applyWeights, {
    load: (ctx, tx) => loadComparison(tx, ctx.params.id),
    authorize: (ctx, l) => canTriage(ctx.identity, l.mandate),
    handle: async (ctx, t, { cmp }) => {
      checkWeights(ctx.body);
      const prev = await weightRows(t.tx, cmp.id);
      const version = (prev[prev.length - 1]?.version ?? 0) + 1;
      await t.tx
        .insertInto('me.comparison_weights_version')
        .values({
          tenant_id: ctx.tenantId,
          comparison_id: cmp.id,
          version,
          product_fit: ctx.body.productFit,
          channel_access: ctx.body.channelAccess,
          evidence_coverage: ctx.body.evidenceCoverage,
          applied_by: ctx.userId,
          applied_at: ctx.now,
        })
        .execute();
      await t.audit({
        action: 'comparison.weights_applied',
        objectType: 'comparison',
        objectId: cmp.id,
        objectVersion: version,
        summary: `Ranking weights v${version}: ${ctx.body.productFit}/${ctx.body.channelAccess}/${ctx.body.evidenceCoverage}`,
      });
      return toComparison(t.tx, ctx.identity, cmp);
    },
  }),

  [API.comparisons.setExclusion.id]: command(API.comparisons.setExclusion, {
    load: (ctx, tx) => loadComparison(tx, ctx.params.id),
    authorize: (ctx, l) => canTriage(ctx.identity, l.mandate),
    handle: async (ctx, t, { cmp }) => {
      const o = ctx.params.opportunityId;
      if (!cmp.opportunity_ids.includes(o)) throw notFound();
      if (ctx.body.excluded) {
        if (!ctx.body.reason?.trim())
          throw new ApiError('VALIDATION_FAILED', 'Give a reason for excluding this candidate.', {
            errors: [{ path: 'body.reason', code: 'required', message: 'Give a reason.' }],
          });
        await t.tx
          .insertInto('me.comparison_exclusion')
          .values({
            tenant_id: ctx.tenantId,
            comparison_id: cmp.id,
            opportunity_id: o,
            reason: ctx.body.reason,
            excluded_by: ctx.userId,
            excluded_at: ctx.now,
          })
          .onConflict((oc) => oc.columns(['comparison_id', 'opportunity_id']).doNothing())
          .execute();
      } else {
        await t.tx.deleteFrom('me.comparison_exclusion').where('comparison_id', '=', cmp.id).where('opportunity_id', '=', o).execute();
      }
      await t.audit({
        action: ctx.body.excluded ? 'comparison.candidate_excluded' : 'comparison.candidate_included',
        objectType: 'comparison',
        objectId: cmp.id,
        summary: ctx.body.excluded ? 'Candidate excluded from the ranking (stays in the table)' : 'Candidate included in the ranking',
        details: { opportunityId: o },
      });
      return toComparison(t.tx, ctx.identity, cmp);
    },
  }),

  [API.comparisons.select.id]: command(API.comparisons.select, {
    load: (ctx, tx) => loadComparison(tx, ctx.params.id),
    authorize: (ctx, l) => canTriage(ctx.identity, l.mandate),
    handle: async (ctx, t, { cmp, mandate }) => {
      const o = ctx.body.opportunityId;
      if (!cmp.opportunity_ids.includes(o)) throw notFound();
      const opp = (await findOpportunity(t.tx, o))!;
      if (opp.status === 'detected') {
        const r = opportunityMachine.apply('detected', 'shortlist', ctx.identity.actor, {
          mandateApproved: mandate.status === 'approved',
        });
        if (!r.ok) throw machineRefusal(r);
        await t.tx.updateTable('me.opportunity').set({ status: 'shortlisted' }).where('id', '=', o).execute();
        await t.analytics('opportunity_shortlisted', { objectType: 'opportunity', objectId: o }, { origin: opp.origin as 'ai' });
      } else if (opp.status !== 'shortlisted' && opp.status !== 'converted') {
        throw new ApiError('INVALID_TRANSITION', `${opp.display_key} is ${opp.status} and cannot be selected.`);
      }
      const updated = (await t.tx
        .updateTable('me.comparison')
        .set({ selected_opportunity_id: o })
        .where('id', '=', cmp.id)
        .returningAll()
        .executeTakeFirstOrThrow()) as ComparisonRow;
      await t.audit({
        action: 'comparison.selected_for_assessment',
        objectType: 'comparison',
        objectId: cmp.id,
        summary: `${opp.display_key} selected for assessment (no spend approved)`,
        details: { opportunityId: o },
      });
      return toComparison(t.tx, ctx.identity, updated);
    },
  }),
};
