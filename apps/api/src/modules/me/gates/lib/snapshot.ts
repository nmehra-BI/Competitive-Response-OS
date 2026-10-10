/**
 * Builds decision snapshot content from COMMITTED records and freezes it with the WS3 builder
 * (`createSnapshot`). On refresh/resubmit the narrative fields (ask, recommendation, alternatives,
 * limitations, outcome targets, stop rules, sign-offs) carry over from the previous snapshot; the data
 * fields (assumptions, sizing, economics, validation results, dissent, components) are rebuilt, so the
 * diff shows exactly what changed. Every snapshot names its subject (D-036).
 */
import type { SnapshotContent } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import {
  createSnapshot,
  ME_GATES,
  nextSnapshotVersion,
  type SnapshotBuildInput,
  type SnapshotComponentInput,
} from '@growth-os/domain';
import { ApiError } from '../../../../platform/errors';
import { peopleOf, type CaseLite, tenantIdSql } from './common';
import { committedEconomicsSummary } from '../../economics/read';
import { committedSizingSummary } from '../../sizing/read';
import { committedThesis } from '../../thesis/read';
import { caseSourceIds, defaultStopRules, latestCommittedEconomics, latestCommittedSizing } from './facts';
import {
  contentOf,
  dissentOfCase,
  outcomeTargetsOf,
  proposedConditionsOf,
  scopeOf,
  snapshotById,
  type GateRow,
  type SnapshotRow,
} from './serialize';

type Content = Omit<SnapshotContent, 'schemaVersion' | 'components'>;

function pct(v: string): string {
  const n = Math.round(Number(v) * 10000) / 100;
  return `${n}%`;
}

function grouped(v: string): string {
  const [i = '0', f = ''] = v.split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = f.replace(/0+$/, '');
  return frac ? `${g}.${frac}` : g;
}

/** "€1.2m", "€600k", "€0k": compact display copy for the frozen package table. */
export function fmtCompact(amount: string, currency = 'EUR'): string {
  const sym = currency === 'EUR' ? '€' : `${currency} `;
  const neg = amount.startsWith('-');
  const [i = '0'] = amount.replace(/^-/, '').split('.');
  const n = BigInt(i);
  const sign = neg && n > 0n ? '−' : '';
  if (n >= 1_000_000n) {
    const tenths = (n + 50_000n) / 100_000n;
    return `${sign}${sym}${(tenths / 10n).toString()}.${(tenths % 10n).toString()}m`;
  }
  return `${sign}${sym}${((n + 500n) / 1000n).toString()}k`;
}

export function assumptionValueText(v: {
  value: string | null;
  value_text: string | null;
  unit: string;
}): string {
  if (v.value === null) return v.value_text ?? 'Unknown';
  switch (v.unit) {
    case 'rate':
      return pct(v.value);
    case 'currency_per_year_per_site':
      return `€${grouped(v.value)} per site per year`;
    case 'currency_per_year':
      return `€${grouped(v.value)}/year`;
    case 'currency_one_time':
      return `€${grouped(v.value)} one-time`;
    default:
      return `${grouped(v.value)} ${v.unit}`;
  }
}

interface Built {
  input: SnapshotBuildInput;
  subjectId: string;
  /** Targets to copy into platform.outcome_target from the previous snapshot. */
  prevSnapshotId: string | null;
}

async function mandateSubject(tx: Tx, gate: GateRow) {
  const m = await tx
    .selectFrom('me.mandate')
    .select(['id', 'display_key', 'current_version_id', 'draft_version_id'])
    .where('id', '=', gate.subject_id)
    .executeTakeFirst();
  if (!m) throw new ApiError('NOT_FOUND', 'Not found');
  const v = await tx
    .selectFrom('me.mandate_version')
    .select(['id', 'version', 'state', 'objective'])
    .where('mandate_id', '=', m.id)
    .where('state', '=', 'committed')
    .orderBy('version', 'desc')
    .executeTakeFirst();
  return { m, v };
}

/** Assemble the snapshot input for a gate request from the committed state of its subject. */
export async function buildInput(tx: Tx, gate: GateRow, caseRow: CaseLite | null): Promise<Built> {
  const prevRow = gate.current_snapshot_id ? await snapshotById(tx, gate.current_snapshot_id) : null;
  const prev = prevRow ? contentOf(prevRow) : null;
  const code = gate.gate_code as SnapshotContent['gateCode'];
  const scope = scopeOf(gate);
  const components: SnapshotComponentInput[] = [];

  if (gate.subject_type === 'mandate') {
    const { m, v } = await mandateSubject(tx, gate);
    if (v) components.push({ type: 'mandate_version', id: v.id, version: v.version, state: 'committed' });
    else
      throw new ApiError('PRECONDITIONS_UNMET', 'Commit the mandate before requesting G0.', {
        blockers: [{ key: 'mandate_committed', message: 'The mandate has no committed version.' }],
      });
    const content: Content = {
      caseId: m.id,
      caseKey: m.display_key,
      subject: { type: 'mandate', id: m.id, key: m.display_key },
      gateCode: code,
      ask: prev?.ask ?? `Approve the mandate scope: ${v.objective ?? m.display_key}`,
      scope,
      recommendation: prev?.recommendation ?? 'Approve the bounded mandate scope.',
      alternatives: prev?.alternatives ?? [
        { name: 'No entry.', meaning: 'Do not search this segment.', isNoEntry: true },
      ],
      evidenceSummary: [],
      assumptions: [],
      validationResults: [],
      economics: null,
      sizing: null,
      signOffs: prev?.signOffs ?? [],
      budgetAndStopRules: prev?.budgetAndStopRules ?? [
        'No spend: validation (G1) and pilot (G2) are separate gates',
      ],
      conditionsProposed: proposedConditionsOf(gate),
      dissent: [],
      knownLimitations: prev?.knownLimitations ?? [],
      blockers: [],
      outcomeTargets: [],
    };
    return { input: { ...content, components }, subjectId: m.id, prevSnapshotId: prevRow?.id ?? null };
  }

  if (!caseRow) throw new ApiError('NOT_FOUND', 'Not found');
  const caseId = caseRow.id;

  // Assumptions: every live assumption at its current (immutable) version.
  const asms = await tx
    .selectFrom('platform.assumption as a')
    .innerJoin('platform.assumption_version as v', 'v.id', 'a.current_version_id')
    .select([
      'a.id',
      'a.name',
      'a.display_key',
      'v.id as version_id',
      'v.version',
      'v.value',
      'v.value_text',
      'v.unit',
      (eb) =>
        eb
          .exists(
            eb
              .selectFrom('platform.challenge as c')
              .select('c.id')
              .whereRef('c.target_id', '=', 'a.id')
              .where('c.target_type', '=', 'assumption')
              .where('c.kind', '=', 'dispute')
              .where('c.status', '=', 'open'),
          )
          .as('disputed'),
    ])
    .where('a.case_id', '=', caseId)
    .where('a.status', '<>', 'retired')
    .orderBy('a.display_key')
    .execute();
  for (const a of asms)
    components.push({ type: 'assumption_version', id: a.version_id, version: a.version, state: 'committed' });
  const assumptions = asms.map((a) => ({
    assumptionId: a.id,
    versionId: a.version_id,
    name: a.name,
    valueText: assumptionValueText(a),
    disputed: !!a.disputed,
  }));
  // Keep the previous order (and therefore the stable diff) when the same assumptions are pinned.
  if (prev) {
    const order = new Map(prev.assumptions.map((x, i) => [x.assumptionId, i]));
    assumptions.sort((x, y) => (order.get(x.assumptionId) ?? 1e6) - (order.get(y.assumptionId) ?? 1e6));
  }

  // Sizing and economics summaries come from the WS4a read serializers (D-072): one text for the
  // package, the brief and the seed. Unchanged versions carry over so the diff shows real changes.
  const sizingRow = await latestCommittedSizing(tx, caseId);
  let sizing: Content['sizing'] = null;
  if (sizingRow?.input_hash) {
    components.push({
      type: 'sizing_version',
      id: sizingRow.id,
      version: sizingRow.version,
      state: 'committed',
    });
    if (prev?.sizing && prev.sizing.sizingVersionId === sizingRow.id) sizing = prev.sizing;
    else {
      const sum = await committedSizingSummary(tx, caseId);
      sizing = {
        sizingVersionId: sizingRow.id,
        inputHash: sum?.inputHash ?? sizingRow.input_hash,
        summary: sum?.summary ?? `Sizing v${sizingRow.version}`,
      };
    }
  }
  const econRow = await latestCommittedEconomics(tx, caseId);
  let economics: Content['economics'] = null;
  if (econRow?.input_hash) {
    components.push({
      type: 'economics_version',
      id: econRow.id,
      version: econRow.version,
      state: 'committed',
    });
    if (prev?.economics && prev.economics.economicsVersionId === econRow.id) economics = prev.economics;
    else {
      const sum = await committedEconomicsSummary(tx, caseId);
      if (sum)
        economics = {
          economicsVersionId: sum.economicsVersionId,
          inputHash: sum.inputHash,
          tableText: sum.tableText,
          note: sum.note,
        };
    }
  }
  // First snapshot: the committed thesis states the recommendation and the alternatives. Like the
  // other narrative fields they carry over on refresh; the thesis version is not pinned.
  const thesis = prev ? null : await committedThesis(tx, caseId);

  // Evidence: carried over when unchanged, else the case's cited sources.
  let evidenceSummary = prev?.evidenceSummary;
  if (!evidenceSummary) {
    const ids = await caseSourceIds(tx, caseId);
    const rows = ids.length
      ? await tx
          .selectFrom('platform.source')
          .select(['id', 'display_key', 'title'])
          .where('id', 'in', ids)
          .orderBy('display_key')
          .execute()
      : [];
    evidenceSummary = rows.map((r) => ({ sourceId: r.id, label: `${r.display_key} · ${r.title}` }));
  }
  for (const e of evidenceSummary)
    components.push({ type: 'source', id: e.sourceId, version: null, state: 'committed' });

  // Experiments: G1 pins the plans it authorizes; later gates pin the latest result versions.
  const exps = await tx
    .selectFrom('me.experiment')
    .select(['id', 'display_key', 'lifecycle', 'current_plan_version'])
    .where('case_id', '=', caseId)
    .where('illustrative', '=', false)
    .where('lifecycle', '<>', 'cancelled')
    .orderBy('display_key')
    .execute();
  const validationResults: Content['validationResults'] = [];
  const g1Targets: Content['outcomeTargets'] = [];
  const g1Rules: string[] = [];
  for (const e of exps) {
    if (code === 'G1' && e.lifecycle === 'draft') {
      const plan = await tx
        .selectFrom('me.experiment_plan_version')
        .selectAll()
        .where('experiment_id', '=', e.id)
        .where('version', '=', e.current_plan_version)
        .executeTakeFirst();
      if (!plan) continue;
      // The plan is frozen by the G1 decision (lock); pinning it is what pre-registration means.
      components.push({
        type: 'experiment_plan_version',
        id: plan.id,
        version: plan.version,
        state: 'committed',
      });
      const metrics = await tx
        .selectFrom('me.experiment_metric')
        .selectAll()
        .where('plan_version_id', '=', plan.id)
        .orderBy('metric_key')
        .execute();
      for (const m of metrics)
        g1Targets.push({
          metricKey: m.metric_key,
          name: m.name,
          thresholdText: m.threshold_text,
          window: `${String(plan.window_start).slice(0, 10)} – ${String(plan.window_end).slice(0, 10)}`,
        });
      if (plan.budget_note) g1Rules.push(plan.budget_note);
      for (const r of (plan.decision_rules as { condition: string; action: string }[]) ?? [])
        g1Rules.push(`${r.condition} → ${r.action}`);
    }
    if (code !== 'G1') {
      const res = await tx
        .selectFrom('me.experiment_result_version')
        .selectAll()
        .where('experiment_id', '=', e.id)
        .orderBy('version', 'desc')
        .executeTakeFirst();
      if (!res) continue;
      components.push({
        type: 'experiment_result_version',
        id: res.id,
        version: res.version,
        state: 'committed',
      });
      const carried = prev?.validationResults.find((r) => r.resultVersionId === res.id);
      validationResults.push(
        carried ?? {
          experimentId: e.id,
          resultVersionId: res.id,
          summary: resultSummary(res.observations),
          limitations: res.limitations,
        },
      );
    }
  }

  // Signed feasibility reviews (G2 onwards) are pinned: a scope change makes them stale.
  if (code !== 'G1') {
    const reviews = await tx
      .selectFrom('me.feasibility_assessment as a')
      .innerJoin('me.feasibility_review as r', 'r.id', 'a.current_review_id')
      .select(['r.id', 'r.version'])
      .where('a.case_id', '=', caseId)
      .execute();
    for (const r of reviews)
      components.push({ type: 'feasibility_review', id: r.id, version: r.version, state: 'committed' });
  }

  const signOffs = prevRow ? await carriedSignOffs(tx, prevRow, prev!) : await freshSignOffs(tx, caseId);
  const dissent = (await dissentOfCase(tx, caseId)).map(({ id: _id, ...d }) => d);

  const content: Content = {
    caseId,
    caseKey: caseRow.key,
    subject: { type: 'case', id: caseId, key: caseRow.key },
    gateCode: code,
    ask: prev?.ask ?? defaultAsk(code, scope.amount, scope.currency, scope.durationDays),
    scope,
    recommendation:
      prev?.recommendation ??
      thesis?.fields.recommendation?.value ??
      `Decide on ${ME_GATES[code].name.toLowerCase()} within the stated scope.`,
    alternatives:
      prev?.alternatives ??
      (thesis?.fields.alternatives.length
        ? thesis.fields.alternatives.map((a) => ({
            name: a.name,
            meaning: a.meaning,
            isNoEntry: a.isNoEntry,
          }))
        : [{ name: 'No entry.', meaning: 'Stop here and keep the requested budget.', isNoEntry: true }]),
    evidenceSummary,
    assumptions,
    validationResults,
    economics,
    sizing,
    signOffs,
    budgetAndStopRules:
      prev?.budgetAndStopRules ??
      (code === 'G1' && g1Rules.length
        ? g1Rules
        : scope.amount && scope.currency
          ? defaultStopRules(scope.amount, scope.currency)
          : []),
    conditionsProposed: proposedConditionsOf(gate),
    dissent,
    knownLimitations: prev?.knownLimitations ?? [],
    blockers: [],
    outcomeTargets: prev?.outcomeTargets ?? g1Targets,
  };
  return { input: { ...content, components }, subjectId: caseId, prevSnapshotId: prevRow?.id ?? null };
}

function defaultAsk(
  code: string,
  amount: string | null,
  currency: string | null,
  days: number | null,
): string {
  const money = amount && currency ? `${fmtCompact(amount, currency)}` : '€[amount]';
  switch (code) {
    case 'G1':
      return `Approve validation up to ${money}. This is not a pilot and not market entry.`;
    case 'G2':
      return `Approve a ${days ?? '[duration]'}-day pilot with a budget of up to ${money}. This is not market entry and not a scale decision.`;
    case 'G3':
      return `Authorize scale within ${money}.`;
    case 'X':
      return `Approve a scoped extension within ${amount ? money : '€[cap]'}. This does not unblock G3.`;
    default:
      return 'Approve the scope.';
  }
}

export function resultSummary(observations: unknown): string {
  const obs = (observations as { metricKey: string; observedText: string; result: string | null }[]) ?? [];
  return obs
    .map((o) =>
      o.result === null
        ? `Too early to read · ${o.metricKey}`
        : `${o.result === 'met' ? 'Met' : o.result === 'not_met' ? 'Not met' : 'Inconclusive'} · ${o.observedText}`,
    )
    .join('; ');
}

type SignOff = SnapshotContent['signOffs'][number];

/** Sign-offs carried from the previous snapshot, updated with positions recorded on it. */
async function carriedSignOffs(tx: Tx, prevRow: SnapshotRow, prev: SnapshotContent): Promise<SignOff[]> {
  const rows = await tx
    .selectFrom('platform.reviewer_position')
    .selectAll()
    .where('snapshot_id', '=', prevRow.id)
    .orderBy('signed_at')
    .execute();
  const people = await peopleOf(
    tx,
    rows.map((r) => r.reviewer_user_id),
  );
  const out = [...prev.signOffs];
  for (const r of rows) {
    const s: SignOff = {
      reviewer: people(r.reviewer_user_id),
      area: r.area as SignOff['area'],
      position: r.position as SignOff['position'],
      scopeText: r.scope_text,
      signedVersion: prevRow.version,
      signedAt: new Date(r.signed_at).toISOString(),
    };
    const i = out.findIndex((x) => x.reviewer.id === s.reviewer.id && x.area === s.area);
    if (i >= 0) out[i] = s;
    else out.push(s);
  }
  return out;
}

const DIMENSION_AREA: Record<string, SignOff['area']> = {
  product_fit: 'product',
  differentiation: 'product',
  commercial_access: 'commercial',
  channel: 'commercial',
  competition: 'commercial',
  operations: 'operations',
  specialist_review: 'specialist',
};

/** First snapshot: signed feasibility reviews and the finance model review. */
async function freshSignOffs(tx: Tx, caseId: string): Promise<SignOff[]> {
  const reviews = await tx
    .selectFrom('me.feasibility_assessment as a')
    .innerJoin('me.feasibility_review as r', 'r.id', 'a.current_review_id')
    .select(['a.dimension', 'r.position', 'r.scope_text', 'r.signed_by', 'r.signed_at', 'r.version'])
    .where('a.case_id', '=', caseId)
    .orderBy('r.signed_at')
    .execute();
  const fin = await tx
    .selectFrom('me.model_review')
    .select(['reviewer_user_id', 'position', 'checked_items', 'signed_at'])
    .where('case_id', '=', caseId)
    .where('model_type', '=', 'economics')
    .where('signed_at', 'is not', null)
    .orderBy('signed_at', 'desc')
    .execute();
  const people = await peopleOf(tx, [
    ...reviews.map((r) => r.signed_by),
    ...fin.map((f) => f.reviewer_user_id),
  ]);
  const out: SignOff[] = reviews.map((r) => ({
    reviewer: people(r.signed_by),
    area: DIMENSION_AREA[r.dimension] ?? 'specialist',
    position: r.position as SignOff['position'],
    scopeText: r.scope_text,
    signedVersion: r.version,
    signedAt: new Date(r.signed_at).toISOString(),
  }));
  const f = fin[0];
  if (f?.position)
    out.push({
      reviewer: people(f.reviewer_user_id),
      area: 'finance',
      position: f.position as SignOff['position'],
      scopeText: f.checked_items.length ? `Checked: ${f.checked_items.join(' · ')}` : 'Finance review signed',
      signedVersion: null,
      signedAt: new Date(f.signed_at!).toISOString(),
    });
  return out;
}

/** Freeze, hash and insert a snapshot (+ its component index rows). */
export async function freezeAndInsert(
  tx: Tx,
  gate: GateRow,
  built: Built,
  createdBy: string,
  now: Date,
): Promise<SnapshotRow> {
  const versions = await tx
    .selectFrom('platform.decision_snapshot')
    .select('version')
    .where('subject_id', '=', built.subjectId)
    .execute();
  const r = await createSnapshot(built.input, nextSnapshotVersion(versions.map((v) => v.version)));
  if (!r.ok)
    throw new ApiError(r.code, r.problems[0] ?? 'The snapshot could not be built.', {
      blockers: r.problems.map((p, i) => ({ key: `snapshot_${i + 1}`, message: p })),
    });
  const snap = r.snapshot;
  const row = await tx
    .insertInto('platform.decision_snapshot')
    .values({
      tenant_id: tenantIdSql,
      gate_request_id: gate.id,
      case_id: gate.case_id,
      version: snap.version,
      subject_id: built.subjectId,
      content_canonical: snap.canonical,
      content_hash: snap.hash,
      created_by: createdBy,
      created_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const c of snap.content.components)
    await tx
      .insertInto('platform.snapshot_component')
      .values({
        tenant_id: tenantIdSql,
        snapshot_id: row.id,
        component_type: c.type,
        component_id: c.id,
        component_version: c.version,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  // The first snapshot of a G2 request pre-registers the pilot thresholds stated with the request
  // (D-102); outcome targets are immutable rows, so they can never move after this point.
  if (!built.prevSnapshotId && gate.gate_code === 'G2')
    for (const t of outcomeTargetsOf(gate))
      await tx
        .insertInto('platform.outcome_target')
        .values({
          tenant_id: tenantIdSql,
          case_id: gate.case_id!,
          snapshot_id: row.id,
          metric_key: t.metricKey,
          name: t.name,
          threshold_text: t.thresholdText,
          operator: t.operator,
          threshold_value: t.thresholdValue,
          unit: t.unit,
          window_text: t.windowText,
        })
        .execute();
  // Pre-registered outcome targets travel with the package (thresholds never move silently).
  if (built.prevSnapshotId) {
    const targets = await tx
      .selectFrom('platform.outcome_target')
      .selectAll()
      .where('snapshot_id', '=', built.prevSnapshotId)
      .execute();
    for (const t of targets)
      await tx
        .insertInto('platform.outcome_target')
        .values({
          tenant_id: tenantIdSql,
          case_id: t.case_id,
          snapshot_id: row.id,
          metric_key: t.metric_key,
          name: t.name,
          threshold_text: t.threshold_text,
          operator: t.operator,
          threshold_value: t.threshold_value,
          unit: t.unit,
          window_text: t.window_text,
        })
        .execute();
  }
  return (await snapshotById(tx, row.id))!;
}
