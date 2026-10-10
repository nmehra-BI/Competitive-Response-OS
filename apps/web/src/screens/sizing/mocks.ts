/**
 * S06 Sizing MSW handlers (dev without the API). Every ladder value, check and lineage node comes
 * from the deterministic sizing engine run on the frozen fixture input (`sizingV2Input`) or on the
 * draft edited through `sizing.saveDraft`. Responses are validated against the contract by `mock()`.
 *
 * Also serves `lineage.get` for sizing and economics nodes (S06, S08, S10), falling back to the
 * WS7 hand-built nodes for keys the engines do not produce.
 */
import {
  API,
  type Cohort,
  type LedgerRow,
  type LineageNode,
  type SizingInput,
  type SizingOutput,
  type SizingVersion,
  type SizingView,
} from '@growth-os/contracts';
import {
  COHORT_PROCESS_ID,
  COHORT_PROCESS_IMPORTED_ID,
  COHORT_SIZE_ID,
  fid,
  people,
  sizingMeta,
} from '@growth-os/fixtures-aster';
import { formatLineageValue } from '@growth-os/ui';
import type { HttpHandler } from 'msw';
import { findCase, lineage as ws7Lineage } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { economicsCurrent, economicsDraftInput } from '../economics/mock-builders';
import { mergeLineage } from './engine/adapter';
import {
  ASM,
  assessment,
  CASE_ID,
  CASE_KEY,
  economicsResult,
  type InputEdit,
  nowIso,
  openDisputeFor,
  PEOPLE,
  personOf,
  resolveDuplicate,
  siteListRestrictedFor,
  sizingResult,
  sourceChip,
  syncSizingVariant,
  wsId,
} from './mock-state';

const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');

/** "13 Oct 2026, 16:30" in the tenant time zone (history lines are text, not numbers). */
export function fmtWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Lineage: "Used by" grouped by measure (TAM · SAM · Reachable pool · SOM · Economics)
// ---------------------------------------------------------------------------

/**
 * Equivalent nodes across the two engines. The reachable-pool measure IS the reachable-pool input
 * (bounded by SAM), and economics prices with the same assumption as the sizing spend per site
 * (fixture: `annualPricePerCustomer = { ...annualSpendPerUnit, inputKey: 'annual_price' }`).
 */
const ALIASES: Readonly<Record<string, string[]>> = {
  'sizing.reachable_pool': ['input.reachable_pool'],
  'input.annual_spend_per_site': ['input.annual_price'],
  'input.annual_price': ['input.annual_spend_per_site'],
};

const SAM_NODES = ['sizing.sam.population', 'sizing.sam.value', 'sizing.sam.overlap_removed'];

export function measureOf(nodeKey: string): string | null {
  if (nodeKey.startsWith('sizing.tam.')) return 'TAM';
  if (nodeKey.startsWith('sizing.sam.') || nodeKey.startsWith('sizing.cohort.')) return 'SAM';
  if (nodeKey === 'sizing.reachable_pool') return 'Reachable pool';
  if (nodeKey.startsWith('sizing.som.')) return 'SOM';
  if (nodeKey === 'sizing.cross_check') return 'Top-down cross-check';
  if (nodeKey.startsWith('economics.')) return 'Economics';
  return null;
}

const MEASURE_NODE: Record<string, { tab: 'sizing' | 'economics'; node: string }> = {
  TAM: { tab: 'sizing', node: 'sizing.tam.value' },
  SAM: { tab: 'sizing', node: 'sizing.sam.value' },
  'Reachable pool': { tab: 'sizing', node: 'sizing.reachable_pool' },
  SOM: { tab: 'sizing', node: 'sizing.som.base.annual_revenue' },
  'Top-down cross-check': { tab: 'sizing', node: 'sizing.cross_check' },
  Economics: { tab: 'economics', node: 'economics.base.contribution_after_opex' },
};

export function measureHref(caseKey: string, measure: string): string {
  const m = MEASURE_NODE[measure]!;
  return `/me/cases/${caseKey}/${m.tab}?input=${encodeURIComponent(m.node)}&view=lineage`;
}

/** Measures that depend on a node, directly or through later measures, nearest first. */
export function usedByMeasures(nodes: readonly LineageNode[], nodeKey: string): string[] {
  const own = measureOf(nodeKey);
  const start = own === 'SAM' ? [nodeKey, ...SAM_NODES] : [nodeKey];
  const seen = new Set<string>();
  let frontier = start.flatMap((k) => [k, ...(ALIASES[k] ?? [])]);
  frontier.forEach((k) => seen.add(k));
  const out: string[] = [];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const n of nodes) {
      if (seen.has(n.nodeKey) || !n.inputs.some((k) => frontier.includes(k))) continue;
      for (const k of [n.nodeKey, ...(ALIASES[n.nodeKey] ?? [])]) {
        if (!seen.has(k)) {
          seen.add(k);
          next.push(k);
        }
      }
      const m = measureOf(n.nodeKey);
      if (m && m !== own && !out.includes(m)) out.push(m);
    }
    frontier = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Versions and the view
// ---------------------------------------------------------------------------

const BOUNDARY_ID = fid('boundary', 1);
const CREATED_V1 = '2026-10-09T11:05:00+02:00';

interface Source {
  id: string;
  version: number;
  state: 'draft' | 'committed';
  input: SizingInput;
  edits: InputEdit[];
  rowVersion: number;
  createdAt: string;
  committedAt: string | null;
  committedBy: string | null;
}

function draftSource(): Source | null {
  const d = assessment.sizing.draft;
  if (!d) return null;
  return {
    id: d.id,
    version: d.version,
    state: 'draft',
    input: d.input,
    edits: d.edits,
    rowVersion: d.rowVersion,
    createdAt: d.createdAt,
    committedAt: null,
    committedBy: null,
  };
}

function committedSource(version?: number): Source | null {
  const list = assessment.sizing.committed;
  const c = version === undefined ? list[list.length - 1] : list.find((x) => x.version === version);
  if (!c) return null;
  return {
    id: c.id,
    version: c.version,
    state: 'committed',
    input: c.input,
    edits: c.edits,
    rowVersion: 0,
    createdAt: CREATED_V1,
    committedAt: c.committedAt,
    committedBy: c.committedBy,
  };
}

function cohortName(id: string): string {
  return id === COHORT_SIZE_ID ? 'Size-qualified sites' : 'Process-qualified sites';
}

function changed(edits: InputEdit[], key: string) {
  return edits.some((e) => e.inputKey === key);
}

async function mergedLineage(result: SizingOutput): Promise<LineageNode[]> {
  const econ = await economicsResult(economicsCurrent()!.input);
  return mergeLineage(result.lineage, econ.lineage);
}

async function ledgerFor(src: Source, result: SizingOutput): Promise<LedgerRow[]> {
  const i = src.input;
  const nodes = await mergedLineage(result);
  const used = (nodeKey: string) => usedByMeasures(nodes, nodeKey).length;
  const at = src.committedAt ?? src.createdAt;
  const edited = (k: string) => src.edits.filter((e) => e.inputKey === k).at(-1)?.at ?? at;
  const asm = (key: string) => ASM[key]!;
  const disputed = (key: string) => openDisputeFor(asm(key).id) !== null;
  const row = (r: Omit<LedgerRow, 'lastChangedAt' | 'changedInDraft'>): LedgerRow => ({
    ...r,
    lastChangedAt: edited(r.inputKey),
    changedInDraft: src.state === 'draft' && changed(src.edits, r.inputKey),
  });
  const active = i.cohorts.filter((c) => c.status === 'active');
  const overlap = i.overlaps[0];
  return [
    row({
      inputKey: i.tamPopulation.inputKey,
      name: i.tamPopulation.label,
      value: i.tamPopulation.value,
      unit: i.tamPopulation.unit,
      currency: null,
      kind: 'evidence',
      basis: { source: sourceChip('SRC-014'), owner: null, text: null },
      evidenceQuality: 'strong',
      assumptionId: null,
      version: 1,
      usedByCount: used('input.tam_site_count'),
      disputed: false,
    }),
    row({
      inputKey: i.annualSpendPerUnit.inputKey,
      name: i.annualSpendPerUnit.label,
      value: i.annualSpendPerUnit.value,
      unit: i.annualSpendPerUnit.unit,
      currency: i.annualSpendPerUnit.currency,
      kind: 'assumption',
      basis: { source: null, owner: PEOPLE.maya, text: 'Test: paid pilot offer' },
      evidenceQuality: asm('annual_spend_per_site').evidenceQuality,
      assumptionId: asm('annual_spend_per_site').id,
      version: i.annualSpendPerUnit.ref.version ?? 1,
      usedByCount: used('input.annual_spend_per_site'),
      disputed: disputed('annual_spend_per_site'),
    }),
    ...active.map((c) =>
      row({
        inputKey: `cohort.${c.cohortId}`,
        name: cohortName(c.cohortId),
        value: String(c.siteCount),
        unit: 'sites',
        currency: null,
        kind: 'evidence',
        basis: {
          source:
            c.cohortId === COHORT_SIZE_ID
              ? sourceChip('SRC-014')
              : c.cohortId === COHORT_PROCESS_ID
                ? sourceChip('SRC-021')
                : null,
          owner: null,
          text: c.cohortId === COHORT_PROCESS_IMPORTED_ID ? 'Upload · 13 Oct' : null,
        },
        evidenceQuality: c.cohortId === COHORT_SIZE_ID ? 'strong' : 'some',
        assumptionId: null,
        version: 1,
        usedByCount: used(`sizing.cohort.${c.cohortId}`),
        disputed: false,
      }),
    ),
    ...(overlap
      ? [
          row({
            inputKey: 'overlap',
            name: 'Overlap removed',
            value: String(-overlap.overlapCount),
            unit: 'sites',
            currency: null,
            kind: 'calculated',
            basis: { source: null, owner: null, text: sizingMeta.overlapMethod },
            evidenceQuality: null,
            assumptionId: null,
            version: overlap.ref.version ?? 1,
            usedByCount: used('sizing.sam.overlap_removed'),
            disputed: false,
          }),
        ]
      : []),
    row({
      inputKey: i.reachablePool.inputKey,
      name: i.reachablePool.label,
      value: i.reachablePool.value,
      unit: i.reachablePool.unit,
      currency: null,
      kind: 'assumption',
      basis: { source: null, owner: PEOPLE.jonas, text: 'Partner coverage list' },
      evidenceQuality: asm('reachable_pool').evidenceQuality,
      assumptionId: asm('reachable_pool').id,
      version: i.reachablePool.ref.version ?? 1,
      usedByCount: used('input.reachable_pool'),
      disputed: disputed('reachable_pool'),
    }),
    row({
      inputKey: i.adoption.base.inputKey,
      name: i.adoption.base.label,
      value: i.adoption.base.value,
      unit: 'rate',
      currency: null,
      kind: 'assumption',
      basis: { source: null, owner: PEOPLE.maya, text: asm('adoption_rate.base').basis },
      evidenceQuality: asm('adoption_rate.base').evidenceQuality,
      assumptionId: asm('adoption_rate.base').id,
      version: i.adoption.base.ref.version ?? 1,
      usedByCount: used('input.adoption_rate.base'),
      disputed: disputed('adoption_rate.base'),
    }),
    row({
      inputKey: i.capacity.inputKey,
      name: i.capacity.label,
      value: i.capacity.value,
      unit: i.capacity.unit,
      currency: null,
      kind: 'assumption',
      basis: { source: null, owner: PEOPLE.opsLead, text: 'Operations capacity model' },
      evidenceQuality: asm('capacity').evidenceQuality,
      assumptionId: asm('capacity').id,
      version: i.capacity.ref.version ?? 1,
      usedByCount: used('input.capacity'),
      disputed: disputed('capacity'),
    }),
  ];
}

function cohortsFor(input: SizingInput): Cohort[] {
  return input.cohorts.map((c) => ({
    id: c.cohortId,
    name: c.name,
    qualifier:
      c.cohortId === COHORT_PROCESS_ID
        ? '(v1)'
        : c.cohortId === COHORT_PROCESS_IMPORTED_ID
          ? '(imported)'
          : null,
    rule: c.rule,
    siteCount: c.siteCount,
    source:
      c.cohortId === COHORT_SIZE_ID
        ? sourceChip('SRC-014')
        : c.cohortId === COHORT_PROCESS_ID
          ? sourceChip('SRC-021')
          : null,
    status: c.status,
  }));
}

export async function sizingVersion(src: Source): Promise<SizingVersion> {
  const result = await sizingResult(src.input);
  const b = src.input.boundary;
  return {
    id: src.id,
    caseId: CASE_ID,
    version: src.version,
    state: src.state,
    method: src.input.method,
    horizonYears: src.input.horizonYears,
    boundary: {
      id: BOUNDARY_ID,
      marketUnit: b.marketUnit,
      populationUnit: b.populationUnit,
      countryCode: b.countryCode,
      segmentLabel: b.segmentLabel,
      productBoundary: 'Existing water-monitoring system, run as a monitored service',
      currency: b.currency,
      priceYear: b.priceYear,
      includes: { hardware: false, software: true, services: true, replacementCycles: false },
      annualizationMethod: b.annualizationMethod,
    },
    dedupRuleText: sizingMeta.dedupRuleText,
    ledger: await ledgerFor(src, result),
    cohorts: cohortsFor(src.input),
    overlaps: src.input.overlaps.map((o, n) => ({
      id: wsId(12, n + 1),
      cohortAId: o.cohortAId,
      cohortBId: o.cohortBId,
      overlapCount: o.overlapCount,
      method: sizingMeta.overlapMethod,
    })),
    crossCheck: null, // the PRD gives no top-down figure (fixture: crossCheck null)
    result,
    rowVersion: src.rowVersion,
    committedAt: src.committedAt,
    committedBy: src.committedBy,
    createdAt: src.createdAt,
  };
}

export async function sizingView(viewerId: string | null): Promise<SizingView> {
  syncSizingVariant();
  const cur = committedSource();
  const dr = draftSource();
  const pending = assessment.sizing.duplicate === 'pending';
  const restricted = siteListRestrictedFor(viewerId);
  return {
    current: cur ? await sizingVersion(cur) : null,
    draft: dr ? await sizingVersion(dr) : null,
    duplicateCohorts: pending
      ? [
          {
            cohortAId: COHORT_PROCESS_ID,
            cohortBId: COHORT_PROCESS_IMPORTED_ID,
            sharedSiteCount: sizingMeta.variants.duplicateCohort.sharedSiteIds,
            message:
              'Process-qualified (v1) and Process-qualified (imported) list the same sites under the same rule. Keep one before calculating.',
          },
        ]
      : [],
    siteListRestricted: restricted,
    siteListDataOwner: restricted ? PEOPLE.maya : null,
    versions: assessment.sizing.committed.map((c) => ({
      id: c.id,
      version: c.version,
      committedAt: c.committedAt,
    })),
  };
}

function emptyView(): SizingView {
  return {
    current: null,
    draft: null,
    duplicateCohorts: [],
    siteListRestricted: false,
    siteListDataOwner: null,
    versions: [],
  };
}

// ---------------------------------------------------------------------------
// Draft edits
// ---------------------------------------------------------------------------

function setInput(input: SizingInput, inputKey: string, value: string): string | null {
  const slot = (cur: { value: string }) => {
    const before = cur.value;
    cur.value = value;
    return before;
  };
  switch (inputKey) {
    case 'tam_site_count':
      return slot((input.tamPopulation = { ...input.tamPopulation }));
    case 'annual_spend_per_site':
      return slot((input.annualSpendPerUnit = { ...input.annualSpendPerUnit }));
    case 'reachable_pool':
      return slot((input.reachablePool = { ...input.reachablePool }));
    case 'capacity':
      return slot((input.capacity = { ...input.capacity }));
    case 'adoption_rate.base':
      return slot((input.adoption.base = { ...input.adoption.base }));
    case 'adoption_rate.downside':
      return input.adoption.downside
        ? slot((input.adoption.downside = { ...input.adoption.downside }))
        : null;
    case 'adoption_rate.upside':
      return input.adoption.upside ? slot((input.adoption.upside = { ...input.adoption.upside })) : null;
    default:
      return null;
  }
}

/** The draft, created from the latest committed version when absent ("Edit creates a draft"). */
function ensureDraft() {
  if (assessment.sizing.draft) return assessment.sizing.draft;
  const last = assessment.sizing.committed.at(-1)!;
  assessment.sizing.draft = {
    id: wsId(11, last.version + 1),
    version: last.version + 1,
    rowVersion: 1,
    createdAt: nowIso(),
    input: structuredClone(last.input),
    edits: [],
  };
  return assessment.sizing.draft;
}

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

async function lineageResponse(
  caseKey: string,
  nodeKey: string,
  model: 'sizing' | 'economics',
  version: number | 'draft' | undefined,
) {
  syncSizingVariant();
  const sizingSrc =
    model === 'sizing'
      ? version === 'draft'
        ? draftSource()
        : typeof version === 'number'
          ? committedSource(version)
          : (committedSource() ?? draftSource())
      : (committedSource() ?? draftSource());
  if (!sizingSrc) return null;
  const sizing = await sizingResult(sizingSrc.input);
  const econInput =
    model === 'economics' && version === 'draft'
      ? economicsDraftInput()
      : economicsCurrent(typeof version === 'number' && model === 'economics' ? version : undefined)?.input;
  if (!econInput) return null;
  const econ = await economicsResult(econInput);
  const nodes = mergeLineage(
    model === 'economics' ? econ.lineage : sizing.lineage,
    model === 'economics' ? sizing.lineage : econ.lineage,
  );
  const byKey = new Map(nodes.map((n) => [n.nodeKey, n]));
  const found = byKey.get(nodeKey);
  if (!found) return null;
  const blocked = model === 'sizing' ? sizing.blocked : econ.blocked;
  // A blocked draft never shows calculated values (they would be meaningless).
  const mask = (n: LineageNode): LineageNode =>
    blocked && n.kind !== 'evidence' && n.kind !== 'assumption'
      ? { ...n, value: null, formulaWithValues: null }
      : n;
  const node = mask(found);
  const currency = sizingSrc.input.boundary.currency;
  const inputKey = nodeKey.startsWith('input.') ? nodeKey.slice('input.'.length) : null;
  const edits = inputKey ? sizingSrc.edits.filter((e) => e.inputKey === inputKey) : [];
  const versionText =
    sizingSrc.state === 'committed'
      ? `Committed in sizing v${sizingSrc.version} by ${personOf(sizingSrc.committedBy ?? people.maya.id).displayName}`
      : `In sizing draft v${sizingSrc.version}`;
  const history = [
    ...edits
      .slice()
      .reverse()
      .map((e) => ({
        at: fmtWhen(e.at),
        text: `Draft edit · ${formatLineageValue({ value: e.from, unit: found.unit }, currency)} → ${formatLineageValue({ value: e.to, unit: found.unit }, currency)} · ${personOf(e.byId).displayName}`,
      })),
    { at: fmtWhen(sizingSrc.committedAt ?? sizingSrc.createdAt), text: versionText },
  ];
  return {
    node,
    inputs: found.inputs
      .map((k) => byKey.get(k))
      .filter((n): n is LineageNode => !!n)
      .map(mask),
    usedBy: usedByMeasures(nodes, nodeKey).map((m) => ({ label: m, href: measureHref(caseKey, m) })),
    history,
    exactValue:
      node.value === null
        ? blocked
          ? 'Not available — resolve the blocking checks first'
          : null
        : formatLineageValue(node, currency),
    engineLabel: `Calculated by ${model} engine v${model === 'sizing' ? sizing.engineVersion : econ.engineVersion} · reproducible`,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function isMe104(caseRef: string): boolean {
  const c = findCase(caseRef);
  if (!c) throw notFound();
  return c.key === CASE_KEY;
}

export const handlers: HttpHandler[] = [
  mock(API.sizing.get, async ({ params, viewerId }) =>
    isMe104(params.caseRef) ? sizingView(viewerId) : emptyView(),
  ),

  mock(API.sizing.saveDraft, async ({ params, body, ifMatch, viewerId }) => {
    if (!isMe104(params.caseRef)) throw notFound();
    syncSizingVariant();
    const existed = assessment.sizing.draft !== null;
    const d = ensureDraft();
    if (existed && ifMatch !== d.rowVersion) {
      throw new MockProblem('VERSION_CONFLICT', 'The sizing draft changed elsewhere.');
    }
    for (const i of body.inputs ?? []) {
      const before = setInput(d.input, i.inputKey, i.value);
      if (before === null) {
        throw new MockProblem('VALIDATION_FAILED', `Input ${i.inputKey} cannot be edited here.`);
      }
      if (before === i.value) continue;
      const first = d.edits.find((e) => e.inputKey === i.inputKey);
      if (first && first.from === i.value) {
        d.edits = d.edits.filter((e) => e.inputKey !== i.inputKey); // undo: back to the original
      } else {
        d.edits.push({ inputKey: i.inputKey, from: before, to: i.value, at: nowIso(), byId: viewerId! });
      }
    }
    for (const o of body.overlaps ?? []) {
      d.input.overlaps = d.input.overlaps.map((x) =>
        x.cohortAId === o.cohortAId && x.cohortBId === o.cohortBId
          ? { ...x, overlapCount: o.overlapCount }
          : x,
      );
    }
    d.rowVersion += 1;
    return sizingView(viewerId);
  }),

  mock(API.sizing.calculateDraft, async ({ params }) => {
    if (!isMe104(params.caseRef)) throw notFound();
    syncSizingVariant();
    const d = assessment.sizing.draft;
    if (!d) throw new MockProblem('INVALID_TRANSITION', 'There is no sizing draft to calculate.');
    return sizingResult(d.input);
  }),

  mock(API.sizing.resolveDuplicateCohort, async ({ params, body, viewerId }) => {
    if (!isMe104(params.caseRef)) throw notFound();
    syncSizingVariant();
    if (
      assessment.sizing.duplicate !== 'pending' ||
      !resolveDuplicate(body.keepCohortId, body.excludeCohortId)
    ) {
      throw new MockProblem('INVALID_TRANSITION', 'These cohorts are not a pending duplicate pair.');
    }
    return sizingView(viewerId);
  }),

  mock(API.sizing.commit, async ({ params, viewerId }) => {
    if (!isMe104(params.caseRef)) throw notFound();
    syncSizingVariant();
    const d = assessment.sizing.draft;
    if (!d) throw new MockProblem('INVALID_TRANSITION', 'There is no sizing draft to commit.');
    const result = await sizingResult(d.input);
    if (result.blocked) {
      throw new MockProblem('CALCULATION_BLOCKED', 'Snapshot blocked by calculation checks.', {
        checks: result.checks.map((c) => ({ key: c.key, message: c.message, blocking: c.blocking })),
      });
    }
    assessment.sizing.committed.push({
      id: d.id,
      version: d.version,
      input: d.input,
      committedAt: nowIso(),
      committedBy: viewerId!,
      edits: d.edits,
    });
    assessment.sizing.draft = null;
    return sizingVersion(committedSource(d.version)!);
  }),

  mock(API.sizing.getVersion, async ({ params }) => {
    if (!isMe104(params.caseRef)) throw notFound();
    const src = committedSource(params.version);
    if (!src) throw notFound();
    return sizingVersion(src);
  }),

  mock(API.sizing.compareVersions, async ({ params, query }) => {
    if (!isMe104(params.caseRef)) throw notFound();
    const from = committedSource(query.from);
    const to = query.to === 'draft' ? draftSource() : committedSource(query.to);
    if (!from || !to) throw notFound();
    const [a, b] = await Promise.all([sizingVersion(from), sizingVersion(to)]);
    const cur = b.boundary.currency;
    const keys = [...new Set([...a.ledger, ...b.ledger].map((r) => r.inputKey))];
    return {
      changes: keys.flatMap((k) => {
        const x = a.ledger.find((r) => r.inputKey === k);
        const y = b.ledger.find((r) => r.inputKey === k);
        if (x?.value === y?.value) return [];
        return [
          {
            inputKey: k,
            label: (y ?? x)!.name,
            from: x ? formatLineageValue(x, cur) : null,
            to: y ? formatLineageValue(y, cur) : null,
          },
        ];
      }),
    };
  }),

  mock(API.sizing.population, async ({ params, viewerId }) => {
    if (!isMe104(params.caseRef)) throw notFound();
    const view = await sizingView(viewerId);
    const v = view.draft ?? view.current;
    if (!v?.cohorts.some((c) => c.id === params.cohortId)) throw notFound();
    // The fixture carries no site-level rows; everyone sees aggregates, restricted viewers say why.
    return {
      restricted: view.siteListRestricted,
      aggregateOnly: true,
      dataOwnerName: view.siteListDataOwner?.displayName ?? null,
      rows: [],
      nextCursor: null,
    };
  }),

  mock(API.lineage.get, async ({ params, query }) => {
    const c = findCase(params.caseRef);
    if (!c) throw notFound();
    const res =
      c.key === CASE_KEY ? await lineageResponse(c.key, query.node, query.model, query.version) : null;
    if (res) return res;
    const fallback = ws7Lineage(c.key, query.node);
    if (!fallback) throw notFound();
    return fallback;
  }),
];
