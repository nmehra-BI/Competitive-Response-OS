// @vitest-environment jsdom
/**
 * S01 "New case" (D-149): an operator starts a direct case without the API — title, business unit and
 * scope from the catalogue, currency and horizon; the case opens at its thesis. Missing fields are named,
 * nothing is sent; a server refusal is shown.
 */
import { API } from '@growth-os/contracts';
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mock, MockProblem } from '../../mocks/define';
import { mockServer, session } from '../../mocks/node';
import { renderAt, resetAllMocks } from './test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => session.signIn(people.maya.id));
afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
  resetAllMocks();
});
afterAll(() => mockServer.close());

async function openForm(url: string) {
  const r = renderAt(url);
  fireEvent.click(await screen.findByRole('button', { name: 'New case' }));
  const form = await screen.findByRole('form', { name: 'New expansion case' });
  return { ...r, form };
}

describe('S01 New case', () => {
  it('creates a direct case with its scope and opens it', async () => {
    const sent: unknown[] = [];
    mockServer.use(
      mock(API.cases.createDirect, ({ body }) => {
        sent.push(body);
        const now = new Date().toISOString();
        return {
          id: '00000000-0000-4000-8000-0000000c0099',
          key: 'ME-199',
          appType: 'market_expansion' as const,
          title: body.title,
          businessUnitId: body.businessUnitId,
          mandateId: '00000000-0000-4000-8000-0000000d0099',
          owner: { id: people.maya.id, displayName: 'Maya Rao', title: null, initials: 'MR' },
          sponsor: { id: people.elena.id, displayName: 'Elena Fischer', title: null, initials: 'EF' },
          stage: 'draft_mandate' as const,
          heldFromStage: null,
          originType: 'direct' as const,
          originId: null,
          rowVersion: 1,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );
    const { router, form } = await openForm('/me/cases');
    const f = within(form);
    fireEvent.change(f.getByLabelText('Case title (required)'), {
      target: { value: 'German food plants — direct' },
    });
    // The catalogue of the first business unit fills the scope pickers.
    const product = (await waitFor(() => {
      const el = f.getByLabelText('Product') as HTMLSelectElement;
      expect(el.options.length).toBeGreaterThan(1);
      return el;
    })) as HTMLSelectElement;
    fireEvent.change(product, { target: { value: product.options[1]!.value } });
    const segment = f.getByLabelText('Segment') as HTMLSelectElement;
    fireEvent.change(segment, { target: { value: segment.options[1]!.value } });
    const geo = f.getByLabelText('Geography') as HTMLSelectElement;
    fireEvent.change(geo, { target: { value: 'DE' } });
    expect((f.getByLabelText('Currency') as HTMLInputElement).value).toBe('EUR');
    fireEvent.change(f.getByLabelText('Horizon (years)'), { target: { value: '3' } });
    fireEvent.click(f.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/cases/ME-199/thesis'));
    expect(sent).toEqual([
      {
        businessUnitId: expect.any(String),
        title: 'German food plants — direct',
        mandate: {
          currency: 'EUR',
          horizonYears: 3,
          productId: product.options[1]!.value,
          segmentIds: [segment.options[1]!.value],
          geographyCodes: ['DE'],
        },
      },
    ]);
  });

  it('names what is missing and sends nothing; shows a refusal from the server', async () => {
    let calls = 0;
    mockServer.use(
      mock(API.cases.createDirect, () => {
        calls += 1;
        throw new MockProblem('FORBIDDEN', 'You cannot create cases in this business unit.');
      }),
    );
    const { form } = await openForm('/me/overview');
    const f = within(form);
    fireEvent.change(f.getByLabelText('Horizon (years)'), { target: { value: '0' } });
    fireEvent.click(f.getByRole('button', { name: 'Create case' }));
    expect((await f.findByRole('alert')).textContent).toBe('Add a title, a horizon of 1–10 years.');
    expect(calls).toBe(0);
    fireEvent.change(f.getByLabelText('Case title (required)'), { target: { value: 'A case' } });
    fireEvent.change(f.getByLabelText('Horizon (years)'), { target: { value: '3' } });
    fireEvent.click(f.getByRole('button', { name: 'Create case' }));
    expect(await f.findByText('You cannot create cases in this business unit.')).toBeTruthy();
    expect(calls).toBe(1);
    fireEvent.click(f.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'New expansion case' })).toBeNull());
  });
});
