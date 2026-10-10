// @vitest-environment jsdom
/** S09 "Add assumption" (D-112 §1) against the MSW mocks: Evidence with sources, or no evidence. */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/providers';
import { buildRoutes } from '../../app/router';
import { createQueryClient } from '../../lib/query';
import { mockServer, resetMockState, resetReplay, session } from '../../mocks/node';

configure({ asyncUtilTimeout: 5000 });
beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
  sessionStorage.clear();
});
afterAll(() => mockServer.close());

function renderAt(url: string) {
  const router = createMemoryRouter(buildRoutes(), { initialEntries: [url] });
  render(
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

describe('S09 add assumption', () => {
  it('the case owner adds an assumption linked to a source (Evidence)', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-102/validation');
    fireEvent.click(await screen.findByRole('button', { name: 'Add assumption' }));
    const form = await screen.findByRole('form', { name: 'Add assumption' });
    const submit = () => within(form).getByRole('button', { name: 'Add assumption' }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText(/^Statement/), {
      target: { value: 'Channel reaches 300 Austrian breweries' },
    });
    fireEvent.change(within(form).getByLabelText('Model input'), { target: { value: 'reachable_pool' } });
    fireEvent.change(within(form).getByLabelText(/^Value/), { target: { value: '300' } });
    fireEvent.click(within(form).getByLabelText('Evidence · link sources'));
    const box = await within(form).findByRole('checkbox', { name: /SRC-014/ });
    fireEvent.click(box);
    fireEvent.click(within(form).getByLabelText('High'));
    fireEvent.change(within(form).getByLabelText(/^Validation method/), {
      target: { value: 'Partner list verification' },
    });
    await waitFor(() => expect(submit().disabled).toBe(false));
    fireEvent.click(submit());
    expect(await screen.findByText('ASM-21 added to the register.')).toBeTruthy();
  }, 20_000);

  it('a percentage above 100 is refused in the form (never sent)', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-102/validation');
    fireEvent.click(await screen.findByRole('button', { name: 'Add assumption' }));
    const form = await screen.findByRole('form', { name: 'Add assumption' });
    fireEvent.change(within(form).getByLabelText('Model input'), { target: { value: 'adoption_rate.base' } });
    fireEvent.change(within(form).getByLabelText(/^Value/), { target: { value: '120' } });
    expect(within(form).getByText('Enter a percentage between 0 and 100, such as 20.')).toBeTruthy();
  });

  it('only the case owner sees the form', async () => {
    session.signIn(people.daniel.id);
    renderAt('/me/cases/ME-104/validation');
    await screen.findByRole('table', { name: 'Assumption register' });
    expect(screen.queryByRole('button', { name: 'Add assumption' })).toBeNull();
  });
});
