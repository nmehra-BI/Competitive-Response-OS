/**
 * Database-level guarantees (defence in depth for ME-11, ME-16, ME-17). Runs as the app role,
 * each test inside a transaction that is rolled back. Requires `pnpm db:up && pnpm db:migrate`.
 * Part of release-gate suites security/approval-db and security/tenancy-db (ARCHITECTURE.md §15).
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_URLS } from '../src/config';

let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client({ connectionString: DB_URLS.app });
  await client.connect();
});
afterAll(async () => {
  await client.end();
});

interface World {
  tenant: string;
  bu: string;
  owner: string;
  sponsor: string;
  agent: string;
  caseId: string;
  gate: string;
  snapshot: string;
  hash: string;
  ownerSession: string;
  sponsorSession: string;
  agentSession: string;
  grant: string;
}

async function inTx(fn: (w: World) => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    const w: World = {
      tenant: randomUUID(),
      bu: randomUUID(),
      owner: randomUUID(),
      sponsor: randomUUID(),
      agent: randomUUID(),
      caseId: randomUUID(),
      gate: randomUUID(),
      snapshot: randomUUID(),
      hash: '',
      ownerSession: randomUUID(),
      sponsorSession: randomUUID(),
      agentSession: randomUUID(),
      grant: randomUUID(),
    };
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [w.tenant]);
    await client.query(`INSERT INTO platform.tenant(id, slug, name) VALUES ($1, $2, 'T')`, [
      w.tenant,
      `t-${w.tenant}`,
    ]);
    await client.query(
      `INSERT INTO platform.business_unit(id, tenant_id, key, name) VALUES ($1, $2, 'water', 'BU Water')`,
      [w.bu, w.tenant],
    );
    await client.query(
      `INSERT INTO platform.app_user(id, tenant_id, email, display_name, initials, kind) VALUES
        ($1, $4, 'maya@x', 'Maya', 'MR', 'human'), ($2, $4, 'elena@x', 'Elena', 'EF', 'human'), ($3, $4, 'agent@x', 'Agent', 'AI', 'agent')`,
      [w.owner, w.sponsor, w.agent, w.tenant],
    );
    await client.query(
      `INSERT INTO platform.workflow_case(id, tenant_id, app_type, display_key, title, business_unit_id, owner_user_id, sponsor_user_id, stage, origin_type, created_by)
       VALUES ($1, $2, 'market_expansion', 'ME-104', 't', $3, $4, $5, 'pilot_approval_pending', 'direct', $4)`,
      [w.caseId, w.tenant, w.bu, w.owner, w.sponsor],
    );
    await client.query(
      `INSERT INTO platform.gate_request(id, tenant_id, display_key, case_id, subject_type, subject_id, business_unit_id, gate_code, status, scope, requested_amount, currency, created_by)
       VALUES ($1, $2, 'ME-104-G2', $3, 'case', $3, $4, 'G2', 'awaiting_decision', '{}', 120000, 'EUR', $5)`,
      [w.gate, w.tenant, w.caseId, w.bu, w.owner],
    );
    const canonical = '{"ask":"Approve pilot €120k · 90 days"}';
    const r = await client.query<{ hash: string }>(
      `INSERT INTO platform.decision_snapshot(id, tenant_id, gate_request_id, case_id, version, subject_id, content_canonical, content_hash, created_by)
       VALUES ($1, $2, $3, $4, 3, $4, $5, encode(sha256(convert_to($5, 'UTF8')), 'hex'), $6) RETURNING content_hash AS hash`,
      [w.snapshot, w.tenant, w.gate, w.caseId, canonical, w.owner],
    );
    w.hash = r.rows[0]!.hash;
    await client.query(
      `INSERT INTO platform.session(id, tenant_id, user_id, token_hash, auth_method, expires_at) VALUES
        ($1, $4, $5, $8, 'dev_persona', now() + interval '1 day'),
        ($2, $4, $6, $9, 'dev_persona', now() + interval '1 day'),
        ($3, $4, $7, $10, 'dev_persona', now() + interval '1 day')`,
      [
        w.ownerSession,
        w.sponsorSession,
        w.agentSession,
        w.tenant,
        w.owner,
        w.sponsor,
        w.agent,
        `h-${w.ownerSession}`,
        `h-${w.sponsorSession}`,
        `h-${w.agentSession}`,
      ],
    );
    await client.query(
      `INSERT INTO platform.authority_grant(id, tenant_id, user_id, gate_code, business_unit_id, ceiling_amount, currency, valid_from, granted_by)
       VALUES ($1, $2, $3, 'G2', $4, 250000, 'EUR', '2026-01-01', $3)`,
      [w.grant, w.tenant, w.sponsor, w.bu],
    );
    await fn(w);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function expectSqlError(run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  await client.query('SAVEPOINT s');
  try {
    await run();
    throw new Error('expected the statement to fail');
  } catch (err) {
    expect((err as Error).message).toMatch(pattern);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT s');
  }
}

const approve = (
  w: World,
  approver: string,
  session: string,
  hash: string,
  key: string,
  disposition = 'approve',
  grant: string | null = w.grant,
) =>
  client.query(
    `INSERT INTO platform.approval(tenant_id, gate_request_id, snapshot_id, snapshot_hash, approver_user_id, approver_role, authority_grant_id, session_id, disposition, rationale, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, 'sponsor', $6, $7, $8, 'Bounded pilot', $9)`,
    [w.tenant, w.gate, w.snapshot, hash, approver, grant, session, disposition, key],
  );

describe('tenancy (RLS)', () => {
  it('shows no rows without a tenant context and refuses cross-tenant writes', async () => {
    await inTx(async (w) => {
      expect((await client.query('SELECT count(*)::int AS n FROM platform.workflow_case')).rows[0].n).toBe(1);
      await client.query(`SELECT set_config('app.tenant_id', '', true)`);
      expect((await client.query('SELECT count(*)::int AS n FROM platform.workflow_case')).rows[0].n).toBe(0);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [w.tenant]);
      await expectSqlError(
        () =>
          client.query(`INSERT INTO platform.business_unit(tenant_id, key, name) VALUES ($1, 'x', 'x')`, [
            randomUUID(),
          ]),
        /row-level security/,
      );
    });
  });
});

describe('approval integrity', () => {
  it('accepts the sponsor with authority on the current snapshot hash', async () => {
    await inTx(async (w) => {
      await approve(w, w.sponsor, w.sponsorSession, w.hash, 'k-ok');
    });
  });

  it('refuses the case owner / package author', async () => {
    await inTx(async (w) => {
      await expectSqlError(
        () => approve(w, w.owner, w.ownerSession, w.hash, 'k1'),
        /SELF_APPROVAL_PROHIBITED/,
      );
    });
  });

  it('refuses an agent identity', async () => {
    await inTx(async (w) => {
      await expectSqlError(
        () => approve(w, w.agent, w.agentSession, w.hash, 'k2'),
        /AGENT_IDENTITY_FORBIDDEN/,
      );
    });
  });

  it('refuses a decision made through someone else’s session', async () => {
    await inTx(async (w) => {
      await expectSqlError(
        () => approve(w, w.sponsor, w.ownerSession, w.hash, 'k3'),
        /AGENT_IDENTITY_FORBIDDEN/,
      );
    });
  });

  it('refuses a hash that is not the snapshot hash', async () => {
    await inTx(async (w) => {
      await expectSqlError(
        () => approve(w, w.sponsor, w.sponsorSession, '1'.repeat(64), 'k4'),
        /foreign key/,
      );
    });
  });

  it('refuses approval without an authority grant', async () => {
    await inTx(async (w) => {
      await expectSqlError(
        () => approve(w, w.sponsor, w.sponsorSession, w.hash, 'k5', 'approve', null),
        /check constraint|AUTHORITY_INSUFFICIENT/,
      );
    });
  });

  it('refuses any decision on a stale snapshot', async () => {
    await inTx(async (w) => {
      await client.query(
        `UPDATE platform.decision_snapshot SET status = 'stale', stale_reason = 'adoption changed', stale_at = now() WHERE id = $1`,
        [w.snapshot],
      );
      await expectSqlError(() => approve(w, w.sponsor, w.sponsorSession, w.hash, 'k6'), /SNAPSHOT_STALE/);
    });
  });

  it('keeps snapshot content and approvals immutable', async () => {
    await inTx(async (w) => {
      await expectSqlError(
        () =>
          client.query(
            `UPDATE platform.decision_snapshot SET content_canonical = '{}', content_hash = encode(sha256(convert_to('{}','UTF8')),'hex') WHERE id = $1`,
            [w.snapshot],
          ),
        /immutable/,
      );
      await approve(w, w.sponsor, w.sponsorSession, w.hash, 'k7');
      await expectSqlError(
        () => client.query(`UPDATE platform.approval SET rationale = 'changed'`),
        /permission denied|append-only/,
      );
    });
  });

  it('rejects a snapshot whose hash does not match its canonical content', async () => {
    await inTx(async (w) => {
      await expectSqlError(
        () =>
          client.query(
            `INSERT INTO platform.decision_snapshot(tenant_id, gate_request_id, case_id, version, subject_id, content_canonical, content_hash, created_by)
           VALUES ($1, $2, $3, 4, $3, '{"a":1}', $4, $5)`,
            [w.tenant, w.gate, w.caseId, '0'.repeat(64), w.owner],
          ),
        /check constraint/,
      );
    });
  });
});

describe('append-only audit', () => {
  it('refuses update and delete', async () => {
    await inTx(async (w) => {
      await client.query(
        `INSERT INTO platform.audit_event(tenant_id, actor_kind, action, object_type, object_id, summary, authz_context, correlation_id)
         VALUES ($1, 'system', 'case.created', 'case', $2, 'created', '{}', 'c')`,
        [w.tenant, w.caseId],
      );
      await expectSqlError(
        () => client.query('DELETE FROM platform.audit_event'),
        /permission denied|append-only/,
      );
      await expectSqlError(
        () => client.query(`UPDATE platform.audit_event SET summary = 'x'`),
        /permission denied|append-only/,
      );
    });
  });
});
