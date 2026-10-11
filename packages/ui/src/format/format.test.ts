import { describe, expect, it } from 'vitest';
import { expectedDisplay, expectedEconomics, expectedSizing } from '@growth-os/fixtures-aster';
import {
  formatAgainstTarget,
  formatContributionK,
  formatCount,
  formatExact,
  formatGrossContribution,
  formatMarketSpend,
  formatNotAvailable,
  formatOneTime,
  formatRangeMillions,
  formatRate,
  formatScenarioRevenue,
  formatSigned,
} from './format';

const S = ['downside', 'base', 'upside'] as const;

describe('display rules render the Aster fixture exactly as the prototype', () => {
  it('market measures', () => {
    expect(formatMarketSpend(expectedSizing.tam.value, 'EUR')).toBe(expectedDisplay.tam);
    expect(formatMarketSpend(expectedSizing.sam.value, 'EUR')).toBe(expectedDisplay.sam);
    expect(`${formatScenarioRevenue(expectedSizing.som.base.annualRevenue, 'EUR')} annual revenue`).toBe(
      expectedDisplay.somBase,
    );
  });

  it('scenario table rows use one format per row', () => {
    expect(S.map((s) => formatScenarioRevenue(expectedEconomics[s].annualRevenue, 'EUR'))).toEqual(
      expectedDisplay.scenarioRevenue,
    );
    expect(S.map((s) => formatGrossContribution(expectedEconomics[s].grossContribution, 'EUR'))).toEqual(
      expectedDisplay.scenarioGross,
    );
    expect(S.map((s) => formatContributionK(expectedEconomics[s].annualIncrementalOpex, 'EUR'))).toEqual(
      expectedDisplay.scenarioOpex,
    );
    expect(S.map((s) => formatContributionK(expectedEconomics[s].contributionAfterOpex, 'EUR'))).toEqual(
      expectedDisplay.scenarioAfterOpex,
    );
  });

  it('one-time, counts, signed adjustments, rates, ranges, exact and missing', () => {
    expect(formatOneTime(expectedEconomics.oneTimeInvestment, 'EUR')).toBe(expectedDisplay.oneTime);
    expect(formatCount(5000)).toBe('5,000');
    expect(formatSigned(-500)).toBe(expectedDisplay.overlapRow);
    expect(formatRate('0.20')).toBe('20%');
    expect(formatRangeMillions('35000000', '50000000', 'EUR')).toBe('€35–50m/year');
    expect(formatExact('40000000.00', 'EUR')).toBe('€40,000,000');
    expect(formatNotAvailable('finance source unavailable')).toBe(
      'Not available — finance source unavailable',
    );
  });
});

describe('results against a pre-registered target (D-152)', () => {
  it('reads "9 interviews (target 8)", never "9 of 8"', () => {
    expect(formatAgainstTarget('9', '8', 'interviews')).toBe('9 interviews (target 8)');
    expect(formatAgainstTarget('4', '4', 'commitments')).toBe('4 commitments (target 4)');
    expect(formatAgainstTarget('9', '8')).toBe('9 (target 8)');
    expect(formatAgainstTarget('22', '16', 'hours_per_site')).toBe('22 hours per site (target 16)');
    expect(formatAgainstTarget('Yes', null, 'text')).toBe('Yes');
  });
});
