// @vitest-environment jsdom
/**
 * First-run onboarding in the real shell against the MSW mocks: the first-login welcome, the tour (play, skip,
 * reduced motion), the role checklist with the state-driven Next card, coach-mark focus and Escape, ⌘K
 * "Guide", replay from the account menu and the demo reset.
 */
import { people } from '@growth-os/fixtures-aster';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../app/providers';
import { buildRoutes } from '../app/router';
import { createQueryClient } from '../lib/query';
import { mockServer, resetMockState, resetReplay, session } from '../mocks/node';
import { ExplainerPlayer } from './explainer/ExplainerPlayer';
import { resetOnboardingMocks } from './mocks';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => localStorage.removeItem('gos.onboarding.autostart')); // a real first-time browser
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
  resetOnboardingMocks();
  localStorage.setItem('gos.onboarding.autostart', 'off');
});
afterAll(() => mockServer.close());

function renderAt(url: string) {
  const router = createMemoryRouter(buildRoutes(), { initialEntries: [url] });
  const client = createQueryClient();
  render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

const welcome = () => screen.findByRole('dialog', { name: /Welcome to Market Expansion/ });

describe('first login', () => {
  it('shows the welcome once, focused on "Play the 90-second tour"; Escape skips and it never returns', async () => {
    session.signIn(people.elena.id);
    renderAt('/reviews?tab=awaiting');
    const dialog = await welcome();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByText('Welcome to Market Expansion, Elena')).toBeTruthy();
    expect(within(dialog).getByText(/Nothing is approved until you decide/)).toBeTruthy();
    expect(within(dialog).getByText(/Illustrative data/)).toBeTruthy();
    const play = within(dialog).getByRole('button', { name: 'Play the 90-second tour' });
    await waitFor(() => expect(document.activeElement).toBe(play));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Welcome/ })).toBeNull());
    cleanup();
    // Second sign-in (new page load, same server state): no welcome.
    renderAt('/reviews?tab=awaiting');
    expect(await screen.findByRole('button', { name: /^Guide/ })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('dialog', { name: /Welcome/ })).toBeNull();
  });

  it('does not open by itself when this browser opted out (automation), but the guide still works', async () => {
    localStorage.setItem('gos.onboarding.autostart', 'off');
    session.signIn(people.maya.id);
    renderAt('/me/overview?view=operator');
    const guide = await screen.findByRole('button', { name: /^Guide/ });
    expect(screen.queryByRole('dialog', { name: /Welcome/ })).toBeNull();
    fireEvent.click(guide);
    expect(await screen.findByRole('complementary', { name: 'Getting started' })).toBeTruthy();
  });

  it('plays the tour after the click, and Skip closes it', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/overview?view=operator');
    fireEvent.click(within(await welcome()).getByRole('button', { name: 'Play the 90-second tour' }));
    const player = await screen.findByRole('dialog', { name: 'How Market Expansion works' });
    expect(within(player).getByRole('button', { name: 'Pause' })).toBeTruthy(); // playing after the click
    expect(within(player).getByText(/Captions only — no sound/)).toBeTruthy();
    expect(within(player).getAllByRole('button', { name: /Scattered decisions|Your role/ })).toHaveLength(2);
    fireEvent.click(within(player).getByRole('button', { name: 'Skip tour' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'How Market Expansion works' })).toBeNull(),
    );
  });
});

describe('Getting started guide', () => {
  it('shows the sponsor’s steps and a Next card from the real inbox: “You have a G2 decision waiting”', async () => {
    localStorage.setItem('gos.onboarding.autostart', 'off');
    session.signIn(people.elena.id);
    renderAt('/me/overview');
    const button = await screen.findByRole('button', { name: /^Guide/ });
    await waitFor(() => expect(button.textContent).toContain('1 of 3'));
    fireEvent.click(button);
    const panel = await screen.findByRole('complementary', { name: 'Getting started' });
    expect(within(panel).getByText('Decide investments')).toBeTruthy();
    const steps = within(within(panel).getByRole('list', { name: 'Your steps' })).getAllByRole('listitem');
    expect(steps.map((li) => li.querySelector('.onb-step__title')!.textContent)).toEqual([
      'Open Reviews',
      'Read the decision package',
      'Decide within your authority',
    ]);
    expect(await within(panel).findByText('You have a G2 decision waiting')).toBeTruthy();
    expect(within(panel).getByText(/Approve pilot €120k · 90 days · ME-104/)).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: /^Approve/ })).toBeNull(); // the guide never decides
    expect(within(panel).getByRole('button', { name: 'Reset onboarding (demo)' })).toBeTruthy();
    // Escape closes it and focus returns to the Guide button.
    fireEvent.keyDown(panel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Getting started' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Guide/ }));
  });

  it('a visit step completes by opening its place, and the change is announced', async () => {
    localStorage.setItem('gos.onboarding.autostart', 'off');
    session.signIn(people.elena.id);
    const router = renderAt('/me/overview');
    const button = await screen.findByRole('button', { name: /^Guide/ });
    await waitFor(() => expect(button.textContent).toContain('1 of 3'));
    await act(() => router.navigate('/reviews?tab=awaiting'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Guide/ }).textContent).toContain('2 of 3'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-live').textContent).toBe('Step complete: Open Reviews'),
    );
  });

  it('⌘K “Guide” opens the guide', async () => {
    localStorage.setItem('gos.onboarding.autostart', 'off');
    session.signIn(people.jonas.id);
    renderAt('/my-work');
    await screen.findByRole('button', { name: /^Guide/ });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'guide' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const panel = await screen.findByRole('complementary', { name: 'Getting started' });
    expect(within(panel).getByText('Run the pilot')).toBeTruthy();
    expect(within(panel).getByText('Check what reached Jira')).toBeTruthy();
  });
});

describe('coach marks', () => {
  it('Show me anchors a non-modal dialog to a real element, moves focus in, and Escape returns it', async () => {
    localStorage.setItem('gos.onboarding.autostart', 'off');
    session.signIn(people.daniel.id);
    renderAt('/me/overview');
    fireEvent.click(await screen.findByRole('button', { name: /^Guide/ }));
    const panel = await screen.findByRole('complementary', { name: 'Getting started' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Show me: Open your review requests' }));
    const coach = await screen.findByRole('dialog', { name: 'Open your review requests' });
    expect(coach.getAttribute('aria-modal')).toBe('false');
    await waitFor(() => expect(coach.getAttribute('data-anchored')).toBe('true'));
    const anchor = document.querySelector('[data-coach-anchor="review.requests"]');
    expect(anchor).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(coach).getByRole('heading')));
    fireEvent.keyDown(coach, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Open your review requests' })).toBeNull(),
    );
    expect(document.querySelector('[data-coach-anchor]')).toBeNull();
    const focused = document.activeElement as HTMLElement;
    expect(focused === anchor || focused.id === 'onb-guide-button').toBe(true);
  });

  it('Next follows the path to the next step', async () => {
    localStorage.setItem('gos.onboarding.autostart', 'off');
    session.signIn(people.daniel.id);
    renderAt('/me/overview');
    fireEvent.click(await screen.findByRole('button', { name: /^Guide/ }));
    const panel = await screen.findByRole('complementary', { name: 'Getting started' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Show me: Open your review requests' }));
    const coach = await screen.findByRole('dialog', { name: 'Open your review requests' });
    fireEvent.click(within(coach).getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('dialog', { name: 'Respond with a reason' })).toBeTruthy();
  });
});

describe('replay and reset', () => {
  it('replays the tour from the account menu; the demo reset shows the welcome again', async () => {
    localStorage.setItem('gos.onboarding.autostart', 'off');
    session.signIn(people.maya.id);
    renderAt('/me/overview?view=operator');
    fireEvent.click(await screen.findByRole('button', { name: /Account and display settings/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Replay the tour' }));
    const player = await screen.findByRole('dialog', { name: 'How Market Expansion works' });
    fireEvent.keyDown(player, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'How Market Expansion works' })).toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Account and display settings/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset onboarding (demo)' }));
    expect(await welcome()).toBeTruthy();
  });
});

describe('explainer player', () => {
  const props = {
    path: 'decide' as const,
    name: 'Elena Fischer',
    initials: 'EF',
    onFinished: vi.fn(),
    onSkip: vi.fn(),
    onDone: vi.fn(),
  };

  it('does not play until asked; chapters, slider, captions and transcript work; the end offers the role CTA', async () => {
    render(<ExplainerPlayer {...props} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy(); // not playing until asked
    expect(screen.getByTestId('explainer-caption').textContent).toBe(
      'Expansion decisions usually live in slides, spreadsheets, email threads and task tools.',
    );
    fireEvent.click(screen.getByRole('button', { name: /The measure ladder/ }));
    expect(screen.getByTestId('explainer-stage').getAttribute('data-chapter')).toBe('ladder');
    expect(screen.getByRole('button', { name: /The measure ladder/ }).getAttribute('aria-current')).toBe(
      'step',
    );
    const slider = screen.getByRole('slider', { name: 'Tour position' });
    expect(slider.getAttribute('aria-valuetext')).toContain('Chapter 4 of 8: The measure ladder');
    fireEvent.keyDown(screen.getByTestId('explainer-stage'), { key: 'ArrowRight' });
    expect(screen.getByTestId('explainer-stage').getAttribute('data-chapter')).toBe('gates');
    fireEvent.click(screen.getByRole('button', { name: 'Captions' }));
    expect(screen.getByText('Captions off')).toBeTruthy();
    const tbtn = screen.getByRole('button', { name: 'Transcript' });
    fireEvent.click(tbtn);
    expect(tbtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: 'Chapter 5: Gates G0–G3' }).textContent).toContain(
      '“Approve pilot €120k · 90 days”',
    );
    // Scrub to the end: completion is recorded once and the role call to action appears.
    fireEvent.change(slider, { target: { value: '83.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(props.onFinished).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Open Reviews' }));
    expect(props.onDone).toHaveBeenCalledWith('/reviews?tab=awaiting');
  });

  it('Space toggles play and pause when focus is not on a control', () => {
    render(<ExplainerPlayer {...props} autoPlay />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('explainer-stage'), { key: ' ' });
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.getByRole('button', { name: /^(Play|Resume)$/ })).toBeTruthy();
  });

  it('with reduced motion it shows a still storyboard with text and never plays', () => {
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) =>
        ({
          matches: q.includes('prefers-reduced-motion'),
          media: q,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    try {
      render(<ExplainerPlayer {...props} autoPlay />);
      expect(screen.queryByRole('button', { name: /^(Play|Pause)$/ })).toBeNull();
      expect(screen.getByText(/Storyboard · reduced motion/)).toBeTruthy();
      expect(screen.getByRole('heading', { name: '1. Scattered decisions' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Your role/ }));
      expect(screen.getByRole('heading', { name: '8. Your role' })).toBeTruthy();
      expect(props.onFinished).toHaveBeenCalled(); // read to the end
    } finally {
      mm.mockRestore();
    }
  });
});
