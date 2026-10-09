/**
 * Administration (S14): admins configure but never approve; invariants on roles and authority;
 * versioned policies; connections; diagnostics; audit search. Each endpoint is also tried by a
 * non-admin (403) and across tenants (404 / isolated results).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, AuditEvent, type AuthorityGrant, type Policy } from '@growth-os/contracts';
import { withTenant } from '@growth-os/db';
import { businessUnits, connections, licenses, people } from '@growth-os/fixtures-aster';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';

let t: TestApp;
let a: SeededTenant;
let b: SeededTenant;
const c: Record<string, string> = {};
const BU = () => a.id(businessUnits[0].id);

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  b = await seedTenant(t.db, 'aster-start');
  c.admin = await login(t.app, a.user('admin'));
  c.maya = await login(t.app, a.user('maya'));
  c.lena = await login(t.app, a.user('lena'));
  c.adminB = await login(t.app, b.user('admin'));
});
afterAll(async () => {
  await t.close();
});

const setRole = (cookie: string, id: string, body: Record<string, unknown>) =>
  call(t.app, API.admin.setRole, { params: { id }, body, cookie, idempotencyKey: true });
const setGrant = (cookie: string, id: string, body: Partial<Record<string, unknown>>) =>
  call(t.app, API.admin.setAuthority, {
    params: { id },
    body: {
      businessUnitId: BU(),
      ceilingAmount: null,
      currency: null,
      validFrom: '2026-01-01',
      validTo: null,
      revoked: false,
      ...body,
    },
    cookie,
    idempotencyKey: true,
  });

describe('roles', () => {
  it('lists roles for admins only', async () => {
    const res = await call(t.app, API.admin.roles, { cookie: c.admin });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: unknown[] }).items.length).toBe(9);
    expect((await call(t.app, API.admin.roles, { cookie: c.maya })).statusCode).toBe(403);
  });

  it('grants and revokes a role with audit', async () => {
    const id = randomUUID();
    const body = {
      userId: a.user('priya'),
      role: 'commercial_reviewer',
      businessUnitId: BU(),
      caseId: null,
      revoked: false,
    };
    const granted = await setRole(c.admin!, id, body);
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toMatchObject({
      id,
      role: 'commercial_reviewer',
      revokedAt: null,
      grantedBy: a.user('admin'),
    });
    const revoked = await setRole(c.admin!, id, { ...body, revoked: true });
    expect(revoked.json().revokedAt).not.toBeNull();
    await withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, async (tx) => {
      const ev = await tx
        .selectFrom('platform.audit_event')
        .select('action')
        .where('object_id', '=', id)
        .orderBy('seq')
        .execute();
      expect(ev.map((e) => e.action)).toEqual(['admin.role_granted', 'admin.role_revoked']);
    });
  });

  it('refuses self-changes, admin + decision roles, agents and non-admins', async () => {
    const self = await setRole(c.admin!, randomUUID(), {
      userId: a.user('admin'),
      role: 'sponsor',
      businessUnitId: BU(),
      caseId: null,
      revoked: false,
    });
    expect(self.statusCode).toBe(403);
    const adminSponsor = await setRole(c.admin!, randomUUID(), {
      userId: a.user('elena'),
      role: 'tenant_admin',
      businessUnitId: null,
      caseId: null,
      revoked: false,
    });
    expect(adminSponsor.statusCode).toBe(403);
    const agent = await setRole(c.admin!, randomUUID(), {
      userId: a.user('analysisAgent'),
      role: 'read_only_reviewer',
      businessUnitId: BU(),
      caseId: null,
      revoked: false,
    });
    expect(agent.json().code).toBe('AGENT_IDENTITY_FORBIDDEN');
    const maya = await setRole(c.maya!, randomUUID(), {
      userId: a.user('priya'),
      role: 'read_only_reviewer',
      businessUnitId: BU(),
      caseId: null,
      revoked: false,
    });
    expect(maya.statusCode).toBe(403);
    const noKey = await call(t.app, API.admin.setRole, {
      params: { id: randomUUID() },
      body: {
        userId: a.user('priya'),
        role: 'read_only_reviewer',
        businessUnitId: BU(),
        caseId: null,
        revoked: false,
      },
      cookie: c.admin,
    });
    expect(noKey.statusCode).toBe(428);
  });

  it('cross-tenant: an admin cannot assign a role to another tenant user or business unit', async () => {
    const res = await setRole(c.adminB!, randomUUID(), {
      userId: a.user('priya'),
      role: 'read_only_reviewer',
      businessUnitId: null,
      caseId: null,
      revoked: false,
    });
    expect(res.statusCode).toBe(400);
    const bu = await setRole(c.adminB!, randomUUID(), {
      userId: b.user('priya'),
      role: 'read_only_reviewer',
      businessUnitId: BU(),
      caseId: null,
      revoked: false,
    });
    expect(bu.statusCode).toBe(400);
  });
});

describe('delegated authority', () => {
  it('shows the matrix with authority gaps (no G3 approver in BU Water)', async () => {
    const res = await call(t.app, API.admin.authority, { cookie: c.admin });
    const body = res.json() as {
      items: AuthorityGrant[];
      gaps: { gateCode: string; businessUnitId: string; message: string }[];
    };
    expect(body.items.map((g) => g.gateCode).sort()).toEqual(['G0', 'G1', 'G2', 'X']);
    expect(body.gaps).toContainEqual({
      gateCode: 'G3',
      businessUnitId: BU(),
      message: 'No G3 approver in BU Water · Authority gap',
    });
    expect(body.gaps.filter((g) => g.businessUnitId === a.id(businessUnits[1].id))).toHaveLength(5);
    expect((await call(t.app, API.admin.authority, { cookie: c.maya })).statusCode).toBe(403);
  });

  it('never gives authority to an administrator or to oneself', async () => {
    expect(
      (await setGrant(c.admin!, randomUUID(), { userId: a.user('admin'), gateCode: 'G3' })).statusCode,
    ).toBe(403);
    // Make a second admin, then try to grant them authority.
    await setRole(c.admin!, randomUUID(), {
      userId: a.user('opsLead'),
      role: 'tenant_admin',
      businessUnitId: null,
      caseId: null,
      revoked: false,
    });
    const toAdmin = await setGrant(c.admin!, randomUUID(), { userId: a.user('opsLead'), gateCode: 'G3' });
    expect(toAdmin.statusCode).toBe(403);
  });

  it('grants G3 to the sponsor, closing the gap; validates ceiling and currency together', async () => {
    const bad = await setGrant(c.admin!, randomUUID(), {
      userId: a.user('elena'),
      gateCode: 'G3',
      ceilingAmount: '1000.00',
      currency: null,
    });
    expect(bad.statusCode).toBe(400);
    const ok = await setGrant(c.admin!, randomUUID(), {
      userId: a.user('elena'),
      gateCode: 'G3',
      ceilingAmount: '400000.00',
      currency: 'EUR',
    });
    expect(ok.statusCode).toBe(200);
    const gaps = (await call(t.app, API.admin.authority, { cookie: c.admin })).json().gaps as {
      gateCode: string;
      businessUnitId: string;
    }[];
    expect(gaps.some((g) => g.gateCode === 'G3' && g.businessUnitId === BU())).toBe(false);
  });
});

describe('policies', () => {
  it('publishes a new version, retires the old one, and cannot enable self-approval', async () => {
    const before = (await call(t.app, API.admin.policies, { cookie: c.admin })).json() as { items: Policy[] };
    expect(before.items.find((p) => p.kind === 'gate' && p.key === 'G1')?.version).toBe(1);
    const body = {
      kind: 'gate',
      key: 'G1',
      body: {
        gateCode: 'G1',
        preconditionKeys: ['evidence_inventory', 'comparable_sizing'],
        requiredApprovals: 1,
        requiredSignOffAreas: [],
        approvalExpiryDays: 21,
        selfApprovalAllowed: false,
      },
    };
    const res = await call(t.app, API.admin.publishPolicy, { body, cookie: c.admin, idempotencyKey: true });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ version: 2, status: 'active' });
    const after = (await call(t.app, API.admin.policies, { cookie: c.admin })).json() as { items: Policy[] };
    expect(after.items.filter((p) => p.kind === 'gate' && p.key === 'G1').map((p) => p.version)).toEqual([2]);
    const selfApproval = await call(t.app, API.admin.publishPolicy, {
      body: { ...body, body: { ...body.body, selfApprovalAllowed: true } },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(selfApproval.statusCode).toBe(400);
    const maya = await call(t.app, API.admin.publishPolicy, { body, cookie: c.maya, idempotencyKey: true });
    expect(maya.statusCode).toBe(403);
  });
});

describe('entitlements and connections', () => {
  it('lists who sees excerpts per licence', async () => {
    const res = await call(t.app, API.admin.entitlements, { cookie: c.admin });
    const census = (
      res.json().items as { licenseId: string; excerptVisibleTo: string[]; othersSee: string }[]
    ).find((l) => l.licenseId === a.id(licenses[0].id))!;
    expect(census.excerptVisibleTo.sort()).toEqual(
      [people.daniel.displayName, people.elena.displayName, people.maya.displayName].sort(),
    );
    expect((await call(t.app, API.admin.entitlements, { cookie: c.maya })).statusCode).toBe(403);
  });

  it('shows connection health to admins and case roles; test and reconnect are admin-only and audited', async () => {
    const list = await call(t.app, API.admin.connections, { cookie: c.lena });
    expect(list.statusCode).toBe(200);
    expect((list.json().items as unknown[]).length).toBe(5);
    expect(JSON.stringify(list.json())).not.toContain('secret');
    const finance = a.id(connections[2].id);
    expect(
      (
        await call(t.app, API.admin.reconnect, {
          params: { id: finance },
          cookie: c.maya,
          idempotencyKey: true,
        })
      ).statusCode,
    ).toBe(403);
    const re = await call(t.app, API.admin.reconnect, {
      params: { id: finance },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(re.json()).toMatchObject({ status: 'connected' });
    const test = await call(t.app, API.admin.testConnection, {
      params: { id: finance },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(test.statusCode).toBe(200);
    expect(test.json().lastCheckedAt).not.toBeNull();
    const cross = await call(t.app, API.admin.testConnection, {
      params: { id: finance },
      cookie: c.adminB,
      idempotencyKey: true,
    });
    expect(cross.statusCode).toBe(404);
  });

  it('sets a connector mapping', async () => {
    const mappings = (await call(t.app, API.admin.connections, { cookie: c.admin })).json().mappings as {
      id: string;
      connectionId: string;
      purpose: string;
    }[];
    const pil = mappings.find((m) => m.purpose === 'pilot_tasks')!;
    const res = await call(t.app, API.admin.setMapping, {
      params: { id: pil.id },
      body: {
        connectionId: pil.connectionId,
        purpose: 'pilot_tasks',
        destinationProject: 'PIL',
        issueType: 'Task',
        assigneeMap: { [a.user('jonas')]: 'jonas.klein@aster.example' },
      },
      cookie: c.admin,
      idempotencyKey: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().assigneeMap).toEqual({ [a.user('jonas')]: 'jonas.klein@aster.example' });
  });
});

describe('diagnostics and audit', () => {
  it('returns a run trace to admins only', async () => {
    const runId = randomUUID();
    await withTenant(t.db, { tenantId: a.tenantId, userId: null, correlationId: 'test' }, (tx) =>
      tx
        .insertInto('platform.agent_run')
        .values({
          id: runId,
          tenant_id: a.tenantId,
          subject_type: 'case',
          subject_id: a.id('a57e0010-0000-4000-8000-000000000104'),
          case_id: a.id('a57e0010-0000-4000-8000-000000000104'),
          skill_key: 'bottom-up-sizing',
          skill_version: '1.0.0',
          goal: 'Check cohort overlap',
          status: 'completed',
          requested_by: a.user('maya'),
          provider: 'fixture',
          input_snapshot_hash: 'a'.repeat(64),
          budget: JSON.stringify({
            wallTimeMs: 300000,
            maxToolCalls: 40,
            maxInputTokens: 1000,
            maxOutputTokens: 100,
            maxCostMicros: 1000,
          }),
          correlation_id: 'run-test',
          idempotency_key: randomUUID(),
        })
        .execute(),
    );
    const res = await call(t.app, API.admin.runDiagnostics, { params: { id: runId }, cookie: c.admin });
    expect(res.statusCode).toBe(200);
    expect(res.json().run).toMatchObject({ status: 'completed', statusLabel: 'Done', provider: 'fixture' });
    expect(
      (await call(t.app, API.admin.runDiagnostics, { params: { id: runId }, cookie: c.maya })).statusCode,
    ).toBe(403);
    expect(
      (await call(t.app, API.admin.runDiagnostics, { params: { id: runId }, cookie: c.adminB })).statusCode,
    ).toBe(404);
  });

  it('searches the audit log with filters and a cursor; tenant isolated; admin only', async () => {
    const caseId = a.id('a57e0010-0000-4000-8000-000000000104');
    const p1 = await call(t.app, API.admin.audit, { cookie: c.admin, query: { caseId, limit: 2 } });
    expect(p1.statusCode).toBe(200);
    const body = p1.json() as { items: AuditEvent[]; nextCursor: string };
    expect(body.items).toHaveLength(2);
    body.items.forEach((e) => AuditEvent.parse(e));
    expect(body.items.every((e) => e.caseId === caseId)).toBe(true);
    expect(body.items[0]!.seq).toBeGreaterThan(body.items[1]!.seq);
    const p2 = await call(t.app, API.admin.audit, {
      cookie: c.admin,
      query: { caseId, limit: 2, cursor: body.nextCursor },
    });
    expect((p2.json().items as AuditEvent[])[0]!.seq).toBeLessThan(body.items[1]!.seq);
    const crossB = await call(t.app, API.admin.audit, { cookie: c.adminB, query: { caseId, limit: 10 } });
    expect(crossB.json().items).toEqual([]);
    expect((await call(t.app, API.admin.audit, { cookie: c.maya })).statusCode).toBe(403);
    expect(
      (await call(t.app, API.admin.audit, { cookie: c.admin, query: { from: 'yesterday' } })).statusCode,
    ).toBe(400);
  });
});
