/** My Work: the viewer's tasks, conditions, reviews and decisions; task ownership never grants approval. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';
import { agentCookie, approveG2, type Cookies } from '../../me/gates/testkit';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const k = {} as Cookies;

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const p of ['elena', 'jonas', 'admin'] as const) k[p] = await login(t.app, a.user(p));
  k.jonasB = await login(t.app, b.user('jonas'));
  k.agent = await agentCookie(t, a);
});
afterAll(async () => {
  await t.close();
});

const mine = async (cookie: string, tab?: 'tasks' | 'reviews' | 'done') => {
  const res = await call(t.app, API.work.myWork, { query: { tab }, cookie });
  expect(res.statusCode).toBe(200);
  return API.work.myWork.response.parse(res.json());
};

describe('work.mine', () => {
  it('Elena’s reviews tab carries the G2 decision; she gets no "approve nothing" notice', async () => {
    const w = await mine(k.elena, 'reviews');
    expect(w.items.map((x) => [x.kind, x.title])).toEqual([
      ['gate_decision', 'Approve pilot €120k · 90 days'],
    ]);
    expect(w.approvalsNotice).toBeNull();
  });

  it('Jonas sees his pilot tasks with the brief, his conditions after approval, and the notice', async () => {
    await approveG2(t, a);
    const w = await mine(k.jonas);
    expect(w.approvalsNotice).toMatch(/^You approve nothing in this workspace/);
    const tasks = w.items.filter(
      (x) => x.kind === 'task' && x.caseKey === 'ME-104' && x.href.includes('/pilot'),
    );
    expect(tasks.length).toBe(3);
    expect(tasks[0]!.brief).toMatchObject({
      gateText: 'Authorized by ME-104-G2 · Approved with conditions',
      syncText: 'Not sent to the task tool',
    });
    expect(tasks[0]!.brief!.stayInside).toContain('Not scale');
    // A task item's id is the task id and its rowVersion is the tasks.update If-Match (D-068).
    expect(tasks.every((x) => typeof x.rowVersion === 'number')).toBe(true);
    const upd = await call(t.app, API.pilot.updateTask, {
      params: { id: tasks[0]!.id },
      body: { status: 'in_progress' },
      cookie: k.jonas,
      ifMatch: tasks[0]!.rowVersion!,
    });
    expect(upd.statusCode).toBe(200);
    const again = (await mine(k.jonas)).items.find((x) => x.id === tasks[0]!.id)!;
    expect(again.rowVersion).toBe(tasks[0]!.rowVersion! + 1);
    expect(w.items.filter((x) => x.kind === 'condition').map((x) => x.title.slice(0, 2))).toEqual([
      'C1',
      'C2',
    ]);
    const done = await mine(k.jonas, 'done');
    expect(done.items.filter((x) => x.kind === 'task').length).toBe(3); // VAL-2…4, done under G1
    expect(w.tabs.find((x) => x.key === 'done')!.count).toBe(done.items.length);
    // Jonas owns tasks but approves nothing: no gate decision items.
    expect((await mine(k.jonas, 'reviews')).items.filter((x) => x.kind === 'gate_decision')).toEqual([]);
  });

  it('other tenants, admins and agents see nothing of tenant A', async () => {
    expect((await mine(k.jonasB)).items.every((x) => !x.href.includes('decisions'))).toBe(true);
    const admin = await mine(k.admin);
    expect(admin.items).toEqual([]);
    const agent = await call(t.app, API.work.myWork, { cookie: k.agent });
    expect(API.work.myWork.response.parse(agent.json()).items).toEqual([]);
  });
});
