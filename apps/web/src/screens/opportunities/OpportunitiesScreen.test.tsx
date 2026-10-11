// @vitest-environment jsdom
/**
 * S03 states and actions against the MSW mocks: partial discovery, AI proposals, likely duplicate,
 * dismiss requires a reason (and stays visible under the filter), keyboard shortlist, manual add,
 * convert needs an owner, and the empty state.
 */
import { API } from '@growth-os/contracts';
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mock } from '../../mocks/define';
import { mockServer, session } from '../../mocks/node';
import { renderAt, resetAllMocks } from '../overview/test-utils';
import { opportunityStore } from './mocks';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => session.signIn(people.maya.id));
afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
  resetAllMocks();
});
afterAll(() => mockServer.close());

const table = () => screen.getByRole('table', { name: 'Opportunity candidates' });
const detail = (name: string) => screen.getByRole('complementary', { name });

describe('S03 Opportunities', () => {
  it('shows partial discovery, AI proposals and never claims an exhaustive search', async () => {
    renderAt('/me/opportunities?mandate=MD-21');
    expect(await screen.findByText('Discovery partial — 1 source unavailable')).toBeTruthy();
    expect(screen.getByText(/Trade registry connection is unavailable since 6 Oct/)).toBeTruthy();
    expect(screen.getByText('5 of 6 candidates · not an exhaustive search')).toBeTruthy();
    const row07 = within(table()).getByRole('rowheader', { name: /German food-processing plants/ });
    expect(row07.textContent).toContain('Proposed · AI');
    const row14 = within(table()).getByRole('rowheader', { name: /Dutch food-processing plants/ });
    expect(row14.textContent).toContain('Added manually');
    // Dismissed candidates are kept, under their own filter.
    expect(within(table()).queryByText('Polish beverage bottlers')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismissed · Duplicate' }));
    expect(await within(table()).findByText('Polish beverage bottlers')).toBeTruthy();
  });

  it('flags a likely duplicate and merges it, keeping both records', async () => {
    const { router } = renderAt('/me/opportunities?mandate=MD-21&selected=OPP-12');
    const d = await screen.findByRole('complementary', { name: 'German dairy plants' });
    expect(within(d).getByRole('status').textContent).toContain('Likely duplicate of OPP-07');
    fireEvent.click(within(d).getByRole('button', { name: /Merge into OPP-07/ }));
    expect(await within(d).findByText('Merged into OPP-07. Both records are kept and linked.')).toBeTruthy();
    expect(opportunityStore.get().duplicateOf['OPP-12']).toBe('OPP-07');
    expect(router.state.location.search).toContain('selected=OPP-12');
  });

  it('dismiss needs a reason; the reason is kept', async () => {
    renderAt('/me/opportunities?mandate=MD-21&selected=OPP-09');
    const d = await screen.findByRole('complementary', { name: 'Austrian breweries' });
    fireEvent.click(within(d).getByRole('button', { name: /Dismiss/ }));
    const confirm = within(d).getByRole('button', { name: 'Dismiss candidate' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(within(d).getByText('Choose a reason.')).toBeTruthy();
    fireEvent.click(within(d).getByRole('button', { name: 'Outside channel coverage' }));
    const enabled = within(d).getByRole('button', { name: 'Dismiss candidate' }) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    fireEvent.click(enabled);
    expect(
      await within(d).findByText('Dismissed · reason: Outside channel coverage. Kept for audit.'),
    ).toBeTruthy();
  });

  it('shortlists with the s key (not while typing) and converts with a named owner', async () => {
    renderAt('/me/opportunities?mandate=MD-21&selected=OPP-07');
    const d = await screen.findByRole('complementary', { name: 'German food-processing plants' });
    fireEvent.keyDown(document.body, { key: 's' });
    expect(await within(d).findByRole('button', { name: 'Convert to case' })).toBeTruthy();
    expect(opportunityStore.get().status['OPP-07']).toBe('shortlisted');
    fireEvent.click(within(d).getByRole('button', { name: 'Convert to case' }));
    expect(within(d).getByText(/Creates an expansion case in Discovery under mandate MD-21/)).toBeTruthy();
    await waitFor(() =>
      expect(
        within(d)
          .getByRole('option', { name: /Maya Rao/ })
          .getAttribute('aria-selected'),
      ).toBe('true'),
    );
    fireEvent.click(within(d).getByRole('button', { name: 'Convert to case' }));
    expect(await within(d).findByText('Converted to case ME-104')).toBeTruthy();
    expect(within(d).getByText(/Owner Maya Rao · stage Discovery/)).toBeTruthy();
  });

  it('adds a candidate manually; it starts Detected with no evidence', async () => {
    renderAt('/me/opportunities?mandate=MD-21');
    fireEvent.click(await screen.findByRole('button', { name: 'Add manually' }));
    const input = screen.getByLabelText('Market name');
    fireEvent.keyDown(input, { key: 's' }); // typing never triggers the shortcut
    expect(opportunityStore.get().status['OPP-07']).toBe('detected');
    fireEvent.change(input, { target: { value: 'Swiss dairy plants' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add candidate' }));
    const d = await screen.findByRole('complementary', { name: 'Swiss dairy plants' });
    expect(within(d).getByText('Detected')).toBeTruthy();
    expect(within(d).getByText('No evidence attached. Attach sources before shortlisting.')).toBeTruthy();
    expect(detail('Swiss dairy plants')).toBeTruthy();
  });

  it('explains an empty discovery result and offers manual entry', async () => {
    mockServer.use(
      mock(API.opportunities.list, () => ({
        items: [],
        nextCursor: null,
        discoveryPartial: false,
        unavailableSources: [],
        filtersText: '',
      })),
    );
    renderAt('/me/opportunities?mandate=MD-21');
    expect(await screen.findByText('No candidates for this mandate yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add manually' }).length).toBe(2);
  });
});
