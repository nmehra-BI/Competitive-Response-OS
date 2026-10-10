/** S08 editor model: the economics.saveDraft body (D-112 §3). A blank is cleared, never sent as 0. */
import type { EconomicsVersion, LedgerRow } from '@growth-os/contracts';
import { describe, expect, it } from 'vitest';
import { econFormOf, enteredValues, missingDrivers, saveBody } from './editor-model';

const row = (inputKey: string, value: string, assumptionId: string | null, text: string | null = null) =>
  ({
    inputKey,
    name: inputKey,
    value,
    unit: 'rate',
    currency: null,
    kind: 'assumption',
    basis: { source: null, owner: null, text },
    evidenceQuality: null,
    assumptionId,
    version: 1,
    lastChangedAt: '2026-10-10T10:00:00Z',
    usedByCount: 1,
    disputed: false,
    changedInDraft: false,
  }) as LedgerRow;

const version = {
  currency: 'EUR',
  priceYear: 2026,
  horizonYears: 3,
  drivers: [
    row('gross_margin', '0.60', 'asm-9'),
    row('one_time_investment', '400000.00', 'asm-11'),
    row('annual_incremental_opex', '600000.00', 'asm-10', 'Scope: Sales and admin only'),
  ],
} as unknown as EconomicsVersion;

describe('S08 editor model', () => {
  it('reads the header, the links and the opex scope note', () => {
    const f = econFormOf(version);
    expect(f).toMatchObject({ currency: 'EUR', priceYear: '2026', horizonYears: '3' });
    expect(f.links['gross_margin']).toBe('asm-9');
    expect(f.opexScopeNote).toBe('Sales and admin only');
  });

  it('clears a blank driver and sends no value for it', () => {
    const f = econFormOf(version);
    f.values['one_time_investment'] = '';
    const body = saveBody(f, version);
    expect(body.clearInputKeys).toEqual(['one_time_investment']);
    expect(body.drivers.map((d) => d.inputKey)).not.toContain('one_time_investment');
    expect(enteredValues(f.values)).not.toHaveProperty('one_time_investment');
  });

  it('sends a link change, the header and the scope note only when they change', () => {
    const f = econFormOf(version);
    expect(saveBody(f, version)).toEqual({
      drivers: [
        { inputKey: 'gross_margin', value: '0.60' },
        { inputKey: 'annual_incremental_opex', value: '600000.00' },
        { inputKey: 'one_time_investment', value: '400000.00' },
      ],
    });
    f.links['gross_margin'] = null;
    f.values['gross_margin'] = '0.55';
    f.horizonYears = '4';
    f.opexScopeNote = 'Sales, admin and support';
    const body = saveBody(f, version);
    expect(body.drivers[0]).toEqual({ inputKey: 'gross_margin', value: '0.55', assumptionId: null });
    expect(body).toMatchObject({ horizonYears: 4, opexScopeNote: 'Sales, admin and support' });
    expect(body.currency).toBeUndefined();
  });

  it('lists the required drivers that are not entered', () => {
    expect(missingDrivers(econFormOf(version))).toEqual([
      'annual_price',
      'adoption_rate.base',
      'capacity',
      'reachable_pool',
    ]);
  });
});
