// @vitest-environment jsdom
/** S08 Economics against the MSW mocks (acceptance step 9, live recompute, frozen snapshot). */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { session } from '../../mocks/node';
import { setAssessmentScenario } from '../sizing/mock-state';
import { mockServer, renderAt, resetAll } from '../sizing/test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetAll();
  sessionStorage.clear();
});
afterAll(() => mockServer.close());

function rowCells(table: HTMLElement, header: string): string[] {
  const row = within(table)
    .getByRole('rowheader', { name: new RegExp(`^${header}`) })
    .closest('tr')!;
  return within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent ?? '');
}

describe('S08 Economics', () => {
  it('renders the PRD scenario table, separate money cards and unavailable cash flow (step 9)', async () => {
    session.signIn(people.daniel.id);
    renderAt('/me/cases/ME-104/economics');
    const table = await screen.findByRole('table', { name: 'Scenario table' });
    await waitFor(() => expect(rowCells(table, 'Annual revenue')).toEqual(['€1.0m', '€2.0m', '€2.4m']));
    expect(rowCells(table, 'Gross contribution')).toEqual(['€0.60m', '€1.20m', '€1.44m']);
    expect(rowCells(table, 'Annual incremental opex')).toEqual(['€600k', '€600k', '€600k']);
    expect(rowCells(table, 'Contribution after incremental opex')).toEqual([
      '€0k (break-even)',
      '€600k',
      '€840k',
    ]);
    expect(rowCells(table, 'Customers')).toEqual(['50', '100', '120 · capped at 120']);
    // ▼ ● ▲ markers in fixed order.
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads.slice(1)).toEqual(['▼ Downside', '● Base', '▲ Upside']);
    // Recurring and one-time money are never added.
    expect(screen.getByRole('separator', { name: 'Different time bases. Do not add.' })).toBeTruthy();
    expect(screen.getByText('€400k one-time')).toBeTruthy();
    const cash = screen.getByRole('group', { name: 'Cash flow' });
    expect(cash.textContent).toContain('Not available');
    expect(screen.getByRole('group', { name: 'Payback' }).textContent).toContain('Not available');
    for (const m of [
      'Acquisition ramp',
      'Retention',
      'Cash timing',
      'Partner margin',
      'FX and base year policy',
    ]) {
      expect(screen.getByText(m)).toBeTruthy();
    }
    // Downside is Daniel's 10% position.
    expect(
      within(table).getByText(/Adoption 10% \(50 of 500 sites\) · Daniel Weber’s position/),
    ).toBeTruthy();
  });

  it("Daniel disputes 20% adoption with a 10% proposal; the thread shows 'Disputed by Daniel Weber'", async () => {
    setAssessmentScenario({ adoptionDisputed: false });
    session.signIn(people.daniel.id);
    renderAt('/me/cases/ME-104/economics');
    fireEvent.click(await screen.findByRole('button', { name: 'Dispute' }));
    const form = screen.getByRole('form', { name: /^Dispute Adoption 20% by year 3/ });
    fireEvent.change(within(form).getByLabelText(/Why do you dispute this value/), {
      target: { value: 'I do not see comparable evidence for 20% adoption in this segment.' },
    });
    fireEvent.change(within(form).getByLabelText(/Proposed value/), {
      target: { value: 'Downside adoption 10%' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Record dispute' }));
    const thread = await screen.findByRole('region', { name: /^Dispute · Adoption 20% by year 3/ });
    expect(thread.textContent).toContain('Disputed by Daniel Weber');
    expect(thread.textContent).toContain('Downside adoption 10%');
    expect(screen.getByRole('link', { name: 'Disputed' })).toBeTruthy();
  });

  it('the owner cannot dispute her own assumption', async () => {
    setAssessmentScenario({ adoptionDisputed: false });
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/economics');
    await screen.findByRole('table', { name: 'Scenario table' });
    expect(screen.queryByRole('button', { name: 'Dispute' })).toBeNull();
  });

  it('recomputes the draft live and never changes snapshot v2', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/economics');
    const input = (await screen.findByLabelText('Adoption by year 3 · Base')) as HTMLInputElement;
    expect(input.value).toBe('20');
    fireEvent.change(input, { target: { value: '22' } });
    const table = screen.getByRole('table', { name: 'Scenario table' });
    await waitFor(() => expect(rowCells(table, 'Annual revenue')[1]).toContain('€2.2m'));
    expect(rowCells(table, 'Annual revenue')[1]).toContain('Recalculated');
    expect(screen.getByText('Draft · 1 driver differ from snapshot v2')).toBeTruthy();
    fireEvent.blur(input);
    // The server draft agrees with the local engine run.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create snapshot v3' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot v2' }));
    const snap = await screen.findByRole('table', { name: 'Scenario table' });
    await waitFor(() => expect(rowCells(snap, 'Annual revenue')).toEqual(['€1.0m', '€2.0m', '€2.4m']));
    expect(screen.getByText(/Snapshot v2 · committed .* read-only/)).toBeTruthy();
  });

  it('shows Recommendation incomplete when the one-time investment is invalid', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/economics');
    const margin = (await screen.findByLabelText('Gross margin')) as HTMLInputElement;
    fireEvent.change(margin, { target: { value: '160' } });
    expect(await screen.findByText('Recommendation incomplete')).toBeTruthy();
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
  });
});
