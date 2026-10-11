// @vitest-environment jsdom
/**
 * S11 Wave 4 against the MSW mocks: "Record spend" with a reversal and the scope-change refusal
 * (D-114 §2), stop-rule trips that only ask the sponsor (D-127), and the plan editor (D-112 §5).
 */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mockServer, resetMockState, resetReplay, session } from '../../mocks/node';
import { renderAt } from './test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

const URL = '/me/cases/ME-104/pilot';
const meter = (name: RegExp) => screen.findByRole('img', { name });

async function recordSpend(amount: string, description: string, reference = '') {
  fireEvent.click(await screen.findByRole('button', { name: 'Record spend' }));
  const form = await screen.findByRole('form', { name: 'Record spend' });
  fireEvent.change(within(form).getByLabelText(/^Amount/), { target: { value: amount } });
  fireEvent.change(within(form).getByLabelText(/^Description/), { target: { value: description } });
  if (reference)
    fireEvent.change(within(form).getByLabelText(/^Reference/), { target: { value: reference } });
  fireEvent.click(within(form).getByRole('button', { name: 'Record spent' }));
  return form;
}

describe('S11 Wave 4', () => {
  it('records €8k spent with a PO number, reverses it with a reason (meter back to €0k), refuses €130k with "Request scope change"', async () => {
    session.signIn(people.jonas.id);
    renderAt(URL);
    await recordSpend('8000', 'Sensor kits for 4 sites', 'PO-4471');
    expect(await meter(/spent €8k, remaining €112k/)).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Spend entries' });
    expect(within(table).getByText('PO-4471')).toBeTruthy();

    fireEvent.click(within(table).getByRole('button', { name: /^Reverse spent €8,000/ }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reverse entry' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // a reason is required
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Invoice booked twice' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reverse entry' }));
    expect(await meter(/spent €0k, remaining €120k/)).toBeTruthy();
    expect(await screen.findByText(/Invoice booked twice/)).toBeTruthy();
    expect(screen.getAllByText('Reversed').length).toBe(1);

    const form = await recordSpend('130000', 'Extra sites');
    expect(
      await within(form).findByText('This would exceed the approved €120k. Request a scope change.'),
    ).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Request scope change' }));
    expect(await screen.findByRole('dialog', { name: 'Request scope change' })).toBeTruthy();
  });

  it('lists SR1–SR3; reporting SR2 asks the sponsor and changes nothing else', async () => {
    session.signIn(people.jonas.id);
    renderAt(URL);
    const section = await screen.findByRole('region', { name: 'Stop rules · pre-registered' });
    expect(within(section).getAllByText('Not tripped')).toHaveLength(3);
    fireEvent.click(within(section).getByRole('button', { name: 'Report trip · SR2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Report trip · SR2' });
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'Hygiene condition breached at site 3' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Report trip and request sponsor review' }));
    expect(await within(section).findByText('Tripped · sponsor review requested')).toBeTruthy();
    expect(screen.getByText(/SR2 tripped · sponsor review requested. Nothing else changed./)).toBeTruthy();
    // Activation is still blocked exactly as before (task owner, C1): the trip moved nothing.
    expect(
      (screen.getByRole('button', { name: 'Activate approved plan' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('a finance reviewer sees spend and stop rules but cannot record or report', async () => {
    session.signIn(people.daniel.id);
    renderAt(URL);
    const section = await screen.findByRole('region', { name: 'Stop rules · pre-registered' });
    expect(
      (within(section).getByRole('button', { name: 'Report trip · SR1' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Record spend' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Edit plan' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('edits the plan draft: a milestone date with the evidence expected and a one-time task budget line', async () => {
    session.signIn(people.jonas.id);
    renderAt(URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit plan' }));
    const form = await screen.findByRole('form', { name: /Edit plan draft v1/ });
    fireEvent.change(within(form).getByLabelText('Milestone 2 date'), { target: { value: '2027-01-15' } });
    fireEvent.change(within(form).getByLabelText('Milestone 2 evidence expected'), {
      target: { value: 'Paid-use log' },
    });
    fireEvent.change(within(form).getByLabelText(/^Task 2 budget line/), { target: { value: '8000' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save plan draft' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: /Edit plan draft/ })).toBeNull());
    const list = screen.getByRole('list', { name: 'Milestones' });
    expect(within(list).getByText(/15 Jan 2027 · Evidence expected: Paid-use log/)).toBeTruthy();
    expect(screen.getByText('€8k one-time')).toBeTruthy();
  });
});
