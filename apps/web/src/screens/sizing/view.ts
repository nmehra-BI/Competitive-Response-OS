/**
 * Pure view helpers for S06 Sizing. Display strings come only from @growth-os/ui format; the
 * engine's own exact strings (formula with values, check messages) are shown as given.
 */
import {
  SCENARIO_LABELS,
  type CalcCheck,
  type LineageNode,
  type Scenario,
  type SizingOutput,
  type SizingVersion,
} from '@growth-os/contracts';
import {
  formatCount,
  formatMarketSpend,
  formatMillions,
  formatRate,
  formatScenarioRevenue,
} from '@growth-os/ui';

export const SCENARIOS: Scenario[] = ['downside', 'base', 'upside'];

export function isScenario(v: string | null): v is Scenario {
  return v === 'downside' || v === 'base' || v === 'upside';
}

/** Deep-link `input` → lineage node key. Accepts node keys and research aliases ("adoption-rate"). */
export function nodeFromParam(p: string): string {
  if (/^(input|sizing|economics)\./.test(p)) return p;
  if (p === 'adoption-rate' || p === 'adoption_rate') return 'input.adoption_rate.base';
  return `input.${p.replace(/-/g, '_')}`;
}

/** Ledger row → lineage node key. */
export function nodeForLedger(inputKey: string): string {
  if (inputKey.startsWith('cohort.')) return `sizing.${inputKey}`;
  if (inputKey === 'overlap') return 'sizing.sam.overlap_removed';
  return `input.${inputKey}`;
}

export function blockingChecks(result: SizingOutput | null): CalcCheck[] {
  return result?.checks.filter((c) => c.blocking) ?? [];
}

/** Banner title for a blocking check (research §9 S06 copy). */
export function blockingTitle(c: CalcCheck): string {
  switch (c.key) {
    case 'SAM_EXCEEDS_TAM':
      return 'Blocking: SAM is larger than TAM';
    case 'REACHABLE_EXCEEDS_SAM':
      return 'Blocking: reachable pool is larger than SAM';
    case 'OVERLAP_NEGATIVE':
      return 'Blocking: overlap below 0';
    case 'OVERLAP_EXCEEDS_SMALLER_COHORT':
      return 'Blocking: overlap above the smaller cohort';
    case 'UNIT_MISMATCH':
      return 'Blocking: mixed units';
    case 'PRICE_YEAR_MISMATCH':
      return 'Blocking: mixed price years';
    case 'CURRENCY_MISMATCH':
      return 'Blocking: mixed currencies';
    case 'DUPLICATE_COHORT':
      return 'Duplicate cohort — calculation paused';
    case 'MISSING_INPUT':
      return 'Blocking: input missing';
    default:
      return 'Blocking: calculation check failed';
  }
}

/** Short reason under a disabled "Create snapshot" button. */
export function snapshotBlockedReason(checks: CalcCheck[]): string {
  const keys = new Set(checks.map((c) => c.key));
  if (keys.has('SAM_EXCEEDS_TAM')) return 'Blocked: SAM above TAM.';
  if (keys.has('DUPLICATE_COHORT')) return 'Blocked: resolve the duplicate cohort.';
  return `Blocked: ${checks[0]?.message ?? 'a calculation check failed.'}`;
}

export function lineageNode(result: SizingOutput | null, key: string): LineageNode | undefined {
  return result?.lineage.find((n) => n.nodeKey === key);
}

/** "(1,400 + 1,100 − 500) × €20,000" from the engine's exact formula with values. */
export function formulaExpression(node: LineageNode | undefined): string | null {
  const f = node?.formulaWithValues;
  if (!f) return null;
  const i = f.lastIndexOf(' = ');
  return i > 0 ? f.slice(0, i) : f;
}

export interface LadderRowModel {
  key: 'tam' | 'sam' | 'reach' | 'som';
  name: string;
  meaning: string;
  sites: string;
  /** Share of TAM sites, for the decorative bar only. */
  share: number;
  money: string | null;
  nodeKey: string;
}

export interface LadderModel {
  rows: LadderRowModel[];
  connectors: [string, string, string];
  capNote: string;
  footnote: string;
}

/** The measure ladder: four different questions, never added together (no total row). */
export function ladderModel(v: SizingVersion, scenario: Scenario): LadderModel | null {
  const r = v.result;
  if (!r || r.blocked) return null;
  const cur = v.boundary.currency;
  const tamSites = r.ladder.tam.population;
  const share = (n: number) => (tamSites > 0 ? Math.min(1, n / tamSites) : 0);
  const som =
    r.ladder.som.find((s) => s.scenario === scenario) ?? r.ladder.som.find((s) => s.scenario === 'base');
  const unit = v.boundary.populationUnit === 'site' ? 'unique sites' : `unique ${v.boundary.populationUnit}s`;
  const adoption = v.ledger.find((l) => l.inputKey === `adoption_rate.${som?.scenario ?? 'base'}`);
  const capRow = v.ledger.find((l) => l.inputKey === 'capacity');
  const cap = capRow ? formatCount(Number(capRow.value)) : '—';
  const scLabel = som ? SCENARIO_LABELS[som.scenario] : 'Base';
  const year = v.horizonYears;
  const rows: LadderRowModel[] = [
    {
      key: 'tam',
      name: 'TAM',
      meaning: 'Annual spend in the defined market. No claim of capture.',
      sites: `${formatCount(tamSites)} ${unit}`,
      share: 1,
      money: formatMarketSpend(r.ladder.tam.value.amount, cur),
      nodeKey: 'sizing.tam.value',
    },
    {
      key: 'sam',
      name: 'SAM',
      meaning: 'Sites we could serve after eligibility and product-fit filters.',
      sites: `${formatCount(r.ladder.sam.population)} ${unit}`,
      share: share(r.ladder.sam.population),
      money: formatMarketSpend(r.ladder.sam.value.amount, cur),
      nodeKey: 'sizing.sam.value',
    },
    {
      key: 'reach',
      name: 'Reachable pool',
      meaning: 'Sites inside current channel and service coverage. Not SOM.',
      sites: `${formatCount(r.ladder.reachablePool.population)} ${unit}`,
      share: share(r.ladder.reachablePool.population),
      money: null,
      nodeKey: 'sizing.reachable_pool',
    },
  ];
  if (som) {
    rows.push({
      key: 'som',
      name: `SOM · ${scLabel} · Year ${year}`,
      meaning: 'Scenario for a stated horizon. Not a forecast.',
      sites: `${formatCount(som.customers)} customers`,
      share: share(som.customers),
      money: `${formatScenarioRevenue(som.annualRevenue.amount, som.annualRevenue.currency)} annual revenue`,
      nodeKey: `sizing.som.${som.scenario}.annual_revenue`,
    });
  }
  const adoptText = adoption ? `${formatRate(adoption.value)} adoption` : 'adoption';
  const capNote = !som
    ? ''
    : som.capped
      ? `${scLabel}: capped at ${cap} — raising capacity is a G3 decision (unconstrained would be ${formatCount(som.uncappedCustomers)})`
      : `${scLabel}: ${formatCount(som.customers)} customers, below capacity ${cap}`;
  const somMoney = som ? formatScenarioRevenue(som.annualRevenue.amount, cur) : '';
  return {
    rows,
    connectors: [
      '× eligibility and product-fit filters',
      '× current channel and service coverage',
      `× ${adoptText} (Assumption) · capped at capacity ${cap}`,
    ],
    capNote,
    footnote: `No total row. ${somMoney} SOM is annual revenue under a scenario; ${formatMillions(
      r.ladder.tam.value.amount,
      cur,
      0,
    )} TAM is annual market spend. They are not progress toward each other.`,
  };
}
