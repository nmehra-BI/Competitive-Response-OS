// @vitest-environment jsdom
/** S05 Thesis against the MSW mocks. */
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
});
