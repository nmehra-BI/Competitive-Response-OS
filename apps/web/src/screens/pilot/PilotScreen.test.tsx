// @vitest-environment jsdom
/** S11 Pilot screen against the MSW mocks: acceptance steps 21–24 and the variants. */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mockServer, resetMockState, resetReplay, session } from '../../mocks/node';
import { seedWs8d } from '../history/journey';
import { renderAt } from './test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

const URL = '/me/cases/ME-104/pilot';
const button = (name: string | RegExp) => screen.findByRole('button', { name });

describe('S11 Pilot', () => {
  it('pins the baseline, shows the budget and blocks activation by owner, then C1 (step 21–22)', async () => {
    session.signIn(people.jonas.id);
    renderAt(URL);
    expect(await screen.findByRole('heading', { name: 'Approved baseline · pinned' })).toBeTruthy();
    expect(screen.getByText('G2 · Approved with conditions · 27 Nov')).toBeTruthy();
    const budget = screen.getByRole('img', {
      name: /Approved €120k, committed €0k, spent €0k, remaining €120k/,
    });
    expect(budget).toBeTruthy();
    expect(screen.getByText('Missing owner blocks activation')).toBeTruthy();
    const activate = screen.getByRole('button', { name: 'Activate approved plan' }) as HTMLButtonElement;
    expect(activate.disabled).toBe(true);
    expect(screen.getAllByText(/has no accountable owner/).length).toBeGreaterThan(0);
    expect(screen.getByText('Draft — not authorized to send')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    // Assign the missing owner.
    fireEvent.click(await button('Assign owner to Install monitoring at 4 sites'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('option', { name: /Jonas Klein/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save owner' }));
    expect(await screen.findByText('Open condition C1 blocks activation')).toBeTruthy();

    // Mark C1 met with evidence.
    fireEvent.click(await button('Mark C1 met'));
    const d2 = await screen.findByRole('dialog');
    fireEvent.change(within(d2).getByRole('textbox'), { target: { value: 'Signed site list: 4 sites' } });
    fireEvent.click(within(d2).getByRole('button', { name: 'Mark C1 met' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Activate approved plan' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Activate approved plan' }));
    const d3 = await screen.findByRole('dialog', { name: 'Activate approved plan?' });
    fireEvent.click(within(d3).getByRole('button', { name: 'Activate approved plan' }));

    // Preview (dry run) → create → partial → retry the failed task only.
    fireEvent.click(await button('Preview tasks'));
    expect(await screen.findByRole('heading', { name: 'Preview · nothing has been sent' })).toBeTruthy();
    expect(screen.getByText('PIL')).toBeTruthy();
    expect(screen.getByText(/Create and assign issues · as Jonas Klein/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create 6 tasks in Jira' }));
    expect(await screen.findByText('5 of 6 tasks confirmed in Jira · 1 failed (permission)')).toBeTruthy();
    expect(screen.queryByText(/synced/i)).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry 1 failed task' })[0]!);
    expect(await screen.findByText('6 of 6 tasks confirmed in Jira')).toBeTruthy();
    expect(screen.getAllByText('PIL-12').length).toBe(1);
  });

  it('timeout after success: Checking, then Confirmed after reconcile (step 24)', async () => {
    seedWs8d({ pilotVariant: 'timeout' });
    session.signIn(people.jonas.id);
    renderAt(URL);
    fireEvent.click(await button('Preview tasks'));
    fireEvent.click(await button('Create 6 tasks in Jira'));
    expect(await screen.findByText('5 of 6 tasks confirmed in Jira · 1 checking')).toBeTruthy();
    expect(screen.getAllByText('Checking').length).toBeGreaterThan(0);
    expect(await screen.findByText('6 of 6 tasks confirmed in Jira', {}, { timeout: 6000 })).toBeTruthy();
    expect(screen.getByText('PIL-14')).toBeTruthy();
  }, 10_000);

  it('expired connector offers CSV export; internal tasks continue', async () => {
    seedWs8d({ pilotVariant: 'expired' });
    session.signIn(people.jonas.id);
    renderAt(URL);
    expect(await screen.findByText('Jira connection expired · 30 Nov')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Export CSV instead' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Preview tasks' })).toBeNull();
    expect(screen.getAllByText('connection expired').length).toBe(6);
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  it('approval invalidated: unsent tasks paused, sent tasks kept', async () => {
    seedWs8d({ pilotVariant: 'invalidated' });
    session.signIn(people.jonas.id);
    renderAt(URL);
    expect(await screen.findByText('Approval changed · sending paused')).toBeTruthy();
    expect(screen.getByText('PIL-11')).toBeTruthy();
    expect(screen.getByText('PIL-13')).toBeTruthy();
    expect(screen.getAllByText('Paused — approval changed')).toHaveLength(4);
  });

  it('other people see the plan but cannot activate it', async () => {
    session.signIn(people.maya.id);
    renderAt(URL);
    expect(await screen.findByText('Only the pilot owner can do this.')).toBeTruthy();
  });
});
