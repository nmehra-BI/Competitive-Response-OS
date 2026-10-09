// @vitest-environment jsdom
/** S10 Decisions and the decision brief against the MSW mocks: states and every FRONTEND §7 variant. */
import { API } from '@growth-os/contracts';
import { assumptions, gates, people } from '@growth-os/fixtures-aster';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/providers';
import { buildRoutes } from '../../app/router';
import { api, ApiProblem } from '../../lib/api-client';
import { createQueryClient } from '../../lib/query';
import { mockServer, resetMockState, resetReplay, session, setScenario } from '../../mocks/node';
import type { Ws8cPreset } from './mock-state';

// Lazy screens load on first render; allow for a slow, parallel run.
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
  sessionStorage.clear();
});
afterAll(() => mockServer.close());

const preset = (p: Ws8cPreset) => setScenario({ ws8cPreset: p } as never);

function renderAt(url: string) {
  const router = createMemoryRouter(buildRoutes(), { initialEntries: [url] });
  render(
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

const panel = () => screen.findByRole('complementary', { name: 'Approval panel' });
const article = () => screen.findByRole('article', { name: 'Decision package' });

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ApiProblem ? e.code : 'error';
  }
}

describe('S10 Decisions · package', () => {
  it('renders the read-only v3 package: fingerprint, scope, €120k, alternatives, sign-offs, conditions, dissent, sources', async () => {
    session.signIn(people.elena.id);
    renderAt('/me/cases/ME-104/decisions');
    const a = await article();
    const t = a.textContent ?? '';
    expect(t).toContain('Snapshot v3');
    expect(t).toContain('7F3A·19C2');
    expect(t).toContain('Read-only');
    expect(t).toContain('Pilot: German food-processing plants');
    expect(t).toContain('Changes since you last viewed this package: specialist sign-off added');
    expect(t).toContain('€120k · approved budget ceiling · one-time pilot spend');
    expect(t).toContain('90 days · 1 Dec 2026 – 28 Feb 2027');
    expect(t).toContain('No entry.');
    expect(t).toContain('Met · 9 interviews (threshold 8)');
    expect(t).toContain('€0k (break-even)');
    expect(t).toContain('Signed for pilot only: up to 4 sites, 90 days');
    expect(t).toContain('Approved budget ceiling €120k.');
    expect(t).toContain('Blocks execution until met');
    expect(t).toContain('Monitor only');
    expect(t).toContain('I do not see comparable evidence for 20% adoption in this segment.');
    expect(t).toContain('Site census · 3 Jun 2026');
    expect(within(a).queryByRole('button')).toBeNull();
  });

  it('Elena approves "Approve pilot €120k · 90 days" bound to the snapshot; C1 + C2 → approved with conditions', async () => {
    session.signIn(people.elena.id);
    renderAt('/me/cases/ME-104/decisions?gate=G2');
    const p = await panel();
    expect(p.textContent).toContain('Awaiting decision');
    expect(p.textContent).toContain('If unused by 11 Dec 2026');
    expect(within(p).getByText('What this authorizes')).toBeTruthy();
    expect(within(p).getByText('What this does not authorize')).toBeTruthy();
    for (const name of ['Return for revision', 'Not approved', 'Abstain']) {
      expect(within(p).getByRole('button', { name })).toBeTruthy();
    }
    fireEvent.click(within(p).getByRole('button', { name: 'Approve pilot €120k · 90 days' }));
    // The author's proposed conditions are listed for the approver, so the confirm button counts them.
    const confirm = within(p).getByRole('button', { name: /^Approve pilot €120k · 90 days · 2 conditions/ });
    expect((confirm as HTMLButtonElement).disabled).toBe(true); // rationale required
    fireEvent.change(within(p).getByLabelText(/Rationale/), { target: { value: 'Thresholds met.' } });
    fireEvent.click(within(p).getByRole('button', { name: /^Approve pilot €120k · 90 days · 2 conditions/ }));
    await waitFor(() =>
      expect(p.textContent).toMatch(/Approved with conditions · 2 conditions · \d+ \w+, \d\d:\d\d/),
    );
    expect(p.textContent).toContain('Pilot approved for v3 only');
    expect(within(p).getByRole('link', { name: /Open pilot plan/ })).toBeTruthy();
  });

  it('return for revision needs a rationale and is recorded as a decision', async () => {
    session.signIn(people.elena.id);
    renderAt('/me/cases/ME-104/decisions?gate=G2');
    const p = await panel();
    fireEvent.click(within(p).getByRole('button', { name: 'Return for revision' }));
    fireEvent.change(within(p).getByLabelText(/Rationale/), {
      target: { value: 'Clarify effort threshold.' },
    });
    fireEvent.click(within(p).getByRole('button', { name: 'Return for revision' }));
    await waitFor(() => expect(p.textContent).toContain('Returned for revision'));
    expect(p.textContent).toContain('Maya Rao is notified.');
  });

  it('self-approval: the author sees why and can withdraw; a forced decision is refused', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/decisions?gate=G2');
    const p = await panel();
    expect(p.textContent).toContain('You authored this package and cannot approve it.');
    expect(p.textContent).toContain('Viewing as Maya Rao. Only Elena Fischer can decide G2 v3.');
    expect(within(p).queryByRole('button', { name: /Approve pilot/ })).toBeNull();
    expect(within(p).getByRole('button', { name: 'Withdraw v3' })).toBeTruthy();
    const pkg = await api(API.gates.package, { params: { id: gates.g2.id }, query: {} });
    const forced = api(API.gates.decide, {
      params: { id: gates.g2.id },
      idempotencyKey: 'k-self',
      body: {
        snapshotId: pkg.snapshot.id,
        snapshotHash: pkg.snapshot.contentHash,
        disposition: 'approve',
        rationale: 'x',
        note: null,
        conditions: [],
        delegateToUserId: null,
      },
    });
    expect(await codeOf(forced)).toBe('SELF_APPROVAL_PROHIBITED');
  });

  it('unauthorized reviewer: no approve action, policy reason shown', async () => {
    session.signIn(people.daniel.id);
    renderAt('/me/cases/ME-104/decisions?gate=G2');
    const p = await panel();
    expect(p.textContent).toContain('Your role does not decide gates.');
    expect(within(p).queryByRole('button', { name: /Approve pilot/ })).toBeNull();
    expect(within(p).queryByRole('button', { name: /Withdraw/ })).toBeNull();
  });
});

describe('S10 Decisions · stale, refresh, superseded', () => {
  it('a material assumption change makes v3 stale: approval disabled; refresh creates v4; v3 superseded', async () => {
    session.signIn(people.maya.id);
    const v3 = await api(API.gates.package, { params: { id: gates.g2.id }, query: {} });
    const res = await api(API.assumptions.update, {
      params: { id: assumptions[0].id },
      ifMatch: 1,
      body: { value: '0.18', changeReason: 'Revised after review' },
    });
    expect(res.staleSnapshotIds).toEqual([v3.snapshot.id]);

    session.signIn(people.elena.id);
    renderAt('/me/cases/ME-104/decisions?gate=G2');
    expect(
      await screen.findByText(
        'This snapshot is out of date: adoption assumption changed on 26 Nov. Approval is disabled.',
      ),
    ).toBeTruthy();
    const p = await panel();
    const approve = within(p).getByRole('button', {
      name: 'Approve pilot €120k · 90 days',
    }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(p.textContent).toContain('Approval disabled: snapshot v3 is out of date. Refresh to create v4.');
    expect(within(p).queryByRole('button', { name: 'Return for revision' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'See what changed' }));
    expect(await screen.findByRole('list', { name: 'What changed' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot (creates v4)' }));
    expect(await screen.findByText('Snapshot v4 created from the current committed inputs.')).toBeTruthy();
    await waitFor(async () => expect((await article()).textContent).toContain('Snapshot v4'));
    const p4 = await panel();
    await waitFor(() =>
      expect(
        (within(p4).getByRole('button', { name: 'Approve pilot €120k · 90 days' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });

  it('a decision on the stale v3 is refused by the API (SNAPSHOT_STALE)', async () => {
    preset('stale');
    session.signIn(people.elena.id);
    const pkg = await api(API.gates.package, { params: { id: gates.g2.id }, query: {} });
    expect(pkg.snapshot.status).toBe('stale');
    expect(pkg.staleBanner?.title).toContain('adoption assumption changed on 26 Nov');
    const p = api(API.gates.decide, {
      params: { id: gates.g2.id },
      idempotencyKey: 'k-stale',
      body: {
        snapshotId: pkg.snapshot.id,
        snapshotHash: pkg.snapshot.contentHash,
        disposition: 'approve',
        rationale: 'x',
        note: null,
        conditions: [],
        delegateToUserId: null,
      },
    });
    expect(await codeOf(p)).toBe('SNAPSHOT_STALE');
  });

  it('superseded v3 stays readable but cannot be approved', async () => {
    preset('v4');
    session.signIn(people.elena.id);
    renderAt('/me/cases/ME-104/decisions?gate=G2&version=3');
    expect(await screen.findByText(/Snapshot v3 is superseded by v4/)).toBeTruthy();
    const p = await panel();
    expect(
      (within(p).getByRole('button', { name: 'Approve pilot €120k · 90 days' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(p.textContent).toContain('v3 is superseded and cannot be approved.');
    fireEvent.click(screen.getByRole('button', { name: 'Open v4' }));
    await waitFor(async () => expect((await article()).textContent).toContain('Snapshot v4'));
  });
});

describe('S10 Decisions · after approval and history', () => {
  it('invalidated: WS3 notice, Invalidated stamp, no action', async () => {
    preset('invalidated');
    session.signIn(people.elena.id);
    renderAt('/me/cases/ME-104/decisions?gate=G2');
    expect(
      await screen.findByText(
        'Approval for v4 no longer applies: adoption assumption changed. Pilot tasks paused.',
      ),
    ).toBeTruthy();
    const p = await panel();
    expect(p.querySelector('[data-status="invalidated"]')).not.toBeNull();
    expect(p.textContent).toContain('The approval no longer applies. Prepare a new request.');
  });

  it('expired: the approval expired unused', async () => {
    preset('expired');
    session.signIn(people.elena.id);
    renderAt('/me/cases/ME-104/decisions?gate=G2');
    expect(await screen.findByText('The approval for v4 expired unused on 11 Dec 2026.')).toBeTruthy();
    const p = await panel();
    expect(p.querySelector('[data-status="expired"]')).not.toBeNull();
    expect(p.textContent).toContain('The approval expired unused. Prepare a new request.');
  });

  it('G1 history: "Approve validation €15k" approved with its rationale and boxes', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/decisions?gate=G1');
    const h = await screen.findByRole('region', { name: 'Gate history · ME-104' });
    expect(h.textContent).toContain(
      'G1 · Approve validation €15k · Approved 16 Oct 2026, 15:02 by Elena Fischer',
    );
    expect(h.textContent).toContain('Bounded spend, clear thresholds, outcome changes the G2 decision.');
    expect(h.textContent).toContain('G2 · Package v2 · Superseded · never decided');
    expect(within(h).getByText('Not a pilot')).toBeTruthy();
  });

  it('G1 awaiting: Elena approves validation and the experiment plan locks', async () => {
    preset('start');
    session.signIn(people.maya.id);
    // Maya: experiment + G1 request through the API (UI covered in the validation tests).
    const e = await api(API.experiments.create, {
      params: { caseRef: 'ME-104' },
      idempotencyKey: 'k-exp',
      body: {
        title: 'Validation outreach · 20 sites',
        assumptionIds: [assumptions[0].id],
        ownerId: people.maya.id,
        fieldworkOwnerId: people.jonas.id,
        plan: {
          hypothesis: 'h',
          method: 'm',
          sampleText: '20 sites',
          sampleSize: 20,
          selectionText: 's',
          nonresponseNote: 'n',
          windowStart: '2026-10-19',
          windowEnd: '2026-11-13',
          budgetAmount: '15000.00',
          currency: 'EUR',
          budgetNote: null,
          metrics: [
            {
              metricKey: 'paid_commitments',
              name: 'Paid pilot commitments',
              operator: 'gte',
              thresholdValue: '4',
              thresholdText: '≥ 4',
              unit: 'commitments',
            },
          ],
          decisionRules: [],
        },
      },
    });
    expect(e.lifecycle).toBe('draft');
    const g1 = await api(API.gates.createRequest, {
      params: { caseRef: 'ME-104' },
      idempotencyKey: 'k-g1',
      body: {
        gateCode: 'G1',
        parentGateRequestId: null,
        proposedConditions: [],
        scope: {
          amount: '15000.00',
          currency: 'EUR',
          durationDays: null,
          windowStart: null,
          windowEnd: null,
          countryCodes: [],
          segmentLabel: null,
          maxSites: 20,
          milestones: [],
          ownerId: people.maya.id,
          authorizes: ['Validation outreach to 20 sites · up to €15k'],
          doesNotAuthorize: ['Not a pilot'],
        },
      },
    });
    const sub = await api(API.gates.submit, { params: { id: g1.id }, idempotencyKey: 'k-sub' });
    expect(sub.snapshot.version).toBe(1);
    expect(sub.snapshot.fingerprint).toBe('2B71·0E4D');

    session.signIn(people.elena.id);
    renderAt('/me/cases/ME-104/decisions?gate=G1');
    const p = await panel();
    fireEvent.click(within(p).getByRole('button', { name: 'Approve validation €15k' }));
    fireEvent.change(within(p).getByLabelText(/Rationale/), { target: { value: 'Bounded spend.' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Approve validation €15k' }));
    await waitFor(() => expect(p.textContent).toContain('Validation approved for v1 only'));
    const list = await api(API.experiments.list, { params: { caseRef: 'ME-104' } });
    expect(list.items[0]!.lockedByGateRequestId).toBe(gates.g1.id);
    expect(list.items[0]!.original?.isOriginal).toBe(true);
  });
});

describe('Decision brief', () => {
  it('is read-only and printable, with the decision record', async () => {
    preset('approved');
    session.signIn(people.elena.id);
    renderAt('/me/cases/ME-104/brief?gate=G2&version=4');
    const a = await article();
    expect(a.textContent).toContain('Snapshot v4');
    const record = screen.getByRole('region', { name: 'Decision record' });
    expect(record.textContent).toContain('Approve with conditions · Elena Fischer');
    expect(record.textContent).toContain(
      'Thresholds met; bounded pilot tests the disputed adoption assumption.',
    );
    expect(screen.getByRole('button', { name: 'Print decision brief' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve pilot/ })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Approval panel' })).toBeNull();
  });
});
