// @vitest-environment jsdom
/** Shell, case layout and the connected approval panel against the MSW fixture mocks. */
import { gates, people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createQueryClient } from '../lib/query';
import { G2_HASH, G2_SNAPSHOT_ID } from '../mocks/data';
import { mockServer, resetMockState, resetReplay, session } from '../mocks/node';
import { ApprovalPanel } from './connected/ApprovalPanel';
import { AppProviders } from './providers';
import { buildRoutes } from './router';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

function renderAt(url: string) {
  const router = createMemoryRouter(buildRoutes(), { initialEntries: [url] });
  render(
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('AppShell and CaseLayout', () => {
  it('redirects to the persona picker without a session, keeping the deep link', async () => {
    const router = renderAt('/me/cases/ME-104/sizing?input=adoption-rate');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toContain(
      encodeURIComponent('/me/cases/ME-104/sizing?input=adoption-rate'),
    );
    expect(await screen.findByRole('button', { name: /^Elena Fischer/ })).toBeTruthy();
  });

  it('renders the shell, ribbon, app switcher and case header with nine tabs', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/decisions');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'German food-processing plants — monitoring' }),
    ).toBeTruthy();
    expect(screen.getByRole('note', { name: 'Illustrative data notice' }).textContent).toContain(
      'Illustrative data — synthetic',
    );
    expect(screen.getByText('Not enabled in this workspace')).toBeTruthy();
    const tabs = within(screen.getByRole('navigation', { name: 'Case sections' })).getAllByRole('link');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Thesis',
      'Sizing',
      'Feasibility',
      'Economics',
      'Validation, 1 disputed',
      'Decisions',
      'Pilot',
      'Outcomes',
      'History',
    ]);
    expect(tabs[5]!.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Cases' }).getAttribute('aria-current')).toBe('page');
    // Administration is hidden (not disabled) for non-admins.
    expect(screen.queryByRole('link', { name: 'Administration' })).toBeNull();
  });

  it('unknown cases show a generic not-found message', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-999/thesis');
    expect(await screen.findByText('This page could not be found.')).toBeTruthy();
  });
});

describe('connected ApprovalPanel', () => {
  const props = { gateRequestId: gates.g2.id, snapshotId: G2_SNAPSHOT_ID, snapshotHash: G2_HASH };
  const mount = () => {
    const router = createMemoryRouter([{ path: '/', element: <ApprovalPanel {...props} /> }]);
    render(
      <AppProviders client={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
  };

  it('tells the author why they cannot approve', async () => {
    session.signIn(people.maya.id);
    mount();
    expect(await screen.findByText('You authored this package and cannot approve it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve pilot/ })).toBeNull();
  });

  it('records the sponsor decision bound to the snapshot and shows the result', async () => {
    session.signIn(people.elena.id);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve pilot €120k · 90 days' }));
    fireEvent.change(screen.getByLabelText(/Rationale/), { target: { value: 'Thresholds met' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve pilot €120k · 90 days' }));
    expect(await screen.findByText(/Approved for v3 only/)).toBeTruthy();
    expect(document.querySelector('[data-status="approved"]')).not.toBeNull();
  });

  it('disables approval when the page read a different snapshot', async () => {
    session.signIn(people.elena.id);
    const router = createMemoryRouter([
      { path: '/', element: <ApprovalPanel {...props} snapshotHash={'0'.repeat(64)} /> },
    ]);
    render(
      <AppProviders client={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(await screen.findByText(/The package changed since you opened it/)).toBeTruthy();
  });
});
