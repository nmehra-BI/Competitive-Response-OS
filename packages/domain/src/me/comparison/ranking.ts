/**
 * Opportunity comparison ranking (PRD ME-04, S04).
 *
 *  Score = Product fit × w₁ + Channel access × w₂ + Evidence coverage × w₃   (ratings 1–3, weights sum 100)
 *  - Any Unknown input → "Not ranked — n inputs missing" (never treated as 0).
 *  - Excluded or incomparable-boundary candidates → "Excluded until normalized"; they stay in the table.
 *  - Market size is not used while fewer than all candidates are sized on a common boundary.
 *  - Weights are versioned; applying creates a new version, earlier versions are kept.
 *  - Output score is a decimal string with 2 decimals; ties keep input order.
 */
import type { RankingRow, RankingWeights } from '@growth-os/contracts';

export interface RankingInputRow {
  opportunityId: string;
  productFit: 1 | 2 | 3 | null;
  channelAccess: 1 | 2 | 3 | null;
  evidenceCoverage: 1 | 2 | 3 | null;
  excluded: boolean;
  incomparable: boolean;
}

export interface RankingEngine {
  rank(
    rows: readonly RankingInputRow[],
    weights: Omit<RankingWeights, 'version'>,
  ): { valid: boolean; ranking: RankingRow[] };
}

export const RANKING_FORMULA_TEXT =
  'Score = Product fit × w₁ + Channel access × w₂ + Evidence coverage × w₃ · ratings 1–3 · any Unknown input → not ranked';

/** TODO(WS2): implement. */
export function createRankingEngine(): RankingEngine {
  return {
    rank: () => {
      throw new Error('TODO(WS2): RankingEngine.rank');
    },
  };
}
