/**
 * Deterministic economics engine (PRD ME-07, §6; ARCHITECTURE.md §10).
 *
 * Rules the implementation MUST follow:
 *  - decimal.js only. Currency and price year must match across inputs (else CURRENCY_MISMATCH /
 *    PRICE_YEAR_MISMATCH, blocking — "Normalize to EUR 2026").
 *  - Per scenario (downside, base, upside — fixed order; a missing scenario adoption → scenario omitted):
 *      customers            = min(floor(reachable × adoption), capacity)   [capped flag]
 *      annual revenue       = customers × annual price                       (per_year)
 *      gross contribution   = annual revenue × gross margin                  (per_year)
 *      contribution after opex = gross contribution − annual incremental opex (per_year; may be 0 or negative)
 *  - One-time investment is returned as its own Money (one_time). No function in this module adds,
 *    subtracts or compares a one_time amount with a per_year amount. A type-level guard enforces it
 *    (`PerYearAmount` / `OneTimeAmount` in ../sizing/numeric; arithmetic exists for per-year only).
 *  - Cash flow and payback are ALWAYS Unavailable in MVP, listing the missing inputs (ramp, retention,
 *    cash timing, partner margin, FX and base-year policy). No partial formula. (D-030)
 *  - Break-even ("What must be true?"): customers = ceil((target + opex) ÷ (price × margin)).
 *  - `whatChangesVsBase` names the variables that differ from Base (never probabilities).
 *  - Missing cost input → recommendation incomplete (MISSING_INPUT, blocking for commit).
 */
import { EconomicsInput, SCENARIO_LABELS, SCENARIO_ORDER } from '@growth-os/contracts';
import type {
  EconomicsOutput,
  EconomicsScenarioOutput,
  EngineInput,
  Scenario,
  Unavailable,
} from '@growth-os/contracts';
import { hashCanonical } from '../../platform/snapshot/canonical';
import {
  CheckList,
  checkCapacity,
  checkMoneyInput,
  checkRate,
  checkUnit,
  checkWholeCount,
} from '../sizing/checks';
import { LineageBuilder } from '../sizing/lineage';
import {
  Dec,
  addPerYear,
  capCustomers,
  dec,
  fmtMoney,
  fmtNumber,
  fmtRate,
  oneTime,
  perYear,
  scalePerYear,
  subtractPerYear,
  toAmountString,
  toMoney,
  unitWord,
  type PerYearAmount,
} from '../sizing/numeric';

export const ECONOMICS_ENGINE_VERSION = '1.0.0';

export const ECONOMICS_EXCLUSIONS_TEXT =
  'Before taxes, working capital, ramp timing and financing. Constant price and margin. Not a year-one profit or cash-flow forecast.';

/** Cash-flow inputs in display order, with the labels the S08 "Missing inputs" list shows. */
export const CASH_FLOW_INPUT_LABELS = {
  acquisitionRamp: 'Acquisition ramp',
  retention: 'Retention',
  cashTiming: 'Cash timing',
  partnerMargin: 'Partner margin',
  fxAndBaseYearPolicy: 'FX and base year policy',
} as const satisfies Record<keyof EconomicsInput['cashFlowInputs'], string>;

export const BREAK_EVEN_FORMULA_TEXT = 'customers = opex ÷ (price × margin)';
export const TARGET_FORMULA_TEXT = 'customers = (target contribution after opex + opex) ÷ (price × margin)';

export interface EconomicsEngine {
  readonly version: string;
  calculate(input: EconomicsInput): Promise<EconomicsOutput>;
  breakEven(input: EconomicsInput, targetContributionAfterOpex: string): EconomicsOutput['breakEven'];
}

export function createEconomicsEngine(): EconomicsEngine {
  return {
    version: ECONOMICS_ENGINE_VERSION,
    calculate: async (raw) => {
      const input = EconomicsInput.parse(raw);
      const { hash } = await hashCanonical(input);
      return calculateEconomics(input, hash);
    },
    breakEven: (raw, target) => {
      const input = EconomicsInput.parse(raw);
      const checks = runChecks(input);
      return breakEven(input, target, checks.blocksAny(recurringInputKeys(input)));
    },
  };
}

/** Input keys every per-year scenario figure depends on. */
function recurringInputKeys(input: EconomicsInput): string[] {
  return [
    input.reachablePool,
    input.capacity,
    input.annualPricePerCustomer,
    input.grossMargin,
    input.annualIncrementalOpex,
    input.adoption.base,
    ...(input.adoption.downside ? [input.adoption.downside] : []),
    ...(input.adoption.upside ? [input.adoption.upside] : []),
  ].map((i) => i.inputKey);
}

function runChecks(input: EconomicsInput): CheckList {
  const { currency, priceYear } = input;
  const hint = `Normalize to ${currency} ${priceYear}.`;
  const checks = new CheckList();

  checkMoneyInput(checks, input.annualPricePerCustomer, currency, priceYear, hint);
  checkUnit(checks, input.annualPricePerCustomer, ['currency_per_year_per_site']);
  checkMoneyInput(checks, input.annualIncrementalOpex, currency, priceYear, hint);
  checkUnit(checks, input.annualIncrementalOpex, ['currency_per_year']);
  checkUnit(checks, input.grossMargin, ['rate']);
  checkRate(checks, input.grossMargin);
  checkUnit(checks, input.reachablePool, ['sites', 'companies', 'customers']);
  checkWholeCount(checks, input.reachablePool);
  checkUnit(checks, input.capacity, ['customers', input.reachablePool.unit]);
  checkCapacity(checks, input.capacity);
  for (const s of SCENARIO_ORDER) {
    const a = input.adoption[s];
    if (!a) continue;
    checkUnit(checks, a, ['rate']);
    checkRate(checks, a);
  }
  if (input.oneTimeInvestment) {
    checkMoneyInput(checks, input.oneTimeInvestment, currency, priceYear, hint);
    checkUnit(checks, input.oneTimeInvestment, ['currency_one_time']);
  } else {
    checks.block(
      'MISSING_INPUT',
      'Recommendation incomplete — the one-time scale-entry investment is missing.',
      ['one_time_investment'],
    );
  }
  return checks;
}

function calculateEconomics(input: EconomicsInput, inputHash: string): EconomicsOutput {
  const { currency, priceYear } = input;
  const checks = runChecks(input);
  const recurringBlocked = checks.blocksAny(recurringInputKeys(input));

  const reach = dec(input.reachablePool.value);
  const capacity = dec(input.capacity.value);
  const price = perYear(
    'annual_spend_per_unit',
    dec(input.annualPricePerCustomer.value),
    currency,
    priceYear,
  );
  const margin = dec(input.grossMargin.value);
  const opex = perYear(
    'annual_incremental_opex',
    dec(input.annualIncrementalOpex.value),
    currency,
    priceYear,
  );
  const baseAdoption = dec(input.adoption.base.value);

  const lb = new LineageBuilder();
  const reachNode = lb.addInput(input.reachablePool);
  const capNode = lb.addInput(input.capacity);
  const priceNode = lb.addInput(input.annualPricePerCustomer);
  const marginNode = lb.addInput(input.grossMargin);
  const opexNode = lb.addInput(input.annualIncrementalOpex);
  const unit = unitWord(input.reachablePool.unit);
  const priceTxt = fmtMoney(price.amount, currency);

  const scenarios: EconomicsScenarioOutput[] = [];
  if (!recurringBlocked) {
    for (const scenario of SCENARIO_ORDER) {
      const a = input.adoption[scenario];
      if (!a) continue;
      const adoption = dec(a.value);
      const c = capCustomers(reach, adoption, capacity);
      const customers = new Dec(c.customers);
      const revenue = scalePerYear('annual_revenue', price, customers);
      const gross = scalePerYear('gross_contribution', revenue, margin);
      const after = subtractPerYear('contribution_after_opex', gross, opex);
      scenarios.push({
        scenario,
        adoption: a.value,
        uncappedCustomers: c.uncappedCustomers,
        customers: c.customers,
        capped: c.capped,
        annualRevenue: toMoney(revenue),
        grossContribution: toMoney(gross),
        annualIncrementalOpex: toMoney(opex),
        contributionAfterOpex: toMoney(after),
        whatChangesVsBase: whatChanges(scenario, adoption, baseAdoption, c, reach, unit),
      });
      if (c.capped) {
        checks.add(
          'CAPACITY_CAP_APPLIED',
          false,
          `${SCENARIO_LABELS[scenario]}: ${fmtNumber(c.customers)} customers — capacity cap reached (unconstrained would be ${fmtNumber(c.uncappedCustomers)}).`,
          [input.capacity.inputKey, a.inputKey],
        );
      }
      addScenarioLineage(lb, scenario, a, {
        reachNode,
        capNode,
        priceNode,
        marginNode,
        opexNode,
        reach,
        capacity,
        price,
        margin,
        opex,
        currency,
        customers: c,
        revenue,
        gross,
        after,
        priceTxt,
      });
    }
  }

  let oneTimeInvestment: EconomicsOutput['oneTimeInvestment'];
  if (!input.oneTimeInvestment) {
    oneTimeInvestment = unavailable('Not available — one-time investment not entered.', [
      'One-time scale-entry investment',
    ]);
  } else if (checks.blocksAny([input.oneTimeInvestment.inputKey])) {
    oneTimeInvestment = unavailable(`Not available — ${input.oneTimeInvestment.label} must be normalized.`, [
      input.oneTimeInvestment.label,
    ]);
  } else {
    lb.addInput(input.oneTimeInvestment);
    oneTimeInvestment = toMoney(oneTime(dec(input.oneTimeInvestment.value), currency, priceYear));
  }

  const be = breakEven(input, '0.00', recurringBlocked);
  if (be.customers !== null) {
    lb.addCalculated({
      nodeKey: 'economics.break_even.customers',
      label: 'Break-even customers',
      value: String(be.customers),
      unit: 'customers',
      formulaText: be.formulaText,
      formulaWithValues: `ceil(${fmtMoney(opex.amount, currency)} ÷ (${priceTxt} × ${fmtRate(margin)})) = ${fmtNumber(be.customers)}`,
      inputs: [opexNode, priceNode, marginNode],
    });
  }

  return {
    engine: 'economics',
    engineVersion: ECONOMICS_ENGINE_VERSION,
    inputHash,
    blocked: checks.blocked,
    checks: checks.list(),
    scenarios,
    oneTimeInvestment,
    cashFlow: cashFlowUnavailable(input, 'Cash flow'),
    payback: cashFlowUnavailable(input, 'Payback'),
    breakEven: be,
    exclusionsText: ECONOMICS_EXCLUSIONS_TEXT,
    lineage: lb.build(),
  };
}

/**
 * "What must be true?": customers = ceil((target + opex) ÷ (price × margin)). Target and opex are
 * both per-year; the one-time investment never enters. Null when the inputs cannot support it.
 */
function breakEven(
  input: EconomicsInput,
  targetContributionAfterOpex: string,
  recurringBlocked: boolean,
): EconomicsOutput['breakEven'] {
  const { currency, priceYear } = input;
  const target = perYear('contribution_after_opex', dec(targetContributionAfterOpex), currency, priceYear);
  const formulaText = target.amount.isZero() ? BREAK_EVEN_FORMULA_TEXT : TARGET_FORMULA_TEXT;
  const result = { targetContributionAfterOpex: toAmountString(target.amount), formulaText };
  const perCustomer = dec(input.annualPricePerCustomer.value).times(dec(input.grossMargin.value));
  if (recurringBlocked || !perCustomer.gt(0)) return { ...result, customers: null };
  const opex = perYear(
    'annual_incremental_opex',
    dec(input.annualIncrementalOpex.value),
    currency,
    priceYear,
  );
  const needed: PerYearAmount = addPerYear('contribution_after_opex', target, opex);
  const customers = Dec.max(needed.amount.div(perCustomer).ceil(), 0);
  return { ...result, customers: customers.toNumber() };
}

function whatChanges(
  scenario: Scenario,
  adoption: Dec,
  baseAdoption: Dec,
  c: { uncappedCustomers: number; customers: number; capped: boolean },
  reach: Dec,
  unit: string,
): string[] {
  if (scenario === 'base') return [];
  const out: string[] = [];
  if (!adoption.eq(baseAdoption)) {
    out.push(
      `Adoption ${fmtRate(adoption)} (${fmtNumber(c.uncappedCustomers)} of ${fmtNumber(reach)} ${unit})`,
    );
  }
  if (c.capped) {
    out.push(
      `${fmtNumber(c.customers)} customers: capacity cap reached (unconstrained would be ${fmtNumber(c.uncappedCustomers)})`,
    );
  }
  return out;
}

function unavailable(reason: string, missingInputs: string[]): Unavailable {
  return { unavailable: true, reason, missingInputs };
}

/** Always Unavailable in the MVP (D-030). Lists whichever cash-flow inputs are missing. */
function cashFlowUnavailable(input: EconomicsInput, what: 'Cash flow' | 'Payback'): Unavailable {
  const missing = (Object.keys(CASH_FLOW_INPUT_LABELS) as Array<keyof typeof CASH_FLOW_INPUT_LABELS>)
    .filter((k) => input.cashFlowInputs[k] === null)
    .map((k) => CASH_FLOW_INPUT_LABELS[k]);
  const reason =
    missing.length > 0
      ? `Not available — no reproducible ${what.toLowerCase()} formula without these inputs.`
      : `Not available — ${what.toLowerCase()} is not calculated in this release.`;
  return unavailable(reason, missing);
}

interface ScenarioLineageCtx {
  reachNode: string;
  capNode: string;
  priceNode: string;
  marginNode: string;
  opexNode: string;
  reach: Dec;
  capacity: Dec;
  price: PerYearAmount;
  margin: Dec;
  opex: PerYearAmount;
  currency: string;
  customers: { uncappedCustomers: number; customers: number; capped: boolean };
  revenue: PerYearAmount;
  gross: PerYearAmount;
  after: PerYearAmount;
  priceTxt: string;
}

function addScenarioLineage(lb: LineageBuilder, scenario: Scenario, a: EngineInput, x: ScenarioLineageCtx) {
  const label = SCENARIO_LABELS[scenario];
  const key = (k: string) => `economics.${scenario}.${k}`;
  const m = (v: Dec) => fmtMoney(v, x.currency);
  const adoptNode = lb.addInput(a);
  const cust = lb.addCalculated({
    nodeKey: key('customers'),
    label: `Customers · ${label}`,
    kind: 'scenario',
    value: String(x.customers.customers),
    unit: 'customers',
    formulaText: 'Customers = min(floor(Reachable pool × Adoption), Capacity)',
    formulaWithValues: `min(floor(${fmtNumber(x.reach)} × ${fmtRate(dec(a.value))}), ${fmtNumber(x.capacity)}) = ${fmtNumber(x.customers.customers)}${x.customers.capped ? ' (capacity cap)' : ''}`,
    inputs: [x.reachNode, adoptNode, x.capNode],
  });
  const rev = lb.addCalculated({
    nodeKey: key('annual_revenue'),
    label: `Annual revenue · ${label}`,
    kind: 'scenario',
    value: toAmountString(x.revenue.amount),
    unit: 'currency_per_year',
    formulaText: 'Annual revenue = Customers × Annual price',
    formulaWithValues: `${fmtNumber(x.customers.customers)} × ${x.priceTxt} = ${m(x.revenue.amount)}/year`,
    inputs: [cust, x.priceNode],
  });
  const gross = lb.addCalculated({
    nodeKey: key('gross_contribution'),
    label: `Gross contribution · ${label}`,
    kind: 'scenario',
    value: toAmountString(x.gross.amount),
    unit: 'currency_per_year',
    formulaText: 'Gross contribution = Annual revenue × Gross margin',
    formulaWithValues: `${m(x.revenue.amount)} × ${fmtRate(x.margin)} = ${m(x.gross.amount)}/year`,
    inputs: [rev, x.marginNode],
  });
  lb.addCalculated({
    nodeKey: key('contribution_after_opex'),
    label: `Contribution after incremental opex · ${label}`,
    kind: 'scenario',
    value: toAmountString(x.after.amount),
    unit: 'currency_per_year',
    formulaText: 'Contribution after opex = Gross contribution − Annual incremental opex',
    formulaWithValues: `${m(x.gross.amount)} − ${m(x.opex.amount)} = ${m(x.after.amount)}/year`,
    inputs: [gross, x.opexNode],
  });
}
