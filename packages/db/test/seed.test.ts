/**
 * Seed runner (BUILD_PLAN §7). Seeds isolated copies of both profiles (fresh ids) so the suite is
 * independent of whatever the developer seeded, and checks the loaded state, the illustrative flag,
 * the hashed snapshots and tenant isolation between two seeded tenants.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EconomicsOutput, SizingOutput } from '@growth-os/contracts';
import { ECONOMICS_ENGINE_VERSION, SIZING_ENGINE_VERSION } from '@growth-os/domain';
import { expectedSizing, gates, mandate as md21, people, sources } from '@growth-os/fixtures-aster';
import { createDb, sql, withTenant, type Db } from '../src';
import { AlreadySeededError, randomRemap, seedAster, type SeedResult } from '../src/seed';
import { economicsGoldenMismatches, sizingGoldenMismatches } from '../src/seed/outputs';

let db: Db;
let start: SeedResult;
let demo: SeedResult;

beforeAll(async () => {
  db = createDb('app', 2);
  start = await seedAster(db, { profile: 'aster-start', isolated: true });
  demo = await seedAster(db, { profile: 'aster-demo', isolated: true });
});
afterAll(async () => {
  await db.destroy();
});

const inTenant = <T>(r: SeedResult, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(db, { tenantId: r.tenantId, userId: null, correlationId: 'seed-test' }, fn);

describe('aster-start', () => {
  it('marks the tenant illustrative and loads org, people, sources and connections', async () => {
    await inTenant(start, async (tx) => {
      const tenant = await tx.selectFrom('platform.tenant').selectAll().executeTakeFirstOrThrow();
      expect(tenant.illustrative).toBe(true);
      expect(tenant.name).toBe('Aster Industrial Systems');
      const users = await tx.selectFrom('platform.app_user').select(['email', 'kind']).execute();
      expect(users).toHaveLength(Object.keys(people).length);
      expect(users.filter((u) => u.kind === 'agent')).toHaveLength(1);
      const srcs = await tx.selectFrom('platform.source').select('display_key').execute();
      expect(srcs.map((s) => s.display_key).sort()).toEqual(sources.map((s) => s.key).sort());
      const conns = await tx.selectFrom('platform.connection').select('status').execute();
      expect(conns.map((c) => c.status).sort()).toEqual(
        ['connected', 'connected', 'expired', 'missing_permission', 'unavailable'].sort(),
      );
      const policies = await tx.selectFrom('platform.policy').select(['kind', 'status']).execute();
      expect(policies.filter((p) => p.kind === 'gate')).toHaveLength(5);
      expect(policies.every((p) => p.status === 'active')).toBe(true);
    });
  });

  it('has MD-21 approved at G0 on snapshot v2 (v1 returned and superseded), with hash-bound approvals', async () => {
    await inTenant(start, async (tx) => {
      const g0 = await tx
        .selectFrom('platform.gate_request')
        .selectAll()
        .where('display_key', '=', gates.g0.key)
        .executeTakeFirstOrThrow();
      expect(g0.status).toBe('approved');
      const snaps = await tx
        .selectFrom('platform.decision_snapshot')
        .select(['version', 'status', 'content_hash', 'content'])
        .where('gate_request_id', '=', g0.id)
        .orderBy('version')
        .execute();
      expect(snaps.map((s) => [s.version, s.status])).toEqual([
        [1, 'superseded'],
        [2, 'current'],
      ]);
      // D-036: a standalone G0 names the mandate as its subject.
      expect((snaps[1]!.content as { subject?: unknown }).subject).toEqual({
        type: 'mandate',
        id: start.id(md21.id),
        key: md21.key,
      });
      const approvals = await tx
        .selectFrom('platform.approval')
        .select(['disposition', 'snapshot_hash'])
        .where('gate_request_id', '=', g0.id)
        .orderBy('decided_at')
        .execute();
      expect(approvals.map((x) => x.disposition)).toEqual(['return_for_revision', 'approve']);
      expect(approvals[1]!.snapshot_hash).toBe(snaps[1]!.content_hash);
      const mandate = await tx.selectFrom('me.mandate').select(['status']).executeTakeFirstOrThrow();
      expect(mandate.status).toBe('approved');
    });
  });

  it('has detected opportunities and no ME-104 yet (the journey creates it)', async () => {
    await inTenant(start, async (tx) => {
      const opps = await tx.selectFrom('me.opportunity').select(['display_key', 'status']).execute();
      expect(opps.find((o) => o.display_key === 'OPP-07')?.status).toBe('detected');
      expect(opps.find((o) => o.display_key === 'OPP-03')?.status).toBe('dismissed');
      const cases = await tx.selectFrom('platform.workflow_case').select('display_key').execute();
      expect(cases.map((c) => c.display_key).sort()).toEqual(['ME-097', 'ME-102', 'ME-105']);
      const counter = await tx
        .selectFrom('platform.display_key_counter')
        .select('next_value')
        .where('prefix', '=', 'ME')
        .executeTakeFirstOrThrow();
      expect(counter.next_value).toBe(104);
    });
  });

  it('records the seeded history as system audit events', async () => {
    await inTenant(start, async (tx) => {
      const ev = await tx.selectFrom('platform.audit_event').select(['actor_kind', 'details']).execute();
      expect(ev.length).toBeGreaterThan(0);
      expect(ev.every((e) => e.actor_kind === 'system')).toBe(true);
      expect(ev.every((e) => (e.details as { illustrative?: boolean }).illustrative === true)).toBe(true);
    });
  });
});

describe('aster-demo', () => {
  it('places ME-104 at Pilot approval pending with G2 snapshot v3 awaiting decision', async () => {
    await inTenant(demo, async (tx) => {
      const c = await tx
        .selectFrom('platform.workflow_case')
        .selectAll()
        .where('display_key', '=', 'ME-104')
        .executeTakeFirstOrThrow();
      expect(c.stage).toBe('pilot_approval_pending');
      const g2 = await tx
        .selectFrom('platform.gate_request')
        .selectAll()
        .where('display_key', '=', gates.g2.key)
        .executeTakeFirstOrThrow();
      expect(g2.status).toBe('awaiting_decision');
      expect(g2.requested_amount).toBe('120000.00');
      const snaps = await tx
        .selectFrom('platform.decision_snapshot')
        .select(['id', 'version', 'status'])
        .where('gate_request_id', '=', g2.id)
        .orderBy('version')
        .execute();
      expect(snaps.map((s) => [s.version, s.status])).toEqual([
        [2, 'superseded'],
        [3, 'current'],
      ]);
      expect(g2.current_snapshot_id).toBe(snaps[1]!.id);
      const positions = await tx
        .selectFrom('platform.reviewer_position')
        .select('area')
        .where('snapshot_id', '=', snaps[1]!.id)
        .execute();
      expect(positions.map((p) => p.area).sort()).toEqual([
        'finance',
        'pilot_owner',
        'product',
        'specialist',
      ]);
      const g1 = await tx
        .selectFrom('platform.gate_request')
        .select('status')
        .where('display_key', '=', gates.g1.key)
        .executeTakeFirstOrThrow();
      expect(g1.status).toBe('approved');
    });
  });

  it('stores canonical snapshot content whose hash the database re-verifies', async () => {
    await inTenant(demo, async (tx) => {
      const r = await sql<{ ok: boolean; n: string }>`
        SELECT bool_and(content_hash = encode(sha256(convert_to(content_canonical, 'UTF8')), 'hex')) AS ok,
               count(*)::text AS n
          FROM platform.decision_snapshot`.execute(tx);
      expect(r.rows[0]).toEqual({ ok: true, n: '5' });
    });
  });

  it('commits sizing v2 and economics v2 with the PRD §6 numbers', async () => {
    await inTenant(demo, async (tx) => {
      const calc = await tx
        .selectFrom('platform.calculation_result')
        .select(['engine', 'engine_version', 'output', 'blocked'])
        .orderBy('engine')
        .execute();
      expect(calc.map((x) => x.engine)).toEqual(['economics', 'sizing']);
      // Produced by the real WS2 engines (no "+aster-golden" stand-in) and equal to every golden value.
      expect(calc.map((x) => x.engine_version)).toEqual([ECONOMICS_ENGINE_VERSION, SIZING_ENGINE_VERSION]);
      expect(calc.every((x) => !x.blocked)).toBe(true);
      expect(economicsGoldenMismatches(EconomicsOutput.parse(calc[0]!.output))).toEqual([]);
      expect(sizingGoldenMismatches(SizingOutput.parse(calc[1]!.output))).toEqual([]);
      expect(SizingOutput.parse(calc[1]!.output).lineage.length).toBeGreaterThan(0);
      const sizing = calc[1]!.output as {
        ladder: { tam: { value: { amount: string } }; sam: { value: { amount: string } } };
      };
      expect(sizing.ladder.tam.value.amount).toBe(expectedSizing.tam.value);
      expect(sizing.ladder.sam.value.amount).toBe(expectedSizing.sam.value);
      const sv = await tx
        .selectFrom('me.sizing_version')
        .select(['version', 'state'])
        .executeTakeFirstOrThrow();
      expect(sv).toEqual({ version: 2, state: 'committed' });
    });
  });

  it('has EXP-03 with the original plan kept, amendment 1 and recorded results; VAL-1…5 confirmed', async () => {
    await inTenant(demo, async (tx) => {
      const plans = await tx
        .selectFrom('me.experiment_plan_version')
        .select(['version', 'is_original', 'window_end'])
        .orderBy('version')
        .execute();
      expect(plans.map((p) => [p.version, p.is_original, p.window_end])).toEqual([
        [1, true, '2026-11-13'],
        [2, false, '2026-11-20'],
      ]);
      const links = await tx
        .selectFrom('platform.external_task_link')
        .select(['sync_status', 'external_key'])
        .execute();
      expect(links.map((l) => l.external_key).sort()).toEqual(['VAL-1', 'VAL-2', 'VAL-3', 'VAL-4', 'VAL-5']);
      expect(links.every((l) => l.sync_status === 'confirmed')).toBe(true);
    });
  });
});

describe('isolation and re-seeding', () => {
  it('keeps two seeded tenants apart under RLS', async () => {
    const seen = await inTenant(start, (tx) =>
      tx.selectFrom('platform.workflow_case').select('id').execute(),
    );
    const demoCases = await inTenant(demo, (tx) =>
      tx.selectFrom('platform.workflow_case').select('id').execute(),
    );
    const overlap = seen.filter((x) => demoCases.some((y) => y.id === x.id));
    expect(overlap).toEqual([]);
    const none = await db.selectFrom('platform.workflow_case').select('id').execute();
    expect(none).toEqual([]); // no tenant context → no rows
  });

  it('refuses to seed the same tenant twice', async () => {
    const remap = randomRemap();
    await seedAster(db, { profile: 'aster-start', remap });
    await expect(seedAster(db, { profile: 'aster-demo', remap })).rejects.toBeInstanceOf(AlreadySeededError);
  });
});
