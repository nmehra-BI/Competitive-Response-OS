/**
 * S10 and the brief read validation results from the snapshot (D-152): one glyph row per metric,
 * each against its pre-registered target. Older snapshots joined rows with "; ".
 */
import { describe, expect, it } from 'vitest';
import { splitResultSummary } from './PackageArticle';

describe('splitResultSummary', () => {
  it('splits "Met · 9 interviews (target 8) · Met · 4 commitments (target 4)" into rows', () => {
    expect(splitResultSummary('Met · 9 interviews (target 8) · Met · 4 commitments (target 4)')).toEqual([
      { result: 'met', text: '9 interviews (target 8)' },
      { result: 'met', text: '4 commitments (target 4)' },
    ]);
  });

  it('keeps Not met, Inconclusive and Too early to read rows apart; reads the older "; " joins', () => {
    expect(
      splitResultSummary('Not met · 3 commitments (target 4) · Too early to read · completed_interviews'),
    ).toEqual([
      { result: 'not_met', text: '3 commitments (target 4)' },
      { result: null, text: 'Too early to read · completed_interviews' },
    ]);
    expect(splitResultSummary('Met · 9; Inconclusive · 2')).toEqual([
      { result: 'met', text: '9' },
      { result: 'inconclusive', text: '2' },
    ]);
  });
});
