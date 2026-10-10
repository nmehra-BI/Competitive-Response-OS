// @vitest-environment jsdom
/**
 * S14 › Connections › Jira row › "Task mapping" (D-114 §1) against the MSW mocks: tabs per purpose,
 * the assignee table with Mapped / Unmapped / Not found, "Check with Jira", an assignee-only save
 * without a dialog, and a destination change that shows the material impact before saving.
 */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mockServer, resetMockState, resetReplay, session } from '../../mocks/node';
import { renderAt } from '../pilot/test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

async function openPilotMapping() {
  session.signIn(people.admin.id);
  renderAt('/admin/connections');
  const section = (await screen.findByRole('heading', { name: 'Task mapping' })).closest('section')!;
  fireEvent.click(await within(section).findByRole('button', { name: /^Task mapping · Jira/ }));
  fireEvent.click(within(section).getByRole('tab', { name: 'Pilot tasks' }));
  const table = await within(section).findByRole('table', { name: 'Assignees · Pilot tasks' });
  return { section, table };
}

describe('S14 task mapping editor', () => {
  it('lists people with Unmapped, then Check with Jira reads Mapped and Not found', async () => {
    const { section, table } = await openPilotMapping();
    expect(within(section).getByRole('tab', { name: 'Validation tasks' })).toBeTruthy();
    expect(within(table).getAllByText('Unmapped').length).toBe(3);
    fireEvent.change(within(table).getByLabelText('Jira account for Jonas Klein'), {
      target: { value: people.jonas.email },
    });
    fireEvent.change(within(table).getByLabelText(`Jira account for ${people.opsLead.displayName}`), {
      target: { value: people.opsLead.email },
    });
    fireEvent.click(within(section).getByRole('button', { name: 'Check with Jira' }));
    await waitFor(() => expect(within(table).getByText('Not found')).toBeTruthy());
    expect(within(table).getByText('Mapped')).toBeTruthy();
    expect(
      within(table).getByText(`assignee ${people.opsLead.email} is not a member of project PIL`),
    ).toBeTruthy();
    // Assignee edits are not material: saved without a dialog.
    fireEvent.click(within(section).getByRole('button', { name: 'Save mapping' }));
    expect(await within(section).findByText('Saved: PIL · Task.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a project change shows the impact before saving, and saves only on confirmation', async () => {
    const { section } = await openPilotMapping();
    fireEvent.change(within(section).getByLabelText('Destination project'), { target: { value: 'PIL2' } });
    expect(within(section).getByText(/is a material change/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Save mapping' }));
    const dialog = await screen.findByRole('dialog', { name: 'Material change' });
    const impact = within(dialog).getByRole('list', { name: 'Impact' });
    expect(impact.textContent).toContain('Approval G2 · Snapshot v3 needs re-approval');
    expect(impact.textContent).toContain('6 unsent tasks pause');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and pause unsent tasks' }));
    expect(await within(section).findByText('Saved: PIL2 · Task.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
