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
 *    subtracts or compares a one_time amount with a per_year amount. A type-level guard enforces it.
 *  - Cash flow and payback are ALWAYS Unavailable in MVP, listing the missing inputs (ramp, retention,
 *    cash timing, partner margin, FX and base-year policy). No partial formula.
 *  - Break-even ("What must be true?"): customers = ceil((target + opex) ÷ (price × margin)).
 *  - `whatChangesVsBase` names the variables that differ from Base (never probabilities).
 *  - Missing cost input → recommendation incomplete (MISSING_INPUT, blocking for commit).
 */
import type { EconomicsInput, EconomicsOutput } from '@growth-os/contracts';

export const ECONOMICS_ENGINE_VERSION = '1.0.0';

export const ECONOMICS_EXCLUSIONS_TEXT =
  'Before taxes, working capital, ramp timing and financing. Constant price and margin. Not a year-one profit or cash-flow forecast.';

export interface EconomicsEngine {
  readonly version: string;
  calculate(input: EconomicsInput): Promise<EconomicsOutput>;
  breakEven(input: EconomicsInput, targetContributionAfterOpex: string): EconomicsOutput['breakEven'];
}

/** TODO(WS2 domain engines): implement; golden test fixtures/aster expectedEconomics must pass. */
export function createEconomicsEngine(): EconomicsEngine {
  return {
    version: ECONOMICS_ENGINE_VERSION,
    calculate: async () => {
      throw new Error('TODO(WS2): EconomicsEngine.calculate');
    },
    breakEven: () => {
      throw new Error('TODO(WS2): EconomicsEngine.breakEven');
    },
  };
}
