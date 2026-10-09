/**
 * Opportunity comparison ranking (PRD ME-04, S04).
 *
 *  Score = Product fit × w₁ + Channel access × w₂ + Evidence coverage × w₃   (ratings 1–3, weights sum 100)
 *  - Any Unknown input → "Not ranked — n inputs missing" (never treated as 0).
 *  - Excluded or incomparable-boundary candidates → "Excluded until normalized"; they stay in the table.
 *  - Market size is not used while fewer than all candidates are sized on a common boundary.
 *  - Weights are versioned; applying creates a new version, earlier versions are kept.
 *  - Output score is a decimal string with 2 decimals; ties keep input order.
 *
 * Implementation notes:
 *  - Weights are percentages, so the score is (Σ rating × weight) ÷ 100, on the 1–3 rating scale
 *    ("2.70 of 3"). Computed with decimal.js; never with floats.
 *  - A candidate with an incomparable boundary that has NOT been excluded blocks the aggregate
 *    ranking for the whole set: every row reads "Not ranked — boundary conflict in set" and
 *    `valid` is false. Excluding it ("Exclude until normalized") lifts the block.
 *  - Weights that are not whole numbers in 0–100 summing to 100 make the ranking invalid.
 *  - Returned rows: ranked rows by score (highest first, ties in input order), then unranked rows
 *    in input order. Every input row is returned exactly once.
 */
import type { RankingRow, RankingWeights } from '@growth-os/contracts';
import { Dec, fmtRate } from '../sizing/numeric';

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

export const RANKING_REASONS = {
  boundaryConflict: 'Not ranked — boundary conflict in set',
  excluded: 'Excluded until normalized',
  weightsInvalid: 'Weights must total 100%',
} as const;

const CRITERIA = [
  { key: 'productFit', label: 'product fit' },
  { key: 'channelAccess', label: 'channel access' },
  { key: 'evidenceCoverage', label: 'evidence coverage' },
] as const;

type Weights = Omit<RankingWeights, 'version'>;

export function totalWeight(weights: Weights): number {
  return weights.productFit + weights.channelAccess + weights.evidenceCoverage;
}

export function weightsValid(weights: Weights): boolean {
  const ws = [weights.productFit, weights.channelAccess, weights.evidenceCoverage];
  return ws.every((w) => Number.isInteger(w) && w >= 0 && w <= 100) && totalWeight(weights) === 100;
}

/** Names of the Unknown inputs of a row, in criterion order. */
export function missingInputs(row: RankingInputRow): string[] {
  return CRITERIA.filter((c) => row[c.key] === null).map((c) => c.label);
}

/** "Not ranked — 1 input missing (channel access)". */
export function notRankedReason(missing: readonly string[]): string {
  const n = missing.length;
  return `Not ranked — ${n} input${n === 1 ? '' : 's'} missing (${missing.join(', ')})`;
}

/** Exact score as a 2-decimal string, or null when any input is Unknown. */
export function scoreOf(row: RankingInputRow, weights: Weights): string | null {
  if (missingInputs(row).length > 0) return null;
  const sum = CRITERIA.reduce(
    (acc, c) => acc.plus(new Dec(row[c.key] as number).times(weights[c.key])),
    new Dec(0),
  );
  return sum.div(100).toFixed(2, Dec.ROUND_HALF_EVEN);
}

/**
 * The inspectable formula with values for one row, e.g.
 * "3 × 40% + 3 × 30% + 2 × 30% = 2.70 of 3", or the not-ranked reason.
 */
export function explainScore(row: RankingInputRow, weights: Weights): string {
  const missing = missingInputs(row);
  const parts = CRITERIA.map((c) => {
    const r = row[c.key];
    return `${r === null ? 'Unknown' : r} × ${fmtRate(new Dec(weights[c.key]).div(100))}`;
  }).join(' + ');
  if (missing.length > 0) return `${parts} → ${notRankedReason(missing)}`;
  return `${parts} = ${scoreOf(row, weights)} of 3`;
}

export function rankOpportunities(
  rows: readonly RankingInputRow[],
  weights: Weights,
): { valid: boolean; ranking: RankingRow[] } {
  const conflict = rows.some((r) => r.incomparable && !r.excluded);
  if (conflict) {
    return {
      valid: false,
      ranking: rows.map((r) => notRanked(r.opportunityId, RANKING_REASONS.boundaryConflict)),
    };
  }
  if (!weightsValid(weights)) {
    return {
      valid: false,
      ranking: rows.map((r) =>
        notRanked(r.opportunityId, r.excluded ? RANKING_REASONS.excluded : RANKING_REASONS.weightsInvalid),
      ),
    };
  }

  const ranked: Array<{ row: RankingRow; score: Dec; index: number }> = [];
  const unranked: RankingRow[] = [];
  rows.forEach((r, index) => {
    if (r.excluded) {
      unranked.push(notRanked(r.opportunityId, RANKING_REASONS.excluded));
      return;
    }
    const missing = missingInputs(r);
    if (missing.length > 0) {
      unranked.push(notRanked(r.opportunityId, notRankedReason(missing)));
      return;
    }
    const score = scoreOf(r, weights)!;
    ranked.push({
      row: { opportunityId: r.opportunityId, ranked: true, score, reason: null },
      score: new Dec(score),
      index,
    });
  });
  ranked.sort((a, b) => b.score.comparedTo(a.score) || a.index - b.index);
  return { valid: true, ranking: [...ranked.map((x) => x.row), ...unranked] };
}

function notRanked(opportunityId: string, reason: string): RankingRow {
  return { opportunityId, ranked: false, score: null, reason };
}

export function createRankingEngine(): RankingEngine {
  return { rank: rankOpportunities };
}
