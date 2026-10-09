// @vitest-environment jsdom
/**
 * My Work and the Reviews inbox: task brief, approvals notice, Mark done through tasks.update
 * with the task's row version (If-Match), and a review response that needs a reason.
 */
import { API, type PilotPlanView, type Task } from '@growth-os/contracts';
import { cases, fid, people, pilotTasks } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { personRef } from '../../mocks/data';
import { mock } from '../../mocks/define';
import { mockServer, session } from '../../mocks/node';
import { renderAt, resetAllMocks } from '../overview/test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
  resetAllMocks();
});
afterAll(() => mockServer.close());

const t1 = pilotTasks[0];
function task(status: Task['status'], rowVersion: number): Task {
  return {
    id: t1.id,
    caseId: cases[0].id,
    taskSetId: fid('taskSet', 1),
    ordinal: 1,
    title: t1.title,
    milestoneId: null,
    milestoneLabel: 'M1 · Kick-off · weeks 1–2',
    function: 'sales',
    owner: personRef(people.jonas.id),
    dependsOnTaskIds: [],
    dependsOnLabel: '—',
    dueOn: t1.dueOn,
    dueRule: null,
    deliverable: t1.deliverable,
    conditionKey: null,
    status,
    sync: {
      status: 'confirmed',
      connectionId: null,
      externalKey: 'PIL-11',
      externalUrl: null,
      attempts: 1,
      lastErrorCode: null,
      lastErrorMessage: null,
      retryable: false,
      confirmedAt: '2026-12-01T09:05:00+01:00',
    },
    rowVersion,
  };
}
function plan(): PilotPlanView {
  return {
    pilotPlanId: fid('taskSet', 9),
    status: 'active',
    baseline: null,
    current: null,
    draft: null,
    conditions: [],
    budget: null,
    taskSet: {
      id: fid('taskSet', 1),
      caseId: cases[0].id,
      ownerType: 'pilot_plan_version',
      ownerId: fid('taskSet', 9),
      authorizingGateRequestId: fid('gateRequest', 3),
      connectionId: null,
      destinationLabel: 'Jira · project PIL',
      tasks: [task('in_progress', 7)],
      summary: { total: 1, confirmed: 1, failed: 0, pending: 0, paused: 0 },
      summaryText: '1 of 1 tasks confirmed in Jira',
    },
    activationBlockers: [],
    messageDrafts: [],
    connectorBanner: null,
  };
}

describe('My Work', () => {
  it('shows the brief for the selected task and no approvals for a task owner', async () => {
    session.signIn(people.jonas.id);
    renderAt('/my-work');
    const brief = await screen.findByRole('complementary', { name: 'Confirm 4 pilot sites and contacts' });
    expect(within(brief).getByText('Brief for this task')).toBeTruthy();
    expect(
      within(brief).getByText(/limited to the 4 sites with paid commitments \(condition C1\)/),
    ).toBeTruthy();
    expect(within(brief).getByText('Budget ceiling €120k (G2 v3)')).toBeTruthy();
    expect(within(brief).getByText('Confirmed · PIL-11')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Approvals/ }));
    expect(await screen.findByText('No approvals for you')).toBeTruthy();
    expect(screen.getByText(/Owning tasks does not include approval rights\./)).toBeTruthy();
  });

  it('Mark done sends tasks.update with the task row version as If-Match', async () => {
    const seen: { ifMatch: number | null; status?: string }[] = [];
    mockServer.use(
      mock(API.pilot.get, () => plan()),
      mock(API.pilot.updateTask, ({ ifMatch, body }) => {
        seen.push({ ifMatch, status: body.status });
        return task('done', 8);
      }),
    );
    session.signIn(people.jonas.id);
    renderAt('/my-work');
    const brief = await screen.findByRole('complementary', { name: 'Confirm 4 pilot sites and contacts' });
    fireEvent.click(within(brief).getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(seen).toEqual([{ ifMatch: 7, status: 'done' }]));
  });
});

describe('Reviews inbox', () => {
  it('records a response only with a position and a reason, then lists it under Done', async () => {
    session.signIn(people.priya.id);
    renderAt('/reviews?tab=assigned');
    const panel = await screen.findByRole('region', { name: 'Does the product fit the target workflow?' });
    const record = () => within(panel).getByRole('button', { name: /Record/ }) as HTMLButtonElement;
    expect(record().disabled).toBe(true);
    fireEvent.click(within(panel).getByRole('button', { name: 'Dispute' }));
    fireEvent.change(within(panel).getByLabelText('Reason (required)'), {
      target: { value: 'Dashboards need food-plant adaptations first.' },
    });
    fireEvent.click(record());
    expect(await within(panel).findByText(/Dashboards need food-plant adaptations first\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Done/ }));
    expect(await screen.findByRole('list', { name: 'Done' })).toBeTruthy();
  });

  it('the sponsor sees the scoped gate decision first', async () => {
    session.signIn(people.elena.id);
    renderAt('/reviews');
    const list = await screen.findByRole('list', { name: 'Gate decisions awaiting you' });
    expect(within(list).getByText('Approve pilot €120k · 90 days')).toBeTruthy();
    expect(within(list).getByText('Due today, 27 Nov')).toBeTruthy();
  });
});
