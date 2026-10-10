// @vitest-environment jsdom
/** S05 Thesis against the MSW mocks. */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { session } from '../../mocks/node';
import { setAssessmentScenario } from '../sizing/mock-state';
import { mockServer, renderAt, resetAll } from '../sizing/test-utils';
import { resetProposalMocks } from './mocks';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetAll();
  resetProposalMocks();
  sessionStorage.clear();
});
afterAll(() => mockServer.close());

describe('S05 Thesis', () => {
  it('shows the hero, run status without a percentage, claims with kinds and alternatives with No entry', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/thesis');
    const hero = await screen.findByRole('region', { name: 'Thesis summary' });
    expect(hero.textContent).toContain('Offer our existing water-monitoring system');
    const strip = screen.getByRole('region', { name: 'Analysis status' });
    await waitFor(() => expect(strip.textContent).toContain('Working: checking sources…'));
    expect(strip.textContent).not.toMatch(/\d+\s?%/);
    const claims = screen.getByRole('heading', { name: 'Claims' }).closest('section')!;
    const kinds = [...claims.querySelectorAll('[data-kind]')].map((k) => k.getAttribute('data-kind'));
    expect(kinds).toEqual(['evidence', 'assumption', 'assumption', 'scenario', 'unknown', 'assumption']);
    expect(within(claims).getByText('AI draft')).toBeTruthy();
    expect(within(claims).getByText('Disputed by Daniel Weber')).toBeTruthy();
    const alts = screen.getByRole('table', { name: 'Alternatives' });
    expect(within(alts).getByRole('rowheader', { name: 'No entry' })).toBeTruthy();
    expect(alts.textContent).toContain('Recommended');
    expect(screen.getByRole('heading', { name: 'Disagreements' }).closest('section')!.textContent).toContain(
      'I do not see comparable evidence for 20% adoption',
    );
    const blockers = screen.getByRole('heading', { name: 'Blockers' }).closest('section')!;
    expect(blockers.textContent).toContain('Specialist review not started. Blocks G2 (pilot), not G1.');
    expect(screen.getByText('RECOMMENDATION · NOT A DECISION')).toBeTruthy();
  });

  it('accepts the AI-drafted claim as an assumption and challenges another claim', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/thesis');
    fireEvent.click(await screen.findByRole('button', { name: 'Accept as assumption' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept as assumption' })).toBeNull());
    expect(screen.getByText('· accepted by Maya Rao')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /^Challenge:/ })[0]!);
    const form = screen.getByRole('form', { name: 'Challenge claim' });
    const send = within(form).getByRole('button', { name: 'Send challenge to owner' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText(/What is wrong or unsupported/), {
      target: { value: 'The census counts sites with any water step, not the target process.' },
    });
    // The enabled button is a new element (the disabled one carries its reason).
    fireEvent.click(within(form).getByRole('button', { name: 'Send challenge to owner' }));
    expect(await screen.findByText(/Challenge open · sent to owner/)).toBeTruthy();
  });

  it('turns the unknown competition claim into evidence when the run is done', async () => {
    setAssessmentScenario({ thesisRun: 'completed' });
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/thesis');
    const strip = await screen.findByRole('region', { name: 'Analysis status' });
    await waitFor(() => expect(strip.textContent).toContain('Done'));
    expect(
      screen.getByText('Established suppliers serve large plants; smaller plants are fragmented.'),
    ).toBeTruthy();
  });

  it('shows partial results in business copy', async () => {
    setAssessmentScenario({ thesisRun: 'partial' });
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/thesis');
    const strip = await screen.findByRole('region', { name: 'Analysis status' });
    await waitFor(() => expect(strip.textContent).toContain('Partial results'));
    expect(strip.textContent).toContain('competition section incomplete');
  });

  it('blockers name their gate with a tooltip hint: "Pending · G1" and "Blocker · G2" (D-119)', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/thesis');
    await screen.findByRole('region', { name: 'Thesis summary' });
    const blockers = screen.getByRole('heading', { name: 'Blockers' }).closest('section')!;
    expect(within(blockers).getByText('Pending · G1')).toBeTruthy();
    expect(within(blockers).getByText('Blocker · G2')).toBeTruthy();
    expect(
      within(blockers).getByTitle('Unresolved for a later gate. It does not stop the next gate.'),
    ).toBeTruthy();
    expect(blockers.textContent).toContain('Needed for the next gate and in progress.');
  }, 30_000);

  it('accepts a cited AI claim as fact in one step after a confirm dialog with claim, kind and citations', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/thesis');
    const list = await screen.findByRole('list', { name: 'AI claim proposals' });
    const items = within(list)
      .getAllByRole('listitem')
      .filter((li) => li.hasAttribute('data-proposal'));
    expect(items).toHaveLength(2);
    // The uncited proposal offers only "Add as draft", with the reason.
    expect(within(items[1]!).queryByRole('button', { name: 'Accept as fact' })).toBeNull();
    expect(within(items[1]!).getByText('No citation: add it as a draft, then decide.')).toBeTruthy();
    fireEvent.click(within(items[0]!).getByRole('button', { name: 'Accept as fact' }));
    const dialog = screen.getByRole('dialog', { name: 'Accept as fact' });
    expect(dialog.textContent).toContain('About 5,000 food-processing sites');
    expect(dialog.querySelector('[data-kind="evidence"]')).not.toBeNull();
    expect(within(dialog).getByRole('list', { name: 'Citations' }).textContent).toContain('Cited passage 1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept as fact' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The claim is now an accepted fact in Claims, and the proposal leaves the list.
    const claims = screen.getByRole('heading', { name: 'Claims' }).closest('section')!;
    await waitFor(() =>
      expect(claims.textContent).toContain('About 5,000 food-processing sites in Germany operate'),
    );
    await waitFor(() => expect(within(list).queryAllByRole('listitem')).toHaveLength(1));
  }, 30_000);

  it('"Add as draft" leaves acceptance as a second step; others cannot decide', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/thesis');
    const list = await screen.findByRole('list', { name: 'AI claim proposals' });
    const uncited = within(list).getAllByRole('listitem')[1]!;
    fireEvent.click(within(uncited).getByRole('button', { name: 'Add as draft' }));
    const claims = screen.getByRole('heading', { name: 'Claims' }).closest('section')!;
    await waitFor(() =>
      expect(claims.textContent).toContain('Plants with a water-reuse target buy monitoring'),
    );
    expect(within(claims).getAllByText('AI draft').length).toBeGreaterThanOrEqual(2);
    cleanup();
    session.signIn(people.daniel.id);
    renderAt('/me/cases/ME-104/thesis');
    const forDaniel = await screen.findByRole('list', { name: 'AI claim proposals' });
    expect(within(forDaniel).queryByRole('button', { name: 'Accept as fact' })).toBeNull();
    expect(screen.getByText('The case owner decides these proposals.')).toBeTruthy();
  }, 30_000);
});
