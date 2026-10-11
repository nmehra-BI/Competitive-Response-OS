import { describe, expect, it } from 'vitest';
import { isPositiveAmount, parseAmount } from './money';

describe('parseAmount', () => {
  it('normalises to two fraction digits without float arithmetic', () => {
    expect(parseAmount('8000')).toBe('8000.00');
    expect(parseAmount(' 8,000.5 ')).toBe('8000.50');
    expect(parseAmount('130 000')).toBe('130000.00');
    expect(parseAmount('007.25')).toBe('7.25');
    expect(parseAmount('0')).toBe('0.00');
  });

  it('refuses negatives, three fraction digits, words and blanks (blank is not zero)', () => {
    for (const bad of ['', '  ', '-5', '1.234', 'eight', '1e3', '€8k'])
      expect([bad, parseAmount(bad)]).toEqual([bad, null]);
  });

  it('a positive amount has a non-zero digit', () => {
    expect(isPositiveAmount('0.00')).toBe(false);
    expect(isPositiveAmount(null)).toBe(false);
    expect(isPositiveAmount('0.01')).toBe(true);
  });
});
