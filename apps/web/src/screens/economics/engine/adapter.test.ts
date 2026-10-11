/** The economics adapter: drivers ↔ engine input, and edit-field conversion. */
import { EconomicsInput } from '@growth-os/contracts';
import { economicsV2Input } from '@growth-os/fixtures-aster';
import { describe, expect, it } from 'vitest';
import { driversFromInput } from '../mock-builders';
import { DRIVER_FIELDS, economicsEngine, economicsInputFromDrivers, fieldText, fieldValue } from './adapter';

const version = (input: EconomicsInput) => ({
  currency: input.currency,
  priceYear: input.priceYear,
  horizonYears: input.horizonYears,
  drivers: driversFromInput(input, '2026-10-13T16:30:00+02:00', null),
});

describe('economics adapter', () => {
  it('rebuilds exactly the fixture input from the version drivers (same engine hash)', async () => {
    const rebuilt = economicsInputFromDrivers(version(economicsV2Input));
    expect(rebuilt).toEqual(EconomicsInput.parse(economicsV2Input));
    const [a, b] = await Promise.all([
      economicsEngine.calculate(rebuilt),
      economicsEngine.calculate(economicsV2Input),
    ]);
    expect(a).toEqual(b);
  });

  it('applies edited values by input key', async () => {
    const edited = economicsInputFromDrivers(version(economicsV2Input), { 'adoption_rate.base': '0.25' });
    const out = await economicsEngine.calculate(edited);
    const base = out.scenarios.find((s) => s.scenario === 'base')!;
    expect(base.uncappedCustomers).toBe(125);
    expect(base.customers).toBe(120);
    expect(base.capped).toBe(true);
  });

  it('converts edit fields without losing the exact decimal string', () => {
    const price = DRIVER_FIELDS.annual_price!;
    const rate = DRIVER_FIELDS['adoption_rate.base']!;
    expect(fieldText(price, '20000.00')).toBe('20');
    expect(fieldText(rate, '0.20')).toBe('20');
    expect(fieldValue(rate, '20', '0.20')).toBe('0.20');
    expect(fieldValue(rate, '12.5', '0.20')).toBe('0.125');
    expect(fieldValue(price, '22', '20000.00')).toBe('22000.00');
    expect(fieldValue(price, 'abc', '20000.00')).toBeNull();
    expect(fieldValue(DRIVER_FIELDS.capacity!, '130', '120')).toBe('130');
  });
});
