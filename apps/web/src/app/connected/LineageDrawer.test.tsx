// @vitest-environment jsdom
/**
 * Connected lineage drawer: the formula reads "SAM = (…)" once (the engine's formula text already names
 * its left-hand side), and a reachable pool checked against SAM reads as an upper-bound check (D-117).
 */
import { people } from '@growth-os/fixtures-aster';
import type { LineageNode } from '@growth-os/contracts';
import { API } from '@growth-os/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createQueryClient } from '../../lib/query';
import { mock } from '../../mocks/define';
import { mockServer, resetMockState, session } from '../../mocks/node';
import { AppProviders } from '../providers';
import { formulaExpression, LineageDrawer, usedByLabel } from './LineageDrawer';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
  resetMockState();
});
afterAll(() => mockServer.close());

const sam: LineageNode = {
  nodeKey: 'sizing.sam.value',
  label: 'SAM',
  kind: 'calculated',
  value: '40000000.00',
  unit: 'currency_per_year',
  formulaText: 'SAM = (Size-qualified + Process-qualified − Overlap) × Annual spend per site',
  formulaWithValues: '(1,400 + 1,100 − 500) × €20,000 = €40,000,000/year',
  inputs: [],
  dependsOnAssumptionCount: 1,
  ref: null,
};

describe('LineageDrawer', () => {
  it('drops the left-hand side the engine already wrote, and only a plain leading name', () => {
    expect(formulaExpression(sam.formulaText)).toBe(
      '(Size-qualified + Process-qualified − Overlap) × Annual spend per site',
    );
    expect(formulaExpression('SAM sites = A + B − Overlap')).toBe('A + B − Overlap');
    expect(formulaExpression('(a + b) × c')).toBe('(a + b) × c');
    expect(formulaExpression(null)).toBeNull();
  });

  it('names an upper-bound check in "Used by"; a calculation user keeps its label', () => {
    expect(
      usedByLabel({
        label: 'Reachable pool',
        relation: 'checked_against',
        detail: 'upper-bound check: 500 ≤ 2,000 sites',
      }),
    ).toBe('Reachable pool (upper-bound check: 500 ≤ 2,000 sites)');
    expect(usedByLabel({ label: 'SOM · Base', relation: 'input_to', detail: null })).toBe('SOM · Base');
  });

  it('renders "SAM = …" once and the upper-bound check in Used by (ME-104 Sizing, SAM)', async () => {
    session.signIn(people.maya.id);
    mockServer.use(
      mock(API.lineage.get, () => ({
        node: sam,
        inputs: [],
        usedBy: [
          {
            label: 'Reachable pool',
            href: '/me/cases/ME-104/sizing?node=sizing.reachable_pool',
            relation: 'checked_against' as const,
            detail: 'upper-bound check: 500 ≤ 2,000 sites',
          },
        ],
        history: [],
        exactValue: '€40,000,000/year',
        engineLabel: 'Calculated by sizing engine v1.0.0 · reproducible',
      })),
    );
    render(
      <MemoryRouter>
        <AppProviders client={createQueryClient()}>
          <LineageDrawer
            caseRef="ME-104"
            model="sizing"
            nodeKey="sizing.sam.value"
            version={2}
            onClose={() => {}}
          />
        </AppProviders>
      </MemoryRouter>,
    );
    const formula = await screen.findByRole('group', { name: 'Formula for SAM' });
    expect(formula.textContent).not.toContain('SAM = SAM');
    expect(formula.textContent?.match(/SAM =/g)).toHaveLength(1);
    expect(formula.textContent).toContain('SAM = (Size-qualified + Process-qualified − Overlap)');
    const usedBy = screen.getByRole('heading', { name: 'Used by' }).closest('section')!;
    expect(
      within(usedBy).getByRole('link', { name: 'Reachable pool (upper-bound check: 500 ≤ 2,000 sites)' }),
    ).toBeTruthy();
  });
});
