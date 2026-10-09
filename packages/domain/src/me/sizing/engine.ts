/**
 * Deterministic sizing engine (PRD ME-05, §6; ARCHITECTURE.md §10).
 *
 * Rules the implementation MUST follow (each has a golden or property test in WS2):
 *  - decimal.js only; no JS floats for money or rates. Inputs and outputs are decimal strings.
 *  - Checks before arithmetic: currency and price year equal across money inputs; population units
 *    equal across TAM, cohorts and reachable pool; rates in [0,1]; capacity ≥ 0.
 *  - aggregate_overlap: exactly 2 active cohorts. SAM population = a + b − overlap.
 *    Blocks when overlap < 0 or overlap > min(a, b). More than 2 cohorts → use site_list_union.
 *  - site_list_union: SAM population = |union of site IDs| across active cohorts (dedup by site ID;
 *    parent company does not merge sites). Overlap removed = Σ cohorts − union.
 *  - Blocks when SAM > TAM, reachable > SAM, or two active cohorts share rule and source (duplicate).
 *  - TAM value = TAM population × annual spend per unit; SAM value likewise. Measure annual_market_spend, per_year.
 *  - SOM customers per scenario = min(floor(reachable × adoption), capacity); capped flag when the
 *    cap binds. SOM revenue = customers × annual spend per unit (measure annual_revenue, per_year,
 *    "at end of horizon"). Scenarios are independent; never averaged.
 *  - One-time spend in the boundary requires an explicit annualization method, else blocking check.
 *  - Top-down cross-check is a test (within/outside range), never blended or averaged.
 *  - Lineage nodes for every output with formula text and one-level inputs.
 *  - inputHash = sha256(canonicalize(input)); same input → identical output.
 *
 * Measures are never added together: TAM, SAM, reachable pool and SOM answer different questions
 * (CLAUDE.md rule 4). The ladder is returned measure by measure with no total.
 */
import { SCENARIO_LABELS, SCENARIO_ORDER, SizingInput } from '@growth-os/contracts';
import type {
  CrossCheckResult,
  EngineInput,
  SizingCohortInput,
  SizingOutput,
  SomScenarioOutput,
} from '@growth-os/contracts';
import { hashCanonical } from '../../platform/snapshot/canonical';
import {
  CheckList,
  checkCapacity,
  checkMoneyInput,
  checkPriceYear,
  checkRate,
  checkUnit,
  checkWholeCount,
} from './checks';
import { LineageBuilder } from './lineage';
import {
  Dec,
  POPULATION_VALUE_UNIT,
  capCustomers,
  dec,
  fmtMoney,
  fmtNumber,
  fmtRate,
  perYear,
  scalePerYear,
  toAmountString,
  toMoney,
} from './numeric';

export * from './lineage';
export {
  capCustomers,
  addPerYear,
  subtractPerYear,
  scalePerYear,
  perYear,
  oneTime,
  toMoney,
  type PerYearAmount,
  type OneTimeAmount,
} from './numeric';

export const SIZING_ENGINE_VERSION = '1.0.0';

/** Two cohorts sharing at least this share of their combined site IDs are flagged as duplicates. */
export const DUPLICATE_COHORT_JACCARD = '0.9';

export interface SizingEngine {
  readonly version: string;
  /** Pure and deterministic. Never throws for business problems: returns blocking checks instead. */
  calculate(input: SizingInput): Promise<SizingOutput>;
}

const cohortKey = (c: SizingCohortInput) => `cohort.${c.cohortId}`;
const cohortNode = (c: SizingCohortInput) => `sizing.cohort.${c.cohortId}`;

interface SamResult {
  population: number;
  cohortSum: number;
  overlapRemoved: number;
  formulaText: string;
  formulaValues: string;
  overlapFormula: string;
}

export function createSizingEngine(): SizingEngine {
  return {
    version: SIZING_ENGINE_VERSION,
    calculate: async (raw) => {
      const input = SizingInput.parse(raw);
      const { hash } = await hashCanonical(input);
      return calculateSizing(input, hash);
    },
  };
}

function calculateSizing(input: SizingInput, inputHash: string): SizingOutput {
  const { boundary } = input;
  const currency = boundary.currency;
  const priceYear = boundary.priceYear;
  const popUnit = POPULATION_VALUE_UNIT[boundary.populationUnit];
  const hint = `Normalize to ${currency} ${priceYear}.`;
  const checks = new CheckList();

  // ---- Checks before arithmetic -------------------------------------------------------------
  checkMoneyInput(checks, input.annualSpendPerUnit, currency, priceYear, hint);
  checkUnit(checks, input.annualSpendPerUnit, ['currency_per_year_per_site']);
  for (const pop of [input.tamPopulation, input.reachablePool]) {
    checkUnit(checks, pop, [popUnit]);
    checkWholeCount(checks, pop);
    checkPriceYear(checks, pop, priceYear, hint);
  }
  const adoptions = SCENARIO_ORDER.map((s) => [s, input.adoption[s]] as const);
  for (const [, a] of adoptions) {
    if (!a) continue;
    checkUnit(checks, a, ['rate']);
    checkRate(checks, a);
  }
  checkUnit(checks, input.capacity, ['customers', popUnit]);
  checkCapacity(checks, input.capacity);

  if (boundary.includesOneTimeSpend && !boundary.annualizationMethod?.trim()) {
    checks.block(
      'ANNUALIZATION_METHOD_MISSING',
      'The market boundary includes one-time spend. State how it is annualized before calculating.',
      ['boundary.annualizationMethod'],
    );
  }

  const active = input.cohorts.filter((c) => c.status === 'active');
  for (const c of input.cohorts) {
    if (c.status === 'excluded') continue;
    if (c.populationUnit !== boundary.populationUnit) {
      checks.block(
        'UNIT_MISMATCH',
        `${c.name} counts ${c.populationUnit === 'company' ? 'companies' : `${c.populationUnit}s`}; the boundary counts unique ${popUnit}. Convert it or exclude it.`,
        [cohortKey(c)],
      );
    }
    if (c.priceYear !== priceYear) {
      checks.block(
        'PRICE_YEAR_MISMATCH',
        `${c.name} is from ${c.priceYear}; the model uses ${priceYear}. ${hint}`,
        [cohortKey(c)],
      );
    }
  }
  checkDuplicateCohorts(checks, input.cohorts, active);

  if (input.crossCheck) {
    if (input.crossCheck.currency !== currency) {
      checks.block(
        'CURRENCY_MISMATCH',
        `The top-down range is in ${input.crossCheck.currency}; the model uses ${currency}. ${hint}`,
        ['crossCheck'],
      );
    }
    if (input.crossCheck.priceYear !== priceYear) {
      checks.block(
        'PRICE_YEAR_MISMATCH',
        `The top-down range uses ${input.crossCheck.priceYear} prices; the model uses ${priceYear}. ${hint}`,
        ['crossCheck'],
      );
    }
  }

  const sam = computeSam(checks, input, active);

  // ---- Ladder (each measure on its own; never totalled) --------------------------------------
  const spend = perYear('annual_spend_per_unit', dec(input.annualSpendPerUnit.value), currency, priceYear);
  const tamPop = dec(input.tamPopulation.value);
  const tamValue = scalePerYear('annual_market_spend', spend, tamPop);
  const samPop = sam ? new Dec(sam.population) : null;
  const samValue = samPop ? scalePerYear('annual_market_spend', spend, samPop) : null;
  const reach = dec(input.reachablePool.value);

  if (samPop && samPop.gt(tamPop)) {
    checks.block(
      'SAM_EXCEEDS_TAM',
      `SAM (${fmtNumber(samPop)} ${popUnit}) is larger than TAM (${fmtNumber(tamPop)} ${popUnit}). Check the TAM count or the cohorts.`,
      [input.tamPopulation.inputKey, ...active.map(cohortKey)],
    );
  }
  if (samPop && reach.gt(samPop)) {
    checks.block(
      'REACHABLE_EXCEEDS_SAM',
      `The reachable pool (${fmtNumber(reach)} ${popUnit}) is larger than SAM (${fmtNumber(samPop)} ${popUnit}).`,
      [input.reachablePool.inputKey],
    );
  }

  const som: SomScenarioOutput[] = [];
  if (!checks.blocked) {
    const capacity = dec(input.capacity.value);
    for (const [scenario, a] of adoptions) {
      if (!a) continue;
      const c = capCustomers(reach, dec(a.value), capacity);
      som.push({
        scenario,
        uncappedCustomers: c.uncappedCustomers,
        customers: c.customers,
        capped: c.capped,
        annualRevenue: toMoney(scalePerYear('annual_revenue', spend, new Dec(c.customers))),
      });
      if (c.capped) {
        checks.add(
          'CAPACITY_CAP_APPLIED',
          false,
          `${SCENARIO_LABELS[scenario]}: ${fmtNumber(c.customers)} customers — capacity cap reached (unconstrained would be ${fmtNumber(c.uncappedCustomers)}).`,
          [input.capacity.inputKey, a.inputKey],
        );
      }
    }
  }

  // ---- Top-down cross-check: a test, never an average ---------------------------------------
  const crossCheck = runCrossCheck(checks, input, samValue?.amount ?? null);

  // ---- Lineage -------------------------------------------------------------------------------
  const lineage = buildSizingLineage(input, sam, som, crossCheck.result);

  return {
    engine: 'sizing',
    engineVersion: SIZING_ENGINE_VERSION,
    inputHash,
    blocked: checks.blocked,
    checks: checks.list(),
    ladder: {
      tam: { population: tamPop.floor().toNumber(), value: toMoney(tamValue) },
      sam: {
        population: sam?.population ?? 0,
        value: toMoney(samValue ?? perYear('annual_market_spend', new Dec(0), currency, priceYear)),
        cohortSum: sam?.cohortSum ?? 0,
        overlapRemoved: sam?.overlapRemoved ?? 0,
        available: sam !== null, // D-033: placeholders above are never a displayable zero
      },
      reachablePool: { population: reach.floor().toNumber() },
      som,
    },
    crossCheck,
    lineage,
  };
}

function checkDuplicateCohorts(
  checks: CheckList,
  all: readonly SizingCohortInput[],
  active: readonly SizingCohortInput[],
): void {
  for (const c of all) {
    if (c.status === 'duplicate_candidate') {
      checks.block(
        'DUPLICATE_COHORT',
        `${c.name} is marked as a possible duplicate. Merge or keep one before calculating.`,
        [cohortKey(c)],
      );
    }
  }
  const threshold = dec(DUPLICATE_COHORT_JACCARD);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      const sameRuleAndSource =
        a.rule.trim() === b.rule.trim() && a.ref.type === b.ref.type && a.ref.id === b.ref.id;
      let shared: number | null = null;
      let highShare = false;
      if (a.siteIds && b.siteIds) {
        const setA = new Set(a.siteIds);
        const setB = new Set(b.siteIds);
        shared = [...setB].filter((id) => setA.has(id)).length;
        const union = setA.size + setB.size - shared;
        highShare = union > 0 && new Dec(shared).div(union).gte(threshold);
      }
      if (sameRuleAndSource || highShare) {
        const why =
          shared !== null && highShare
            ? `share ${fmtNumber(shared)} site IDs`
            : 'use the same rule and source';
        checks.block(
          'DUPLICATE_COHORT',
          `${a.name} and ${b.name} ${why}. Merge or keep one before calculating.`,
          [cohortKey(a), cohortKey(b)],
        );
      }
    }
  }
}

function computeSam(
  checks: CheckList,
  input: SizingInput,
  active: readonly SizingCohortInput[],
): SamResult | null {
  if (active.length === 0) {
    checks.block('MISSING_INPUT', 'SAM needs at least one active cohort.', ['cohorts']);
    return null;
  }
  const cohortSum = active.reduce((s, c) => s + c.siteCount, 0);

  if (input.method === 'aggregate_overlap') {
    if (active.length !== 2) {
      checks.block(
        'TOO_MANY_COHORTS_FOR_AGGREGATE_METHOD',
        `The overlap method needs exactly 2 active cohorts (found ${active.length}). Use the site-list union for more.`,
        active.map(cohortKey),
      );
      return null;
    }
    const [a, b] = active as [SizingCohortInput, SizingCohortInput];
    const pair = input.overlaps.find(
      (o) =>
        (o.cohortAId === a.cohortId && o.cohortBId === b.cohortId) ||
        (o.cohortAId === b.cohortId && o.cohortBId === a.cohortId),
    );
    if (!pair) {
      checks.block('MISSING_INPUT', `Overlap between ${a.name} and ${b.name} is missing.`, [
        cohortKey(a),
        cohortKey(b),
      ]);
      return null;
    }
    const overlap = pair.overlapCount;
    const keys = ['overlap', cohortKey(a), cohortKey(b)];
    if (overlap < 0) {
      checks.block('OVERLAP_NEGATIVE', `Overlap cannot be negative (${fmtNumber(overlap)}).`, keys);
    } else if (overlap > Math.min(a.siteCount, b.siteCount)) {
      const smaller = a.siteCount <= b.siteCount ? a : b;
      checks.block(
        'OVERLAP_EXCEEDS_SMALLER_COHORT',
        `Overlap (${fmtNumber(overlap)}) is larger than the smaller cohort, ${smaller.name} (${fmtNumber(smaller.siteCount)}).`,
        keys,
      );
    }
    return {
      population: cohortSum - overlap,
      cohortSum,
      overlapRemoved: overlap,
      formulaText: `${a.name} + ${b.name} − Overlap`,
      formulaValues: `${fmtNumber(a.siteCount)} + ${fmtNumber(b.siteCount)} − ${fmtNumber(overlap)}`,
      overlapFormula: `count(site IDs in ${a.name} ∩ ${b.name})`,
    };
  }

  // site_list_union
  const missing = active.filter((c) => !c.siteIds);
  if (missing.length > 0) {
    checks.block(
      'MISSING_INPUT',
      `The site-list union needs site IDs for ${missing.map((c) => c.name).join(', ')}.`,
      missing.map(cohortKey),
    );
    return null;
  }
  const union = new Set<string>();
  for (const c of active) for (const id of c.siteIds!) union.add(id);
  const overlapRemoved = cohortSum - union.size;
  return {
    population: union.size,
    cohortSum,
    overlapRemoved,
    formulaText: `${active.map((c) => c.name).join(' + ')} − Overlap`,
    formulaValues: `${active.map((c) => fmtNumber(c.siteCount)).join(' + ')} − ${fmtNumber(overlapRemoved)}`,
    overlapFormula: 'Σ cohort sites − |union of site IDs|',
  };
}

function runCrossCheck(
  checks: CheckList,
  input: SizingInput,
  samValue: Dec | null,
): { result: CrossCheckResult; message: string } {
  const cc = input.crossCheck;
  if (!cc) return { result: 'not_available', message: 'Not available — no top-down estimate recorded.' };
  const prefix = cc.illustrative ? 'Illustrative · ' : '';
  if (checks.blocked || samValue === null) {
    return {
      result: 'not_available',
      message: `${prefix}Not available — resolve the blocking checks first.`,
    };
  }
  const low = dec(cc.low);
  const high = dec(cc.high);
  if (low.gt(high)) {
    return { result: 'not_available', message: `${prefix}Not available — the top-down range is invalid.` };
  }
  const c = input.boundary.currency;
  const range = `${fmtMoney(low, c)}–${fmtMoney(high, c)}/year`;
  if (samValue.gte(low) && samValue.lte(high)) {
    return {
      result: 'within_range',
      message: `${prefix}Within range: bottom-up SAM ${fmtMoney(samValue, c)}/year is inside the top-down range ${range}.`,
    };
  }
  const gap = samValue.lt(low) ? low.minus(samValue) : samValue.minus(high);
  const message = `${prefix}Outside range by ${fmtMoney(gap, c)}/year: bottom-up SAM ${fmtMoney(samValue, c)}/year vs top-down ${range}. Explain the gap before G1.`;
  checks.add('CROSS_CHECK_OUTSIDE_RANGE', false, message, ['crossCheck']);
  return { result: 'outside_range', message };
}

function buildSizingLineage(
  input: SizingInput,
  sam: SamResult | null,
  som: readonly SomScenarioOutput[],
  crossCheck: CrossCheckResult,
) {
  const { currency, populationUnit } = input.boundary;
  const unit = POPULATION_VALUE_UNIT[populationUnit];
  const lb = new LineageBuilder();
  const spendIn = input.annualSpendPerUnit;
  const spend = dec(spendIn.value);
  const spendTxt = fmtMoney(spend, currency);

  const tamIn = lb.addInput(input.tamPopulation);
  const spendNode = lb.addInput(spendIn);
  const tamPop = dec(input.tamPopulation.value);
  lb.addCalculated({
    nodeKey: 'sizing.tam.value',
    label: 'TAM',
    value: toAmountString(tamPop.times(spend)),
    unit: 'currency_per_year',
    formulaText: `TAM = ${input.tamPopulation.label} × ${spendIn.label}`,
    formulaWithValues: `${fmtNumber(tamPop)} × ${spendTxt} = ${fmtMoney(tamPop.times(spend), currency)}/year`,
    inputs: [tamIn, spendNode],
  });

  const active = input.cohorts.filter((c) => c.status === 'active');
  const cohortNodes = active.map((c) =>
    lb.addNode({
      nodeKey: cohortNode(c),
      label: c.name,
      kind: c.ref.type === 'assumption_version' ? 'assumption' : 'evidence',
      value: String(c.siteCount),
      unit,
      ref: c.ref,
      formulaText: c.rule,
    }),
  );

  let samPopNode: string | null = null;
  if (sam) {
    const overlapNode = lb.addCalculated({
      nodeKey: 'sizing.sam.overlap_removed',
      label: 'Overlap removed',
      value: String(-sam.overlapRemoved),
      unit,
      formulaText: sam.overlapFormula,
      formulaWithValues: `${fmtNumber(-sam.overlapRemoved)} ${unit}`,
      inputs: cohortNodes,
    });
    samPopNode = lb.addCalculated({
      nodeKey: 'sizing.sam.population',
      label: `SAM ${unit}`,
      value: String(sam.population),
      unit,
      formulaText: `SAM ${unit} = ${sam.formulaText}`,
      formulaWithValues: `${sam.formulaValues} = ${fmtNumber(sam.population)} ${unit}`,
      inputs: [...cohortNodes, overlapNode],
    });
    const samValue = new Dec(sam.population).times(spend);
    lb.addCalculated({
      nodeKey: 'sizing.sam.value',
      label: 'SAM',
      value: toAmountString(samValue),
      unit: 'currency_per_year',
      formulaText: `SAM = (${sam.formulaText}) × ${spendIn.label}`,
      formulaWithValues: `(${sam.formulaValues}) × ${spendTxt} = ${fmtMoney(samValue, currency)}/year`,
      inputs: [...cohortNodes, overlapNode, spendNode],
    });
    if (input.crossCheck && crossCheck !== 'not_available') {
      const cc = input.crossCheck;
      lb.addCalculated({
        nodeKey: 'sizing.cross_check',
        label: 'Top-down cross-check',
        value: null,
        unit: 'text',
        formulaText: 'Bottom-up SAM inside the top-down range? (test only, never averaged)',
        formulaWithValues: `${fmtMoney(samValue, currency)}/year vs ${fmtMoney(dec(cc.low), currency)}–${fmtMoney(dec(cc.high), currency)}/year → ${crossCheck === 'within_range' ? 'Within range' : 'Outside range'}`,
        inputs: ['sizing.sam.value'],
      });
    }
  }

  const reachIn = lb.addInput(input.reachablePool);
  const reach = dec(input.reachablePool.value);
  const reachNode = lb.addCalculated({
    nodeKey: 'sizing.reachable_pool',
    label: 'Reachable pool',
    value: reach.toFixed(),
    unit,
    formulaText: `Reachable pool = ${input.reachablePool.label}, at most SAM ${unit} (a count, never money)`,
    formulaWithValues: sam
      ? `${fmtNumber(reach)} ${unit} ≤ ${fmtNumber(sam.population)} ${unit}`
      : `${fmtNumber(reach)} ${unit}`,
    inputs: samPopNode ? [reachIn, samPopNode] : [reachIn],
  });

  if (som.length > 0) {
    const capIn = lb.addInput(input.capacity);
    const capacity = dec(input.capacity.value);
    for (const s of som) {
      const a = input.adoption[s.scenario] as EngineInput;
      const adoptIn = lb.addInput(a);
      const label = SCENARIO_LABELS[s.scenario];
      const customersNode = lb.addCalculated({
        nodeKey: `sizing.som.${s.scenario}.customers`,
        label: `SOM customers · ${label}`,
        kind: 'scenario',
        value: String(s.customers),
        unit: 'customers',
        formulaText: 'Customers = min(floor(Reachable pool × Adoption), Capacity)',
        formulaWithValues: `min(floor(${fmtNumber(reach)} × ${fmtRate(dec(a.value))}), ${fmtNumber(capacity)}) = min(${fmtNumber(s.uncappedCustomers)}, ${fmtNumber(capacity)}) = ${fmtNumber(s.customers)}${s.capped ? ' (capacity cap)' : ''}`,
        inputs: [reachNode, adoptIn, capIn],
      });
      lb.addCalculated({
        nodeKey: `sizing.som.${s.scenario}.annual_revenue`,
        label: `SOM · ${label}`,
        kind: 'scenario',
        value: s.annualRevenue.amount,
        unit: 'currency_per_year',
        formulaText: `SOM = Customers × ${spendIn.label} (annual revenue at end of year ${input.horizonYears})`,
        formulaWithValues: `${fmtNumber(s.customers)} × ${spendTxt} = ${fmtMoney(dec(s.annualRevenue.amount), currency)}/year`,
        inputs: [customersNode, spendNode],
      });
    }
  }
  return lb.build();
}
