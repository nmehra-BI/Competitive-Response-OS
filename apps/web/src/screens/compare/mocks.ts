/**
 * S04 comparison mocks. Cells are the named reviewers' ratings from fixtures/aster (null =
 * Unknown, never 0) and the prototype's cell text. The ranking follows the WS2 engine rules
 * (packages/domain/src/me/comparison/ranking.ts):
 *
 *   Score = Product fit × w₁ + Channel access × w₂ + Evidence coverage × w₃   (weights total 100)
 *   any Unknown input → "Not ranked — n input(s) missing"; an incomparable boundary that is not
 *   excluded blocks the whole ranking; excluded candidates stay in the table; score has 2 decimals;
 *   rows are returned in rank order (ties keep input order), unranked rows last.
 */
import {
  API,
  type Comparison,
  type ComparisonAttribute,
  type ComparisonCell,
  type EvidenceQuality,
  type RankingRow,
  type RankingWeights,
} from '@growth-os/contracts';
import { comparison as FX, sources } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { mock, MockProblem } from '../../mocks/define';
import { mockUuid, persisted } from '../mandate/mock-kit';
import { idOfKey, opportunityStore, opportunityView, resolveOpportunityKey } from '../opportunities/mocks';

type Weights = Omit<RankingWeights, 'version'>;
interface CmpRec {
  id: string;
  mandateId: string;
  keys: string[];
  weightsHistory: RankingWeights[];
  excluded: string[];
  selected: string | null;
}
interface Store {
  comparisons: CmpRec[];
}

export const comparisonStore = persisted<Store>('comparisons', () => ({ comparisons: [] }));

const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');
const RATED = ['product_fit', 'channel_access', 'evidence_coverage'] as const;
const RATED_LABEL: Record<(typeof RATED)[number], string> = {
  product_fit: 'product fit',
  channel_access: 'channel access',
  evidence_coverage: 'evidence coverage',
};
const LEVEL = { 3: 'High', 2: 'Medium', 1: 'Low' } as const;

/** Prototype cell text per candidate (S04). Ratings come from the fixture. */
type CellText = Partial<Record<ComparisonAttribute, { value?: string; detail?: string; unknown?: boolean }>>;
const TEXT: Record<string, CellText> = {
  'OPP-07': {
    market_boundary: { value: 'Annual spend · unique sites · Germany · EUR · 2026' },
    tam: { value: '€100m/year', detail: '5,000 sites × €20k' },
    sam: { value: '€40m/year', detail: '2,000 unique sites' },
    growth_evidence: { value: 'Some', detail: '2 trade sources · 2026' },
    product_fit: { detail: 'Demo pending · Priya Shah' },
    channel_access: { detail: 'Partner covers 500 sites · Assumption' },
    evidence_coverage: { detail: '3 sources' },
    investment_need: { value: 'Validation €15k, then pilot up to €120k · 90 days' },
    readiness_blockers: { value: 'Specialist review pending' },
    unknowns: { value: 'Adoption rate · specialist requirements' },
  },
  'OPP-14': {
    market_boundary: { value: 'Annual spend · unique sites · Netherlands · EUR · 2026' },
    tam: { unknown: true, detail: 'Not sized' },
    sam: { unknown: true },
    growth_evidence: { value: 'Weak', detail: '1 source · 2025' },
    product_fit: { detail: 'Same workflow as Germany' },
    channel_access: { detail: 'Partner coverage unclear' },
    evidence_coverage: { detail: '2 sources' },
    investment_need: { unknown: true },
    readiness_blockers: { value: 'Partner coverage unclear' },
    unknowns: { value: 'Site count · price · channel' },
  },
  'OPP-09': {
    market_boundary: { value: 'Annual spend · companies, not sites · Austria · EUR · 2024 prices' },
    tam: { detail: 'Not comparable until normalized' },
    sam: { detail: 'Not comparable' },
    growth_evidence: { value: 'Weak', detail: '1 news item' },
    product_fit: { detail: 'Brewing adaptations likely' },
    channel_access: { detail: 'No partner today' },
    evidence_coverage: { detail: '1 source' },
    investment_need: { unknown: true },
    readiness_blockers: { value: 'No channel' },
    unknowns: { value: 'Site count · price · adoption · channel' },
  },
  'OPP-16': {
    market_boundary: { value: 'Annual spend · unique sites · Switzerland · EUR · 2026' },
    tam: { unknown: true, detail: 'Not sized' },
    sam: { unknown: true },
    growth_evidence: { value: 'Weak', detail: '1 source · 2026' },
    product_fit: { detail: 'Same workflow; language variants' },
    channel_access: { detail: 'Partner covers part of the market' },
    evidence_coverage: { detail: '1 source' },
    investment_need: { unknown: true },
    readiness_blockers: { value: 'Specialist requirements unknown' },
    unknowns: { value: 'Site count · price · adoption' },
  },
};
const INCOMPARABLE: Record<string, string> = {
  'OPP-09':
    'Austrian breweries uses company counts and 2024 prices. Other candidates use unique sites and 2026 prices. Normalize it, or exclude it until normalized.',
};
const ATTRS: ComparisonAttribute[] = [
  'market_boundary',
  'tam',
  'sam',
  'growth_evidence',
  'product_fit',
  'channel_access',
  'evidence_coverage',
  'investment_need',
  'readiness_blockers',
  'unknowns',
];

function ratingOf(key: string, attr: (typeof RATED)[number]): 1 | 2 | 3 | null {
  const r = (FX.ratings as Record<string, Record<string, 1 | 2 | 3 | null>>)[key];
  const k =
    attr === 'product_fit' ? 'productFit' : attr === 'channel_access' ? 'channelAccess' : 'evidenceCoverage';
  return r ? (r[k] ?? null) : null;
}

function cellsFor(key: string, oppId: string): ComparisonCell[] {
  const t = TEXT[key] ?? {};
  const incomparable = key in INCOMPARABLE;
  return ATTRS.map((attribute) => {
    const x = t[attribute] ?? {};
    const rated = (RATED as readonly string[]).includes(attribute);
    const rating = rated ? ratingOf(key, attribute as (typeof RATED)[number]) : null;
    const boundaryBound = ['market_boundary', 'tam', 'sam'].includes(attribute);
    const unknown = rated ? rating === null : (x.unknown ?? (!x.value && !(incomparable && boundaryBound)));
    return {
      opportunityId: oppId,
      attribute,
      rating,
      ratingLabel: rating ? LEVEL[rating] : null,
      valueText: x.value ?? null,
      detailText: x.detail ?? null,
      unknown,
      incomparable: incomparable && boundaryBound,
      evidenceQuality:
        attribute === 'growth_evidence' && x.value ? (x.value.toLowerCase() as EvidenceQuality) : null,
      sources:
        key === 'OPP-07' && attribute === 'tam'
          ? sources
              .filter((s) => s.key === 'SRC-014')
              .map((s) => ({
                sourceId: s.id,
                key: s.key,
                label: s.chipLabel,
                quality: s.quality,
                restricted: false,
              }))
          : [],
    };
  });
}

/** The WS2 ranking rules, server-side. */
export function rank(c: CmpRec, w: Weights): { valid: boolean; ranking: RankingRow[] } {
  const total = w.productFit + w.channelAccess + w.evidenceCoverage;
  const valid = total === 100;
  const blocked = c.keys.some((k) => k in INCOMPARABLE && !c.excluded.includes(k));
  const rows = c.keys.map((k, i) => {
    const id = idOfKey(k)!;
    const r = RATED.map((a) => ratingOf(k, a));
    const missing = RATED.filter((_, j) => r[j] === null);
    if (blocked)
      return {
        i,
        row: {
          opportunityId: id,
          ranked: false,
          score: null,
          reason: 'Not ranked — boundary conflict in set',
        },
      };
    if (c.excluded.includes(k))
      return {
        i,
        row: { opportunityId: id, ranked: false, score: null, reason: 'Excluded until normalized' },
      };
    if (missing.length)
      return {
        i,
        row: {
          opportunityId: id,
          ranked: false,
          score: null,
          reason: `Not ranked — ${missing.length} input${missing.length === 1 ? '' : 's'} missing (${missing.map((m) => RATED_LABEL[m]).join(', ')})`,
        },
      };
    if (!valid)
      return { i, row: { opportunityId: id, ranked: false, score: null, reason: 'Weights must total 100%' } };
    // Integer arithmetic: ratings × weights are integers; divide by 100 once for 2 decimals.
    const hundredths = r[0]! * w.productFit + r[1]! * w.channelAccess + r[2]! * w.evidenceCoverage;
    const score = `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
    return { i, row: { opportunityId: id, ranked: true, score, reason: null }, h: hundredths };
  });
  const ranked = rows.filter((x) => x.row.ranked).sort((a, b) => (b.h ?? 0) - (a.h ?? 0) || a.i - b.i);
  const rest = rows.filter((x) => !x.row.ranked);
  return {
    valid,
    ranking: [
      ...ranked.map((x, i) => ({ ...x.row, rank: i + 1 })),
      ...rest.map((x) => ({ ...x.row, rank: null })),
    ],
  };
}

const FORMULA =
  'Score = Product fit × w₁ + Channel access × w₂ + Evidence coverage × w₃ · ratings 1–3 · any Unknown input → not ranked';

function view(c: CmpRec): Comparison {
  const weights = c.weightsHistory.at(-1)!;
  const sized = c.keys.filter((k) => TEXT[k]?.tam?.value).length;
  return {
    id: c.id,
    mandateId: c.mandateId,
    opportunityIds: c.keys.map((k) => idOfKey(k)!),
    commonUnitLabel:
      'Common unit: annual spend on water monitoring · unique sites · EUR · 2026 prices · horizon 3 years',
    cells: c.keys.flatMap((k) => cellsFor(k, idOfKey(k)!)),
    excludedOpportunityIds: c.excluded.map((k) => idOfKey(k)!),
    incomparableWarnings: c.keys
      .filter((k) => k in INCOMPARABLE)
      .map((k) => ({ opportunityId: idOfKey(k)!, message: INCOMPARABLE[k]! })),
    weights,
    weightsHistory: c.weightsHistory,
    ranking: rank(c, weights).ranking,
    formulaText: `${FORMULA} · size not used (only ${sized} of ${c.keys.length} candidates ${sized === 1 ? 'is' : 'are'} sized)`,
    selectedOpportunityId: c.selected ? idOfKey(c.selected) : null,
  };
}

function find(id: string): CmpRec {
  const c = comparisonStore.get().comparisons.find((x) => x.id === id);
  if (!c) throw notFound();
  return c;
}

export const handlers: HttpHandler[] = [
  mock(API.comparisons.create, ({ body }) => {
    const keys = body.opportunityRefs.map((r) => {
      const k = resolveOpportunityKey(r);
      if (!k) throw notFound();
      return k;
    });
    if (new Set(keys).size !== keys.length)
      throw new MockProblem('VALIDATION_FAILED', 'Each candidate can be compared once.');
    const sig = [...keys].sort().join(',');
    const existing = comparisonStore
      .get()
      .comparisons.find((c) => [...c.keys].sort().join(',') === sig && c.mandateId === body.mandateId);
    if (existing) return view(existing);
    const fixtureSet = [...FX.opportunityKeys].sort().join(',') === sig;
    const n = comparisonStore.get().comparisons.length;
    const rec: CmpRec = {
      id: fixtureSet ? FX.id : mockUuid(20, n + 1),
      mandateId: body.mandateId,
      keys,
      weightsHistory: [{ ...FX.weights }],
      excluded: [],
      selected: null,
    };
    comparisonStore.update((s) => s.comparisons.push(rec));
    return view(rec);
  }),
  mock(API.comparisons.get, ({ params }) => view(find(params.id))),
  mock(API.comparisons.previewRanking, ({ params, body }) => {
    const c = find(params.id);
    const r = rank(c, body);
    return { ...r, totalWeight: body.productFit + body.channelAccess + body.evidenceCoverage };
  }),
  mock(API.comparisons.applyWeights, ({ params, body }) => {
    const c = find(params.id);
    if (body.productFit + body.channelAccess + body.evidenceCoverage !== 100)
      throw new MockProblem('VALIDATION_FAILED', 'Weights must total 100%.');
    comparisonStore.update(() =>
      c.weightsHistory.push({ version: c.weightsHistory.at(-1)!.version + 1, ...body }),
    );
    return view(c);
  }),
  mock(API.comparisons.setExclusion, ({ params, body }) => {
    const c = find(params.id);
    const key = resolveOpportunityKey(params.opportunityId);
    if (!key || !c.keys.includes(key)) throw notFound();
    comparisonStore.update(() => {
      c.excluded = c.excluded.filter((k) => k !== key);
      if (body.excluded) c.excluded.push(key);
    });
    return view(c);
  }),
  mock(API.comparisons.select, ({ params, body }) => {
    const c = find(params.id);
    const key = resolveOpportunityKey(body.opportunityId);
    if (!key || !c.keys.includes(key)) throw notFound();
    if (key in INCOMPARABLE)
      throw new MockProblem('INVALID_TRANSITION', 'Normalize the market boundary before selecting it.');
    const o = opportunityView(key)!;
    if (o.status === 'dismissed' || o.status === 'duplicate')
      throw new MockProblem('INVALID_TRANSITION', `A ${o.status} candidate cannot be selected.`);
    comparisonStore.update(() => {
      c.selected = key;
    });
    if (o.status === 'detected') opportunityStore.update((s) => (s.status[key] = 'shortlisted'));
    return view(c);
  }),
];
