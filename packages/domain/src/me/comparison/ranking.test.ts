/** Ranking properties: Unknown is never 0, incomparable boundaries block, deterministic ordering. */
import { describe, expect, it } from 'vitest';
import { RankingRow } from '@growth-os/contracts';
import { createRankingEngine, scoreOf, type RankingInputRow } from './ranking';
import { forAll, int, type Rng } from '../sizing/property-gen';

const engine = createRankingEngine();
const rating = (r: Rng, unknownShare = 0.15): 1 | 2 | 3 | null =>
  r() < unknownShare ? null : (int(r, 1, 3) as 1 | 2 | 3);

function genRows(r: Rng): RankingInputRow[] {
  return Array.from({ length: int(r, 2, 4) }, (_, k) => ({
    opportunityId: `00000000-0000-4000-8000-00000000000${k}`,
    productFit: rating(r),
    channelAccess: rating(r),
    evidenceCoverage: rating(r),
    excluded: r() < 0.15,
    incomparable: false,
  }));
}

function genWeights(r: Rng) {
  const a = int(r, 0, 100);
  const b = int(r, 0, 100 - a);
  return { productFit: a, channelAccess: b, evidenceCoverage: 100 - a - b };
}

describe('ranking properties', () => {
  it('every row is returned once; rows match the frozen contract; ranked rows sorted by score', async () => {
    await forAll(
      201,
      300,
      (r) => ({ rows: genRows(r), w: genWeights(r) }),
      ({ rows, w }, _r, label) => {
        const out = engine.rank(rows, w);
        expect(out.valid, label).toBe(true);
        expect(out.ranking.map((x) => x.opportunityId).sort(), label).toEqual(
          rows.map((x) => x.opportunityId).sort(),
        );
        out.ranking.forEach((x) => RankingRow.parse(x));
        const scores = out.ranking.filter((x) => x.ranked).map((x) => Number(x.score));
        expect(scores, label).toEqual([...scores].sort((a, b) => b - a));
        // rank is the 1-based position among ranked rows; unranked rows carry null (D-068)
        expect(
          out.ranking.map((x) => x.rank),
          label,
        ).toEqual(out.ranking.map((x, i) => (x.ranked ? i + 1 : null)));
        expect(engine.rank(rows, w), label).toEqual(out);
      },
    );
  });

  it('Unknown is never treated as 0: any Unknown input → not ranked with the count', async () => {
    await forAll(
      202,
      300,
      (r) => ({ rows: genRows(r), w: genWeights(r) }),
      ({ rows, w }, _r, label) => {
        const out = engine.rank(rows, w);
        for (const row of rows) {
          const res = out.ranking.find((x) => x.opportunityId === row.opportunityId)!;
          const missing = [row.productFit, row.channelAccess, row.evidenceCoverage].filter(
            (v) => v === null,
          ).length;
          if (row.excluded) expect(res.reason, label).toBe('Excluded until normalized');
          else if (missing > 0) {
            expect(res.ranked, label).toBe(false);
            expect(res.score, label).toBeNull();
            expect(res.reason, label).toMatch(
              new RegExp(`^Not ranked — ${missing} input${missing === 1 ? '' : 's'} missing \\(`),
            );
          } else {
            expect(res.ranked, label).toBe(true);
            expect(res.score, label).toBe(scoreOf(row, w));
          }
        }
      },
    );
  });

  it('one non-excluded incomparable candidate blocks the aggregate ranking', async () => {
    await forAll(
      203,
      200,
      (r) => ({ rows: genRows(r), w: genWeights(r), k: r() }),
      ({ rows, w, k }, _r, label) => {
        const i = Math.floor(k * rows.length);
        rows[i] = { ...rows[i]!, incomparable: true, excluded: false };
        const out = engine.rank(rows, w);
        expect(out.valid, label).toBe(false);
        expect(
          out.ranking.every((x) => !x.ranked && x.score === null),
          label,
        ).toBe(true);
        rows[i] = { ...rows[i]!, excluded: true };
        expect(engine.rank(rows, w).valid, label).toBe(true);
      },
    );
  });

  it('ties keep input order', () => {
    const row = (k: number): RankingInputRow => ({
      opportunityId: `00000000-0000-4000-8000-00000000000${k}`,
      productFit: 2,
      channelAccess: 2,
      evidenceCoverage: 2,
      excluded: false,
      incomparable: false,
    });
    const out = engine.rank([row(3), row(1), row(2)], {
      productFit: 40,
      channelAccess: 30,
      evidenceCoverage: 30,
    });
    expect(out.ranking.map((x) => x.opportunityId.at(-1))).toEqual(['3', '1', '2']);
    expect(out.ranking.every((x) => x.score === '2.00')).toBe(true);
  });
});
