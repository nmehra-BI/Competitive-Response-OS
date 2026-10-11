/**
 * Screen mocks load in folder order and the first matching handler wins, so endpoints that
 * several streams answer are claimed by id (D-061). This pins the claim table: each request goes
 * to the journey that owns its id, and nothing shadows another stream's ids.
 */
import { API } from '@growth-os/contracts';
import { adoptionDispute, gates, opportunities, people } from '@growth-os/fixtures-aster';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api } from '../lib/api-client';
import { TASK_SET_ID as PIL_TASK_SET } from '../screens/pilot/mocks';
import { tasks as pilotTaskRows } from '../screens/pilot/mocks';
import { TASK_SET_ID as VAL_TASK_SET } from '../screens/validation/mock-data';
import { mockServer, resetMockState, resetReplay, session } from './node';
import { resetAllMocks } from '../screens/overview/test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  resetMockState();
  resetReplay();
  resetAllMocks();
});
afterAll(() => mockServer.close());

let n = 0;
const key = () => `precedence-${++n}`;

describe('shared endpoint claims', () => {
  it('gates.get / package: G0 → mandate mocks, G1/G2 → decisions mocks', async () => {
    session.signIn(people.maya.id);
    const md = await api(API.mandates.get, { params: { ref: 'MD-21' } });
    const g0 = await api(API.gates.get, { params: { id: md.g0GateRequestId! } });
    expect(g0.gateCode).toBe('G0');
    const g2 = await api(API.gates.get, { params: { id: gates.g2.id } });
    expect(g2.gateCode).toBe('G2');
    const pkg = await api(API.gates.package, { params: { id: md.g0GateRequestId! }, query: {} });
    expect(pkg.gateRequest.gateCode).toBe('G0');
  });

  it('gates.preconditions: G1/G2 → decisions, X → outcomes, G3 → WS7 base', async () => {
    session.signIn(people.maya.id);
    for (const gateCode of ['G1', 'G2', 'G3', 'X'] as const) {
      const v = await api(API.gates.rail, { params: { caseRef: 'ME-104', gateCode } });
      expect(v.gateCode).toBe(gateCode);
    }
  });

  it('cases.header: a case converted in this tab belongs to the discovery mocks', async () => {
    session.signIn(people.maya.id);
    const before = await api(API.cases.header, { params: { caseRef: 'ME-104' } });
    expect(before.case.stage).not.toBe('discovery');
    const opp07 = opportunities.find((o) => o.key === 'OPP-07')!;
    await api(API.opportunities.shortlist, { params: { ref: opp07.key }, idempotencyKey: key() });
    await api(API.opportunities.convert, {
      params: { ref: opp07.key },
      body: { ownerId: people.maya.id },
      idempotencyKey: key(),
    });
    const after = await api(API.cases.header, { params: { caseRef: 'ME-104' } });
    expect(after.case.stage).toBe('discovery');
  });

  it('taskSync.get: the PIL set → pilot mocks, the VAL set → validation mocks', async () => {
    session.signIn(people.jonas.id);
    const pil = await api(API.taskSync.get, { params: { id: PIL_TASK_SET } });
    expect(pil.id).toBe(PIL_TASK_SET);
    session.signIn(people.maya.id);
    const val = await api(API.taskSync.get, { params: { id: VAL_TASK_SET } });
    expect(val.id).toBe(VAL_TASK_SET);
  });

  it('one assumption register: an S09 reply shows in the S08 thread', async () => {
    session.signIn(people.daniel.id);
    await api(API.assumptions.replyToChallenge, {
      params: { id: adoptionDispute.id },
      body: { body: 'Ten percent is the conservative read.' },
      idempotencyKey: key(),
    });
    const list = await api(API.assumptions.list, { params: { caseRef: 'ME-104' } });
    const adoption = list.items.find((a) => a.key === 'ASM-01')!;
    expect(adoption.openDispute?.replies.at(-1)?.body).toBe('Ten percent is the conservative read.');
    expect(adoption.usedBy.length).toBeGreaterThan(0);
  });

  it('tasks.update (My Work, S11): pilot mocks own the PIL tasks and check the row version', async () => {
    session.signIn(people.jonas.id);
    const plan = await api(API.pilot.get, { params: { caseRef: 'ME-104' } });
    const t = plan.taskSet!.tasks[0]!;
    const done = await api(API.pilot.updateTask, {
      params: { id: t.id },
      body: { status: 'done' },
      ifMatch: t.rowVersion,
    });
    expect(done.status).toBe('done');
    expect(done.rowVersion).toBe(t.rowVersion + 1);
    expect(done.sync).toEqual(t.sync); // internal status never changes the external sync status
    expect(pilotTaskRows()[0]!.status).toBe('done');
    await expect(
      api(API.pilot.updateTask, {
        params: { id: t.id },
        body: { status: 'in_progress' },
        ifMatch: t.rowVersion,
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});
