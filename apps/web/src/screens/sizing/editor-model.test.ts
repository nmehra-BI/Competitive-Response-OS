/** S06 editor model: what a save sends (D-112 §2). A blank is cleared, never sent as 0. */
import type { Assumption, SizingVersion } from '@growth-os/contracts';
import { describe, expect, it } from 'vitest';
import { blankForm, formFromVersion, missingRequired, overlapPatch, planPatch } from './editor-model';

const ASM_BASE = 'a57e0000-0000-4000-8000-0000000000a1';
const SRC = 'a57e0000-0000-4000-8000-0000000000s1';
const register = [{ id: ASM_BASE, current: { value: '0.20', unit: 'rate' } }] as unknown as Assumption[];

function version(over: Partial<SizingVersion> = {}): SizingVersion {
  return {
    id: 'v',
    caseId: 'c',
    version: 1,
    state: 'draft',
    method: 'aggregate_overlap',
    horizonYears: 3,
    boundary: {
      id: 'b',
      marketUnit: 'annual spend on water monitoring',
      populationUnit: 'site',
      countryCode: 'DE',
      segmentLabel: 'food processing',
      productBoundary: 'Monitoring service',
      currency: 'EUR',
      priceYear: 2026,
      includes: { hardware: false, software: true, services: true, replacementCycles: false },
      annualizationMethod: null,
    },
    dedupRuleText: 'Unique by site ID',
    ledger: [
      {
        inputKey: 'tam_site_count',
        name: 'TAM site count',
        value: '5000',
        unit: 'sites',
        currency: null,
        kind: 'evidence',
        basis: {
          source: { sourceId: SRC, key: 'SRC-014', label: 'Census', quality: 'strong', restricted: false },
          owner: null,
          text: null,
        },
        evidenceQuality: 'strong',
        assumptionId: null,
        version: 1,
        lastChangedAt: '2026-10-10T10:00:00Z',
        usedByCount: 1,
        disputed: false,
        changedInDraft: false,
      },
    ],
    cohorts: [
      { id: 'k1', name: 'Size', qualifier: null, rule: 'r', siteCount: 1400, source: null, status: 'active' },
    ],
    overlaps: [],
    crossCheck: null,
    result: null,
    rowVersion: 4,
    committedAt: null,
    committedBy: null,
    createdAt: '2026-10-10T10:00:00Z',
    ...over,
  };
}

describe('S06 editor model', () => {
  it('the first save needs the market boundary', () => {
    const f = blankForm();
    expect(() => planPatch(f, { form: blankForm(), version: null }, register)).toThrow(
      /market boundary first/,
    );
    const ok = {
      ...f,
      marketUnit: 'annual spend',
      priceYear: '2026',
      productBoundary: 'Sensors',
      includes: { ...f.includes, hardware: true },
    };
    const plan = planPatch(ok, { form: blankForm(), version: null }, register);
    expect(plan.patch!.boundary).toMatchObject({
      marketUnit: 'annual spend',
      currency: 'EUR',
      priceYear: 2026,
      productBoundary: 'Sensors',
      includes: { hardware: true, software: false },
    });
  });

  it('a blank input that exists is cleared (clearInputKeys), never sent as 0', () => {
    const v = version();
    const server = { form: formFromVersion(v), version: v };
    const f = formFromVersion(v);
    f.inputs.tam_site_count = { ...f.inputs.tam_site_count, text: '' };
    const plan = planPatch(f, server, register);
    expect(plan.patch).toEqual({ clearInputKeys: ['tam_site_count'] });
    expect(JSON.stringify(plan.patch)).not.toContain('"value":"0"');
  });

  it('an assumption link sends the register value; a value without a basis waits', () => {
    const v = version();
    const server = { form: formFromVersion(v), version: v };
    const f = formFromVersion(v);
    f.inputs['adoption_rate.base'] = { basis: `asm:${ASM_BASE}`, text: '', basisText: '' };
    f.inputs.capacity = { basis: '', text: '120', basisText: '' };
    f.inputs.reachable_pool = { basis: `src:${SRC}`, text: '500', basisText: 'Partner channel' };
    const plan = planPatch(f, server, register);
    expect(plan.patch!.inputs).toEqual([
      {
        inputKey: 'reachable_pool',
        value: '500',
        unit: 'sites',
        sourceId: SRC,
        assumptionId: null,
        basisText: 'Partner channel',
      },
      {
        inputKey: 'adoption_rate.base',
        value: '0.20',
        unit: 'rate',
        sourceId: null,
        assumptionId: ASM_BASE,
      },
    ]);
    expect(plan.pending).toEqual([{ key: 'capacity', message: 'Choose the evidence or an assumption.' }]);
  });

  it('new cohorts go without ids; the overlap follows once they have ids', () => {
    const v = version();
    const server = { form: formFromVersion(v), version: v };
    const f = formFromVersion(v);
    f.cohorts = [...f.cohorts, { id: null, name: 'Process', rule: 'p', siteCount: '1100', sourceId: '' }];
    f.overlapCount = '500';
    f.overlapMethod = 'Dedup run v2';
    const plan = planPatch(f, server, register);
    expect(plan.patch!.cohorts!.map((c) => c.id)).toEqual(['k1', null]);
    expect(plan.overlapAfter).toBe(true);
    const after = version({
      cohorts: [
        ...v.cohorts,
        {
          id: 'k2',
          name: 'Process',
          qualifier: null,
          rule: 'p',
          siteCount: 1100,
          source: null,
          status: 'active',
        },
      ],
    });
    expect(overlapPatch(f, after)).toEqual({
      overlaps: [{ cohortAId: 'k1', cohortBId: 'k2', overlapCount: 500, method: 'Dedup run v2' }],
    });
  });

  it('lists the required inputs that are not entered', () => {
    expect(missingRequired(version()).map((s) => s.key)).toEqual([
      'annual_spend_per_site',
      'reachable_pool',
      'adoption_rate.base',
      'capacity',
    ]);
  });
});
