/** Pure helpers used by the WS4b modules: display money, exact decimal comparison, budget cents. */
import { describe, expect, it } from 'vitest';
import { compareDecimal, cents, fmtMoneyShort, fromCents, isDecimal, scaled } from './common';
import { assumptionValueText, fmtCompact, resultSummary } from './snapshot';

describe('fmtMoneyShort (button labels)', () => {
  it('renders the scoped labels of the journey', () => {
    expect(fmtMoneyShort('120000.00', 'EUR')).toBe('€120k');
    expect(fmtMoneyShort('15000.00', 'EUR')).toBe('€15k');
    expect(fmtMoneyShort('1250.00', 'EUR')).toBe('€1,250');
    expect(fmtMoneyShort('1250.50', 'USD')).toBe('USD 1,250.50');
  });
});

describe('exact decimals', () => {
  it('compares without floating point', () => {
    expect(compareDecimal('9', '8.00000000')).toBe(1);
    expect(compareDecimal('4', '4.00000000')).toBe(0);
    expect(compareDecimal('0.1', '0.10000001')).toBe(-1);
    expect(compareDecimal('-1', '0')).toBe(-1);
    expect(scaled('3.5')).toBe(350_000_000n);
    expect(isDecimal('3.5')).toBe(true);
    expect(isDecimal('Above')).toBe(false);
  });

  it('sums budget money in integer cents and prints a true zero as 0.00', () => {
    expect(fromCents(cents('120000.00') - cents('45000.50') - cents('74999.50'))).toBe('0.00');
    expect(fromCents(cents('0.10') + cents('0.20'))).toBe('0.30');
  });
});

describe('snapshot display copy', () => {
  it('formats assumption values and the compact package table', () => {
    expect(assumptionValueText({ value: '0.25000000', value_text: null, unit: 'rate' })).toBe('25%');
    expect(
      assumptionValueText({ value: '20000.00', value_text: null, unit: 'currency_per_year_per_site' }),
    ).toBe('€20,000 per site per year');
    expect(assumptionValueText({ value: null, value_text: null, unit: 'text' })).toBe('Unknown');
    expect(fmtCompact('2400000.00')).toBe('€2.4m');
    expect(fmtCompact('600000.00')).toBe('€600k');
    expect(fmtCompact('0.00')).toBe('€0k');
  });

  it('summarises results without inventing values', () => {
    expect(
      resultSummary([
        { metricKey: 'a', observedText: '9', result: 'met' },
        { metricKey: 'b', observedText: '—', result: null },
      ]),
    ).toBe('Met · 9; Too early to read · b');
  });
});
