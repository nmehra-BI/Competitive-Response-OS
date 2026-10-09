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
 */
import type { SizingInput, SizingOutput } from '@growth-os/contracts';

export const SIZING_ENGINE_VERSION = '1.0.0';

export interface SizingEngine {
  readonly version: string;
  /** Pure and deterministic. Never throws for business problems: returns blocking checks instead. */
  calculate(input: SizingInput): Promise<SizingOutput>;
}

/** TODO(WS2 domain engines): implement; golden test fixtures/aster expectedSizing must pass. */
export function createSizingEngine(): SizingEngine {
  return {
    version: SIZING_ENGINE_VERSION,
    calculate: async () => {
      throw new Error('TODO(WS2): SizingEngine.calculate');
    },
  };
}
