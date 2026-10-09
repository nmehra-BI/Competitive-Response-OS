/**
 * Test support for the WS4a DB suites: tenant seeding, persona cookies, audit and analytics readers,
 * and the journey from aster-start to ME-104 through the real endpoints (steps 5–9).
 */
import { API, type EndpointDef } from '@growth-os/contracts';
import { withTenant, type Tx } from '@growth-os/db';
import { assumptions as fixtureAssumptions, opportunities } from '@growth-os/fixtures-aster';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type CallOptions,
  type PersonKey,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';

export interface World {
  t: TestApp;
  tenants: Record<string, SeededTenant>;
  cookie(tenant: string, who: PersonKey): Promise<string>;
  close(): Promise<void>;
}

export async function world(profiles: Record<string, 'aster-start' | 'aster-demo'>, now?: () => Date): Promise<World> {
  const t = await createTestApp(now ? { now } : {});
  const tenants: Record<string, SeededTenant> = {};
  for (const [k, p] of Object.entries(profiles)) tenants[k] = await seedTenant(t.db, p);
  const cache = new Map<string, string>();
  return {
    t,
    tenants,
    async cookie(tenant, who) {
      const k = `${tenant}:${who}`;
      if (!cache.has(k)) cache.set(k, await login(t.app, tenants[tenant]!.user(who)));
      return cache.get(k)!;
    },
    close: () => t.close(),
  };
}

export const inTenant = <T>(w: World, s: SeededTenant, fn: (tx: Tx) => Promise<T>) =>
  withTenant(w.t.db, { tenantId: s.tenantId, userId: null, correlationId: 'test' }, fn);

export async function auditFor(w: World, s: SeededTenant, objectId: string) {
  return inTenant(w, s, (tx) =>
    tx
      .selectFrom('platform.audit_event')
      .select(['action', 'summary', 'actor_kind', 'actor_role', 'object_version'])
      .where('object_id', '=', objectId)
      .orderBy('seq')
      .execute(),
  );
}

export async function analyticsFor(w: World, s: SeededTenant, name: string) {
  return inTenant(w, s, (tx) =>
    tx.selectFrom('platform.analytics_event').selectAll().where('name', '=', name).orderBy('occurred_at').execute(),
  );
}

export async function api<D extends EndpointDef>(w: World, def: D, cookie: string, o: Omit<CallOptions<D>, 'cookie'> = {}) {
  const needsKey = def.idempotent && o.idempotencyKey === undefined;
  return call(w.t.app, def, { ...o, cookie, ...(needsKey ? { idempotencyKey: true as const } : {}) });
}

export const oppId = (s: SeededTenant, key: string) => s.id(opportunities.find((o) => o.key === key)!.id);

/** Step 5: shortlist and convert OPP-07 on aster-start → ME-104 (Maya). */
export async function convertOpp07(w: World, tenant: string): Promise<string> {
  const maya = await w.cookie(tenant, 'maya');
  const s = w.tenants[tenant]!;
  const sl = await api(w, API.opportunities.shortlist, maya, { params: { ref: 'OPP-07' } });
  if (sl.statusCode !== 200) throw new Error(`shortlist ${sl.statusCode} ${sl.body}`);
  const res = await api(w, API.opportunities.convert, maya, {
    params: { ref: 'OPP-07' },
    body: { ownerId: s.user('maya') },
  });
  if (res.statusCode !== 201) throw new Error(`convert ${res.statusCode} ${res.body}`);
  return (res.json() as { case: { key: string } }).case.key;
}

/** Register the fixture assumptions on a converted case (S09) through `assumptions.create`. */
export async function registerAssumptions(w: World, tenant: string, caseKey: string): Promise<Record<string, string>> {
  const maya = await w.cookie(tenant, 'maya');
  const s = w.tenants[tenant]!;
  const ids: Record<string, string> = {};
  for (const a of fixtureAssumptions) {
    const v = a as unknown as { value: string | null; valueText?: string };
    const res = await api(w, API.assumptions.create, maya, {
      params: { caseRef: caseKey },
      body: {
        inputKey: a.inputKey,
        name: a.name,
        ownerId: s.id(a.ownerId),
        value: v.value,
        valueText: v.value === null ? (v.valueText ?? null) : null,
        unit: a.unit,
        basis: a.basis,
        sensitivity: a.sensitivity,
        decisionCritical: a.decisionCritical,
        consequenceIfFalse: a.consequenceIfFalse,
        validationMethod: a.validationMethod,
        dueOn: a.dueOn,
      },
    });
    if (res.statusCode !== 201) throw new Error(`assumption ${a.key} ${res.statusCode} ${res.body}`);
    ids[a.inputKey] = (res.json() as { id: string }).id;
  }
  return ids;
}
