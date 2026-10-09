// @vitest-environment jsdom
/** S09 Validation against the MSW mocks: register, dispute, EXP-03 card, amendments, results, tasks. */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/providers';
import { buildRoutes } from '../../app/router';
import { createQueryClient } from '../../lib/query';
import { mockServer, resetMockState, resetReplay, session, setScenario } from '../../mocks/node';
import type { Ws8cPreset } from '../decisions/mock-state';

// Lazy screens load on first render; allow for a slow, parallel run.
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
  sessionStorage.clear();
});
afterAll(() => mockServer.close());

const preset = (p: Ws8cPreset) => setScenario({ ws8cPreset: p } as never);

function renderAt(url: string) {
  const router = createMemoryRouter(buildRoutes(), { initialEntries: [url] });
  render(
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

const card = async () => {
  await screen.findByRole('heading', { name: 'Validation outreach · 20 sites' });
  return document.querySelector('[data-experiment="EXP-03"]') as HTMLElement;
};

describe('S09 Validation', () => {
  it('shows the register grouped and sorted, with the disputed 20% adoption and Daniel’s words', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/validation');
    const table = await screen.findByRole('table', { name: 'Assumption register' });
    const groups = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
      .filter((t) => /^(Test first|Test next|Watch|Monitor)/.test(t ?? ''));
    expect(groups.map((g) => g!.split(/(?=[A-Z][a-z]+ sensitivity|Evidence exists)/)[0])).toEqual([
      'Test first',
      'Test next',
      'Watch',
      'Monitor',
    ]);
    const rows = [...table.querySelectorAll('tr[data-assumption]')].map((r) =>
      r.getAttribute('data-assumption'),
    );
    expect(rows.slice(0, 2)).toEqual(['ASM-06', 'ASM-01']);
    const dispute = screen.getByRole('region', { name: /Dispute · Adoption 20% by year 3/ });
    expect(dispute.textContent).toContain(
      'I do not see comparable evidence for 20% adoption in this segment.',
    );
    expect(dispute.textContent).toContain('Proposes Downside adoption 10%');
    expect(dispute.textContent).toContain('Only Daniel Weber or the sponsor can resolve this dispute.');
    expect(within(table).getByRole('button', { name: /^Disputed by Daniel Weber/ })).toBeTruthy();
  });

  it('EXP-03: thresholds locked at G1, Amendment 1 with the original struck through, Met · 9 of 8', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/validation?experiment=EXP-03');
    const c = await card();
    expect(c.textContent).toContain('Plan locked at G1 · 16 Oct');
    expect(c.textContent).toContain('€15k · approved at G1 (validation only)');
    expect(c.querySelector('del')?.textContent).toBe('19 Oct – 13 Nov');
    expect(c.textContent).toContain('Original (pre-registered)');
    expect(c.textContent).toContain('Amendment 1');
    expect(c.textContent).toContain('Met · 9 of 8');
    expect(c.textContent).toContain('Met · 4 of 4');
    expect(c.textContent).toContain('20 selected sites are not a random sample.');
    expect(c.textContent).toContain('Prepare G2 pilot request · Maya Rao · 20 Nov');
    expect(await screen.findByText('5 of 5 tasks confirmed in Jira')).toBeTruthy();
    expect(screen.getAllByText(/VAL-\d/).length).toBe(5);
  });

  it('at G1 approval: "Too early to read", amend the window, then record results that meet thresholds', async () => {
    preset('g1_approved');
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/validation');
    const c = await card();
    expect(c.textContent).toContain('Too early to read · window closes 13 Nov');
    fireEvent.click(within(c).getByRole('button', { name: 'Amend plan' }));
    fireEvent.change(within(c).getByLabelText(/New window end/), { target: { value: '2026-11-20' } });
    fireEvent.change(within(c).getByLabelText(/Reason/), { target: { value: 'Two sites rescheduled.' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Save amendment' }));
    await waitFor(() => expect(c.querySelector('del')?.textContent).toBe('19 Oct – 13 Nov'));
    expect(c.textContent).toContain('Amendment 1');

    fireEvent.click(within(c).getByRole('button', { name: 'Record results' }));
    fireEvent.change(within(c).getByLabelText(/Completed discovery interviews · observed/), {
      target: { value: '9' },
    });
    fireEvent.change(within(c).getByLabelText(/Paid pilot commitments · observed/), {
      target: { value: '3' },
    });
    fireEvent.change(within(c).getByLabelText(/^Source/), { target: { value: 'partner log' } });
    fireEvent.change(within(c).getByLabelText(/Interpretation/), { target: { value: 'Mixed.' } });
    fireEvent.change(within(c).getByLabelText(/Limitations/), { target: { value: 'Not a random sample.' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Record results' }));
    await waitFor(() => expect(c.textContent).toContain('Met · 9 of 8'));
    // A failed threshold is shown as such, never hidden.
    expect(c.textContent).toContain('Not met · 3 of 4');
  });

  it('validation tasks: preview writes nothing; create shows Sending… then Confirmed with keys', async () => {
    preset('g1_approved');
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/validation');
    fireEvent.click(await screen.findByRole('button', { name: 'Preview tasks' }));
    expect(await screen.findByText('Preview · nothing sent yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create 5 tasks in Jira' }));
    expect(await screen.findByText('5 of 5 tasks confirmed in Jira', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/VAL-1/)).toBeTruthy();
  });

  it('before EXP-03: Maya creates the experiment and submits G1 (snapshot v1 fingerprint)', async () => {
    preset('start');
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/validation');
    expect(await screen.findByText('No validation experiment yet')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Illustrative example experiment' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create experiment' }));
    const form = screen.getByRole('form', { name: 'New validation experiment' });
    const set = (label: RegExp | string, value: string) =>
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    set(/^Title/, 'Validation outreach · 20 sites');
    set(/^Hypothesis/, 'At least 4 of 20 sites sign.');
    set(/^Method/, 'Partner-led outreach');
    set(/^Sample \(required\)/, '20 sites');
    set(/^Sample size/, '20');
    set(/^Window start/, '2026-10-19');
    set(/^Window end/, '2026-11-13');
    set(/^Budget/, '15000');
    set(/^Metric 1$/, 'Completed discovery interviews');
    set(/^Metric 1 threshold/, '8');
    set(/^Metric 2$/, 'Paid pilot commitments');
    set(/^Metric 2 threshold/, '4');
    fireEvent.click(within(form).getByRole('checkbox', { name: /Adoption 20% by year 3/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Create experiment' }));
    const submit = await screen.findByRole('button', { name: 'Submit G1 · Approve validation €15k' });
    fireEvent.click(submit);
    expect(await screen.findByText('2B71·0E4D')).toBeTruthy();
    expect(screen.getByText(/Snapshot v1/)).toBeTruthy();
  });

  it('the dispute can only be resolved by the disputing reviewer or the sponsor', async () => {
    session.signIn(people.daniel.id);
    renderAt('/me/cases/ME-104/validation?assumption=ASM-01');
    const region = await screen.findByRole('region', { name: /Dispute · Adoption 20%/ });
    fireEvent.click(within(region).getByRole('button', { name: 'Resolve with reason' }));
    fireEvent.change(within(region).getByLabelText(/Reason for resolving/), {
      target: { value: 'Pilot will test it; Downside kept.' },
    });
    fireEvent.click(within(region).getByRole('button', { name: 'Resolve dispute' }));
    expect(await within(region).findByText(/Resolved by Daniel Weber/)).toBeTruthy();
  });
});
