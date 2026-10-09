// @vitest-environment jsdom
/**
 * S02 states against the MSW mocks: missing owner / currency and an incompatible horizon block
 * submit (summary + inline), the returned comment is shown, the owner cannot approve, a sponsor
 * without G0 authority is told who grants it, and an approved mandate is read-only.
 */
import { API } from '@growth-os/contracts';
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api } from '../../lib/api-client';
import { mockServer, session } from '../../mocks/node';
import { renderAt, resetAllMocks } from '../overview/test-utils';
import { findMandate, mandateStore } from './mocks';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetAllMocks();
});
afterAll(() => mockServer.close());

const key = () => crypto.randomUUID();

/** MD-22: a draft copied from MD-21's scope with the given fields. */
async function draft(fields: Record<string, unknown> = {}) {
  session.signIn(people.maya.id);
  const md21 = await api(API.mandates.get, { params: { ref: 'MD-21' } });
  const s = md21.currentVersion!.fields;
  return api(API.mandates.create, {
    body: {
      businessUnitId: md21.businessUnitId,
      title: 'Mandate · Swiss food-processing plants',
      fields: {
        productId: s.productId,
        segmentIds: s.segmentIds,
        geographyCodes: s.geographyCodes,
        sponsorId: s.sponsorId,
        ...fields,
      },
    },
    idempotencyKey: key(),
  });
}

const complete = {
  objective: 'Evaluate Swiss plants.',
  horizonYears: 3,
  currency: 'EUR',
  ownerId: people.maya.id,
  investmentCeiling: '120000.00',
  pilotDurationDays: 90,
  successDefinition: 'A recorded decision with the SOM scenario stated for end of year 3.',
};

describe('S02 Mandate', () => {
  it('blocks submission while owner, currency and a compatible horizon are missing', async () => {
    await draft({
      objective: 'Evaluate Swiss plants.',
      horizonYears: 1,
      successDefinition: 'A decision with the SOM scenario stated for end of year 3.',
    });
    renderAt('/me/mandates/MD-22');
    expect(await screen.findByText('3 issues block submission to G0')).toBeTruthy();
    const summary = screen.getByText('3 issues block submission to G0').closest('div')!.parentElement!;
    expect(within(summary).getByText('Name an accountable owner.')).toBeTruthy();
    expect(within(summary).getByText('Choose the currency for the spend ceiling.')).toBeTruthy();
    expect(
      within(summary).getByText(/Success is stated for end of year 3, but the mandate horizon is 12 months/),
    ).toBeTruthy();
    expect(screen.getByText('Missing owner.')).toBeTruthy();
    expect(screen.getByText('Currency not specified.')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Submit for G0' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText('Fix the 3 highlighted items to submit.')).toBeTruthy();
    // The live preview names what is missing; the G0 checklist shows open items.
    expect(screen.getByText(/\[owner missing\]/)).toBeTruthy();
    expect(screen.getByText('Accountable owner · open')).toBeTruthy();
    expect(screen.getByText('Sponsor named · met')).toBeTruthy();
  });

  it('autosaves edits with If-Match and refreshes the preview and the errors', async () => {
    await draft({ ...complete, currency: undefined });
    renderAt('/me/mandates/MD-22');
    expect(await screen.findByText('1 issue blocks submission to G0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'EUR' }));
    await waitFor(() => expect(screen.queryByText(/blocks? submission to G0/)).toBeNull(), { timeout: 3000 });
    expect(findMandate('MD-22')!.versions[0]!.fields.currency).toBe('EUR');
    expect(screen.getByText(/with up to €120,000 pilot spend/)).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Submit for G0' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(await screen.findByText('You own this mandate and cannot approve its G0.')).toBeTruthy();
    expect(screen.getAllByText('G0 · Awaiting decision').length).toBeGreaterThan(0);
  });

  it('shows the sponsor’s comment after a return for revision', async () => {
    await draft(complete);
    await api(API.mandates.submit, { params: { ref: 'MD-22' }, idempotencyKey: key() });
    session.signIn(people.elena.id);
    const m = findMandate('MD-22')!;
    const pkg = await api(API.gates.package, { params: { id: m.g0!.id }, query: {} });
    expect(pkg.panel.allowedDispositions).toEqual(['approve', 'return_for_revision']);
    await api(API.gates.decide, {
      params: { id: m.g0!.id },
      body: {
        snapshotId: pkg.snapshot.id,
        snapshotHash: pkg.snapshot.contentHash,
        disposition: 'return_for_revision',
        rationale: 'Add the no-outreach exclusion.',
        note: null,
        conditions: [],
        delegateToUserId: null,
      },
      idempotencyKey: key(),
    });
    session.signIn(people.maya.id);
    renderAt('/me/mandates/MD-22');
    expect(await screen.findByText(/Returned for revision by Elena Fischer/)).toBeTruthy();
    expect(screen.getByText(/“Add the no-outreach exclusion\.” Fix the items and resubmit/)).toBeTruthy();
    expect(screen.getByText('Version 2')).toBeTruthy();
  });

  it('a sponsor without G0 authority is told who grants it', async () => {
    await draft({ ...complete, sponsorId: people.priya.id });
    await api(API.mandates.submit, { params: { ref: 'MD-22' }, idempotencyKey: key() });
    session.signIn(people.priya.id);
    renderAt('/me/mandates/MD-22');
    expect(
      await screen.findByText(
        'You have no G0 authority for BU Water. Request access from [Tenant administrator].',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve mandate (G0)' })).toBeNull();
  });

  it('an approved mandate is read-only with its G0 stamp', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/mandates/MD-21');
    expect(await screen.findByText(/Mandate approved \(G0\) · 5 Oct 2026/)).toBeTruthy();
    expect(
      screen.getByText('Elena Fischer approved scope v2. Discovery can start. No spend is authorized by G0.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Objective').matches(':disabled')).toBe(true);
    expect(screen.getByText('Submitted versions are read-only. Changes create v3.')).toBeTruthy();
    expect(mandateStore.get().mandates).toHaveLength(1);
  });
});
