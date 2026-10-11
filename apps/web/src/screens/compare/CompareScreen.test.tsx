// @vitest-environment jsdom
/**
 * S04 screen: creates the comparison from the `ids` deep link, blocks the ranking on an
 * incomparable boundary, shows Unknown (never 0) and "Not ranked — 1 input missing", previews
 * weights before applying them as a new version.
 */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mockServer, session } from '../../mocks/node';
import { renderAt, resetAllMocks } from '../overview/test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => session.signIn(people.maya.id));
afterEach(() => {
  cleanup();
  resetAllMocks();
});
afterAll(() => mockServer.close());

const rankCells = () =>
  within(
    within(screen.getByRole('table', { name: 'Candidate comparison' }))
      .getByRole('rowheader', { name: /Weighted ranking/ })
      .closest('tr')!,
  ).getAllByRole('cell');

describe('S04 Compare', () => {
  it('blocks, then ranks with two decimals once the incomparable candidate is excluded', async () => {
    const { router } = renderAt('/me/opportunities/compare?ids=OPP-07,OPP-14,OPP-09,OPP-16');
    expect(await screen.findByRole('heading', { level: 1, name: 'Compare 4 candidates' })).toBeTruthy();
    expect(router.state.location.search).toMatch(/^\?ids=OPP-07,OPP-14,OPP-09,OPP-16&comparison=/);
    expect(screen.getByText('Aggregate ranking blocked — incomparable market boundary')).toBeTruthy();
    expect(rankCells().every((c) => c.textContent?.includes('Not ranked — boundary conflict in set'))).toBe(
      true,
    );
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(3);
    expect(screen.getByText(/Score = Product fit × w₁/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Exclude until normalized' }));
    await screen.findByText('Austrian breweries excluded from ranking until normalized');
    const cells = rankCells();
    expect(cells[0]!.textContent).toBe('Rank 1 of 2Score 2.70 of 3');
    expect(cells[1]!.textContent).toBe('Not ranked — 1 input missing (channel access)');
    expect(cells[2]!.textContent).toBe('Excluded until normalized');
    expect(cells[3]!.textContent).toBe('Rank 2 of 2Score 1.70 of 3');
    // Selecting the incomparable candidate is not offered.
    expect(screen.getByText('Normalize the boundary first.')).toBeTruthy();
  });

  it('previews weights without applying them; Apply creates the next version', async () => {
    const { router } = renderAt('/me/opportunities/compare?ids=OPP-07,OPP-14,OPP-09,OPP-16');
    await screen.findByText('Aggregate ranking blocked — incomparable market boundary');
    fireEvent.click(screen.getByRole('button', { name: 'Exclude until normalized' }));
    await screen.findByText('Austrian breweries excluded from ranking until normalized');
    expect(screen.getByText('Change a weight to preview it first.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Increase Product fit weight' }));
    expect(screen.getByText('Total 110% — must be 100%')).toBeTruthy();
    await waitFor(() => expect(rankCells()[0]!.textContent).toBe('Weights must total 100%'));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Evidence coverage weight' }));
    await waitFor(() => expect(rankCells()[0]!.textContent).toBe('Rank 1 of 2Score 2.80 of 3'));
    expect(screen.getByText(/Previewing unapplied weights in the ranking row/)).toBeTruthy();
    expect(screen.getByText('Applied: weights v1 · Fit 40% · Access 30% · Evidence 30%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply weights' }));
    expect(await screen.findByText('Applied: weights v2 · Fit 50% · Access 30% · Evidence 20%')).toBeTruthy();
    expect(router.state.location.search).toContain('weights=v2');
  });

  it('asks for 2 to 4 candidates when the link has fewer', async () => {
    renderAt('/me/opportunities/compare?ids=OPP-07');
    expect(await screen.findByText('Choose 2 to 4 candidates')).toBeTruthy();
  });
});
