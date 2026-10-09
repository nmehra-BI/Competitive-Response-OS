// @vitest-environment jsdom
/** S12 Outcomes against the MSW mocks: acceptance steps 25–28. */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mockServer, resetMockState, resetReplay, session } from '../../mocks/node';
import { seedWs8d } from '../history/journey';
import { renderAt } from '../pilot/test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

const URL = '/me/cases/ME-104/outcomes';
const SCALE_REASON =
  'G3 preconditions unmet: demand threshold 3 of 4 (4 of 4 required); specialist scale-readiness review incomplete';

async function record(label: string, actual: string, source: string, value?: string, start?: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Record actual for ${label}` }));
  const d = await screen.findByRole('dialog');
  fireEvent.change(within(d).getByLabelText('Actual (required)'), { target: { value: actual } });
  if (value) fireEvent.change(within(d).getByLabelText(/^Value in/), { target: { value } });
  if (start)
    fireEvent.change(within(d).getByLabelText('Period start (required)'), { target: { value: start } });
  fireEvent.change(within(d).getByLabelText('Source (required)'), { target: { value: source } });
  fireEvent.click(within(d).getByRole('button', { name: 'Record actual' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('S12 Outcomes', () => {
  it('records actuals with period and source: Not met · Not met · Inconclusive (step 25)', async () => {
    session.signIn(people.jonas.id);
    renderAt(URL);
    expect(await screen.findByText('Review incomplete')).toBeTruthy();
    await record('Paid use and continuation', '3 of 4', 'billing records', '3');
    await record(
      'Deployment effort per site',
      'Above assumption · [actual hours per site]',
      'effort log (C2)',
    );
    await record('Buyer fit', 'Mixed', 'interview notes', undefined, '2027-02-01');
    const table = screen.getByRole('table', { name: 'Baseline versus actuals' });
    await waitFor(() => expect(within(table).getAllByText('Not met')).toHaveLength(2));
    expect(within(table).getByText('Inconclusive')).toBeTruthy();
    expect(within(table).getByText('Source: billing records')).toBeTruthy();
    const periods = Array.from(table.querySelectorAll('[data-kind="actual"]')).map((e) => e.textContent);
    expect(periods).toEqual(['Actual· 1 Dec–28 Feb', 'Actual· 1 Dec–28 Feb', 'Actual· 1 Feb–28 Feb']);
    // Negative results are neutral, never danger red.
    const notMet = within(table).getAllByText('Not met')[0]!.closest('[data-status]') as HTMLElement;
    expect(notMet.style.color).not.toContain('danger');
  });

  it('shows the recorded decision, recommendation as not a decision, and scale disabled (26–28)', async () => {
    seedWs8d({ outcomesMoment: 'decided' });
    session.signIn(people.maya.id);
    renderAt(URL);
    expect(
      await screen.findByRole('heading', { name: 'Decision recorded: Revise and extend validation' }),
    ).toBeTruthy();
    expect(screen.getByText('What we learned')).toBeTruthy();
    expect(screen.getByText(/NOT A DECISION/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Request scale approval' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(SCALE_REASON)).toBeTruthy();
    expect(screen.getByText('4 sites, no comparison group.')).toBeTruthy();

    // Chart has a table toggle.
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(
      screen.getByRole('table', { name: 'Pilot customers meeting the paid-use threshold' }),
    ).toBeTruthy();

    // Extension request with its own cap.
    fireEvent.click(screen.getByRole('button', { name: 'Request extension €[cap]' }));
    expect(screen.getByText('Placeholder · confirm with PM. The PRD sets no amount.')).toBeTruthy();
    const submit = screen.getByRole('button', {
      name: 'Submit extension request €[cap]',
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('€[cap]'), { target: { value: '25000' } });
    fireEvent.change(screen.getByPlaceholderText('[duration] days'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit extension request €25k' }));
    expect(await screen.findByText(/Extension €25k · Awaiting decision · Elena Fischer/)).toBeTruthy();
    expect(screen.getByText('ME-104-X1')).toBeTruthy();
  });

  it('the sponsor records the decision on the recommendation (step 27)', async () => {
    seedWs8d({ outcomesMoment: 'recommended' });
    session.signIn(people.elena.id);
    renderAt(URL);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Record decision: Revise and extend validation' }),
    );
    const d = await screen.findByRole('dialog');
    fireEvent.change(within(d).getByRole('textbox'), { target: { value: 'On Maya Rao’s recommendation.' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Record decision: Revise and extend validation' }));
    expect(
      await screen.findByRole('heading', { name: 'Decision recorded: Revise and extend validation' }),
    ).toBeTruthy();
    expect(screen.getByText(/ACCEPTED/)).toBeTruthy();
  });

  it('administrators cannot record the outcome decision', async () => {
    session.signIn(people.admin.id);
    renderAt(URL);
    await screen.findByText('Baseline versus actuals');
    expect(screen.queryByRole('button', { name: /Record decision/ })).toBeNull();
  });
});
