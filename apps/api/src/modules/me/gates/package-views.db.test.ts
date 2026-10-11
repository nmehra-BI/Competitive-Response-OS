/**
 * "Changes since v3, which you viewed on …" (DecisionPackageView.changesSince, D-068 §9, D-078): the
 * package remembers the version each person last opened. Runs the real WS4a assumption commit and the
 * WS4b refresh, so the change Elena sees is the one materiality recorded.
 */
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
import { ids, inTenant } from './testkit';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const k: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-demo');
  for (const p of ['maya', 'elena', 'daniel'] as const) k[p] = await login(t.app, a.user(p));
  k.elenaB = await login(t.app, b.user('elena'));
});
afterAll(async () => {
  await t.close();
});

const open = async (cookie: string, query?: { version?: number }) => {
  const res = await call(t.app, API.gates.package, { params: { id: ids(a).g2 }, query, cookie });
  expect(res.statusCode).toBe(200);
  return API.gates.package.response.parse(res.json());
};

describe('package read receipts (D-078)', () => {
  it('first open: no "since"; a second open of the same version lists no changes', async () => {
    const first = await open(k.elena!);
    expect(first.snapshot.version).toBe(3);
    expect(first.changesSince).toBeNull();
    const second = await open(k.elena!);
    expect(second.changesSince).toMatchObject({ sinceVersion: 3 });
    expect(second.changesSinceViewerLastSaw).toEqual([]);
    // Receipts are per person and never cross tenants.
    expect((await open(k.daniel!)).changesSince).toBeNull();
    const other = await call(t.app, API.gates.package, { params: { id: ids(a).g2 }, cookie: k.elenaB });
    expect(other.statusCode).toBe(404);
  });

  it('after an assumption commit and a refresh, Elena sees the changes since the v3 she viewed', async () => {
    const list = API.assumptions.list.response.parse(
      (await call(t.app, API.assumptions.list, { params: { caseRef: 'ME-104' }, cookie: k.maya })).json(),
    );
    const asm = list.items.find((x) => x.key === 'ASM-01')!;
    const upd = await call(t.app, API.assumptions.update, {
      params: { id: asm.id },
      ifMatch: asm.rowVersion,
      body: { value: '0.25', changeReason: 'Two more paid commitments' },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(upd.statusCode).toBe(200);
    const refreshed = await call(t.app, API.gates.refresh, {
      params: { id: ids(a).g2 },
      cookie: k.maya,
      idempotencyKey: true,
    });
    expect(refreshed.statusCode).toBe(200);
    const pkg = await open(k.elena!);
    expect(pkg.snapshot.version).toBe(4);
    expect(pkg.changesSince).toMatchObject({ sinceVersion: 3 });
    expect(pkg.changesSinceViewerLastSaw.some((l) => l.startsWith('Adoption 20% by year 3: 20% → 25%'))).toBe(
      true,
    );
    // Opening an older version on purpose does not move the receipt back.
    await open(k.elena!, { version: 3 });
    expect((await open(k.elena!)).changesSince).toMatchObject({ sinceVersion: 4 });
    const rows = await inTenant(t, a, (tx) =>
      tx.selectFrom('platform.audit_event').select('action').where('action', 'like', '%view%').execute(),
    );
    expect(rows).toEqual([]); // a read receipt is never audited
  });
});
