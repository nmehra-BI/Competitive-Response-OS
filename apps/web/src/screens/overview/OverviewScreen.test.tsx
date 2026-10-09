// @vitest-environment jsdom
/**
 * S01 states: attention cards, finance source unavailable ("Not available —", never 0), the
 * restricted scope label and a BU without access, a stale (invalidated) approval in a case row,
 * the empty state, and the case list filter.
 */
import { API } from '@growth-os/contracts';
import { people } from '@growth-os/fixtures-aster';
import { cleanup, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { caseListRows, overview } from '../../mocks/data';
import { mock } from '../../mocks/define';
import { mockServer, session } from '../../mocks/node';
import { renderAt, resetAllMocks } from './test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => session.signIn(people.elena.id));
afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
  resetAllMocks();
});
afterAll(() => mockServer.close());

describe('S01 Overview', () => {
  it('shows attention cards, scope, spend and the case table without totals', async () => {
    renderAt('/me/overview');
    expect(await screen.findByRole('heading', { level: 1, name: 'Portfolio overview' })).toBeTruthy();
    expect(
      screen.getByText('Showing BU Water · cases you can access · hidden cases are not counted'),
    ).toBeTruthy();
    const decisions = screen.getByRole('region', { name: 'Decisions awaiting you' });
    expect(within(decisions).getByText('Approve pilot €120k · 90 days')).toBeTruthy();
    expect(within(decisions).getByText('1')).toBeTruthy();
    const spend = screen.getByRole('region', { name: 'Approved vs requested spend' });
    expect(within(spend).getByText('€15k')).toBeTruthy();
    expect(within(spend).getByText('€120k')).toBeTruthy();
    expect(within(spend).getByText(/Spent to date: Not available — finance source unavailable/)).toBeTruthy();
    expect(screen.getByText(/^Finance source unavailable · spend last refreshed/)).toBeTruthy();
    const restricted = screen.getByRole('option', { name: 'BU Air · no access' }) as HTMLOptionElement;
    expect(restricted.disabled).toBe(true);
    const cases = screen.getByRole('table', { name: 'Expansion cases' });
    expect(within(cases).getAllByRole('row')).toHaveLength(5);
    expect(
      screen.getByText(
        'Market sizes are not totalled across cases. Each case has its own market boundary, unit and year.',
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/total opportunity/i);
  });

  it('marks an invalidated approval in a case row', async () => {
    mockServer.use(
      mock(API.overview.portfolio, ({ viewerId }) => {
        const base = overview(viewerId);
        const [first, ...rest] = base.cases;
        return {
          ...base,
          cases: [
            {
              ...first!,
              nextGate: {
                ...first!.nextGate!,
                status: 'invalidated' as const,
                caption: 'Pilot €120k · approval invalidated',
              },
            },
            ...rest,
          ],
        };
      }),
    );
    renderAt('/me/overview');
    const cases = await screen.findByRole('table', { name: 'Expansion cases' });
    const chip = within(cases).getByText('G2 · Pilot €120k · approval invalidated');
    expect(chip.closest('[data-status]')?.getAttribute('data-status')).toBe('invalidated');
  });

  it('empty: no cases yet → create a mandate', async () => {
    mockServer.use(
      mock(API.overview.portfolio, ({ viewerId }) => ({
        ...overview(viewerId),
        cases: [],
        casesByStage: [],
        decisionsAwaitingViewer: [],
      })),
    );
    renderAt('/me/overview');
    expect(await screen.findByText('No expansion cases yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create a mandate' }).getAttribute('href')).toBe(
      '/me/mandates/new',
    );
  });

  it('case list filters by stage through the deep link', async () => {
    const { router } = renderAt('/me/cases?stage=assessment');
    const t = await screen.findByRole('table', { name: 'Expansion cases' });
    expect(within(t).getAllByRole('row')).toHaveLength(2);
    expect(within(t).getByText('Austrian breweries — monitoring')).toBeTruthy();
    expect(router.state.location.search).toBe('?stage=assessment');
    expect(caseListRows()).toHaveLength(4);
  });
});
