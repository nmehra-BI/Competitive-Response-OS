/**
 * Migration 0006 (decisions.md D-122 onward): database guarantees for the Wave 4 contracts. Runs as the
 * app role (NOBYPASSRLS), each test inside a transaction that is rolled back. Requires `pnpm db:migrate`.
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

interface W {
  tenant: string;
  other: string;
  bu: string;
  admin: string;
  maya: string;
  agent: string;
  caseId: string;
  gate: string;
}

const q = (text: string, values: unknown[] = []) => client.query(text, values);
const as = (tenant: string) => q(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);

async function tenant(id: string, bu: string, users: [string, string, string][]): Promise<void> {
  await as(id);
  await q(`INSERT INTO platform.tenant(id, slug, name) VALUES ($1, $2, 'T')`, [id, `t-${id}`]);
  await q(
    `INSERT INTO platform.business_unit(id, tenant_id, key, name) VALUES ($1, $2, 'water', 'BU Water')`,
    [bu, id],
  );
  for (const [uid, email, kind] of users)
    await q(
      `INSERT INTO platform.app_user(id, tenant_id, email, display_name, initials, kind) VALUES ($1, $2, $3, $3, 'XX', $4)`,
      [uid, id, email, kind],
    );
}

async function inTx(fn: (w: W) => Promise<void>): Promise<void> {
  await q('BEGIN');
  try {
    const w: W = {
      tenant: randomUUID(),
      other: randomUUID(),
      bu: randomUUID(),
      admin: randomUUID(),
      maya: randomUUID(),
      agent: randomUUID(),
      caseId: randomUUID(),
      gate: randomUUID(),
    };
    await tenant(w.other, randomUUID(), [[randomUUID(), 'x@other', 'human']]);
    await tenant(w.tenant, w.bu, [
      [w.admin, 'admin@x', 'human'],
      [w.maya, 'maya@x', 'human'],
      [w.agent, 'agent@x', 'agent'],
    ]);
    await q(
      `INSERT INTO platform.workflow_case(id, tenant_id, app_type, display_key, title, business_unit_id, owner_user_id, sponsor_user_id, stage, origin_type, created_by)
       VALUES ($1, $2, 'market_expansion', 'ME-104', 't', $3, $4, $4, 'pilot_running', 'direct', $4)`,
      [w.caseId, w.tenant, w.bu, w.maya],
    );
    await q(
      `INSERT INTO platform.gate_request(id, tenant_id, display_key, case_id, subject_type, subject_id, business_unit_id, gate_code, status, scope, requested_amount, currency, created_by)
       VALUES ($1, $2, 'ME-104-G2', $3, 'case', $3, $4, 'G2', 'approved', '{}', 120000, 'EUR', $5)`,
      [w.gate, w.tenant, w.caseId, w.bu, w.maya],
    );
    await fn(w);
  } finally {
    await q('ROLLBACK');
  }
}

async function refused(run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  await q('SAVEPOINT s');
  try {
    await run();
    throw new Error('expected the statement to fail');
  } catch (err) {
    expect((err as Error).message).toMatch(pattern);
  } finally {
    await q('ROLLBACK TO SAVEPOINT s');
  }
}

describe('0006 · RLS on every new table', () => {
  it('a tenant sees and writes only its own committee, AI setting, credentials and OAuth states', async () => {
    await inTx(async (w) => {
      const conn = randomUUID();
      await q(
        `INSERT INTO platform.connection(id, tenant_id, kind, provider, name, scope_text, used_for, status, created_by)
         VALUES ($1, $2, 'task_tool', 'jira_cloud', 'Jira', 'Create', 'Tasks', 'expired', $3)`,
        [conn, w.tenant, w.admin],
      );
      await q(
        `INSERT INTO platform.committee_member(tenant_id, business_unit_id, user_id, seat, valid_from, entered_by)
         VALUES ($1, $2, $3, 'finance', '2026-01-01', $4)`,
        [w.tenant, w.bu, w.maya, w.admin],
      );
      await q(`INSERT INTO platform.tenant_ai_setting(tenant_id) VALUES ($1)`, [w.tenant]);
      await q(
        `INSERT INTO platform.connection_credential(connection_id, tenant_id, access_token_ciphertext, key_id, token_expires_at, site_url, cloud_id, authorized_by)
         VALUES ($1, $2, '\\x00', 'k1', now() + interval '1 hour', 'https://aster.atlassian.net', 'c1', $3)`,
        [conn, w.tenant, w.admin],
      );
      await q(
        `INSERT INTO platform.connector_oauth_state(state_hash, tenant_id, connection_id, user_id, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`,
        ['a'.repeat(64), w.tenant, conn, w.admin],
      );
      for (const t of [
        'committee_member',
        'tenant_ai_setting',
        'connection_credential',
        'connector_oauth_state',
      ])
        expect((await q(`SELECT count(*)::int AS n FROM platform.${t}`)).rows[0].n, t).toBe(1);

      await as(w.other);
      for (const t of [
        'committee_member',
        'tenant_ai_setting',
        'connection_credential',
        'connector_oauth_state',
      ])
        expect((await q(`SELECT count(*)::int AS n FROM platform.${t}`)).rows[0].n, t).toBe(0);
      await refused(
        () => q(`INSERT INTO platform.tenant_ai_setting(tenant_id) VALUES ($1)`, [w.tenant]),
        /row-level security/,
      );
    });
  });
});

describe('0006 · committee seats (D-109 §3)', () => {
  it('only humans hold a seat, never the admin who enters it, one live holder per seat', async () => {
    await inTx(async (w) => {
      const seat = (user: string, s: string, by = w.admin) =>
        q(
          `INSERT INTO platform.committee_member(tenant_id, business_unit_id, user_id, seat, valid_from, entered_by)
           VALUES ($1, $2, $3, $4, '2026-01-01', $5)`,
          [w.tenant, w.bu, user, s, by],
        );
      await refused(() => seat(w.agent, 'chair'), /AGENT_IDENTITY_FORBIDDEN/);
      await refused(() => seat(w.admin, 'chair'), /check constraint/);
      await seat(w.maya, 'finance');
      await refused(() => seat(w.admin, 'finance', w.maya), /committee_member_one_live_seat_idx/);
    });
  });
});

describe('0006 · licences fail closed (D-120)', () => {
  it('permissions above metadata only need a written confirmation and an unexpired term', async () => {
    await inTx(async (w) => {
      await refused(
        () =>
          q(
            `INSERT INTO platform.license(tenant_id, key, name, boundary_text, max_excerpt_sentences, allow_model_context)
             VALUES ($1, 'unconfirmed', 'L', 'b', 2, true)`,
            [w.tenant],
          ),
        /license_fail_closed/,
      );
      await q(
        `INSERT INTO platform.license(tenant_id, key, name, boundary_text) VALUES ($1, 'meta', 'L', 'metadata only')`,
        [w.tenant],
      );
      await q(
        `INSERT INTO platform.license(tenant_id, key, name, boundary_text, max_excerpt_sentences, allow_model_context, rights_document_ref, rights_confirmed_on, term_ends_on)
         VALUES ($1, 'ok', 'L', 'b', 2, true, 'Licence letter 2026-01', '2026-01-15', '2027-12-31')`,
        [w.tenant],
      );
      // The on-expiry job must drop permissions in the same write that marks the licence expired.
      await refused(
        () =>
          q(`UPDATE platform.license SET expired_at = now() WHERE key = 'ok' AND tenant_id = $1`, [w.tenant]),
        /license_fail_closed/,
      );
      await q(
        `UPDATE platform.license SET expired_at = now(), max_excerpt_sentences = 0, allow_model_context = false
          WHERE key = 'ok' AND tenant_id = $1`,
        [w.tenant],
      );
      await refused(
        () =>
          q(
            `INSERT INTO platform.license(tenant_id, key, name, boundary_text, rights_document_ref) VALUES ($1, 'half', 'L', 'b', 'ref')`,
            [w.tenant],
          ),
        /license_confirmation_complete/,
      );
    });
  });
});

describe('0006 · live analysis is off until the addendum and an eval run are recorded (D-120 §4)', () => {
  it('refuses to enable without the document reference, date and eval run', async () => {
    await inTx(async (w) => {
      await refused(
        () =>
          q(`INSERT INTO platform.tenant_ai_setting(tenant_id, live_enabled) VALUES ($1, true)`, [w.tenant]),
        /check constraint/,
      );
      await q(
        `INSERT INTO platform.tenant_ai_setting(tenant_id, live_enabled, addendum_ref, addendum_signed_on, eval_run_ref, eval_passed_at, changed_by)
         VALUES ($1, true, 'Addendum A-1', '2026-11-01', 'eval-run-17', now(), $2)`,
        [w.tenant, w.admin],
      );
    });
  });
});

describe('0006 · budget entries stay append-only; corrections reverse (D-114 §2)', () => {
  it('a reversal matches its entry, happens once, and is never reversed', async () => {
    await inTx(async (w) => {
      const entry = async (amount: string, reverses: string | null = null, reason: string | null = null) =>
        (
          await q(
            `INSERT INTO me.budget_entry(tenant_id, case_id, gate_request_id, kind, amount, currency, as_of, source_text, recorded_by, reference, reverses_entry_id, reversal_reason)
             VALUES ($1, $2, $3, 'spent', $4, 'EUR', '2026-12-10', 'Install kit', $5, 'PO-4411', $6, $7) RETURNING id`,
            [w.tenant, w.caseId, w.gate, amount, w.maya, reverses, reason],
          )
        ).rows[0].id as string;
      const e = await entry('8000.00');
      await refused(() => entry('8000.00', e, null), /budget_entry_reversal_reason/);
      await refused(() => entry('7000.00', e, 'Wrong amount'), /must match/);
      const r = await entry('8000.00', e, 'Invoice booked twice');
      await refused(() => entry('8000.00', e, 'Again'), /budget_entry_reversed_once_idx/);
      await refused(() => entry('8000.00', r, 'Undo the undo'), /cannot be reversed/);
      await refused(() => q(`UPDATE me.budget_entry SET amount = 1 WHERE id = $1`, [e]), /permission denied/);
    });
  });
});

describe('0006 · validation draft tasks (D-113)', () => {
  it('an unsent task can be removed (kept, never deleted); a sent one cannot; removal is final', async () => {
    await inTx(async (w) => {
      const conn = randomUUID();
      const set = randomUUID();
      await q(
        `INSERT INTO platform.connection(id, tenant_id, kind, provider, name, scope_text, used_for, status, created_by)
         VALUES ($1, $2, 'task_tool', 'jira_simulated', 'Jira', 'Create', 'Tasks', 'connected', $3)`,
        [conn, w.tenant, w.admin],
      );
      await q(
        `INSERT INTO platform.task_set(id, tenant_id, case_id, owner_type, owner_id, authorizing_gate_request_id, connection_id)
         VALUES ($1, $2, $3, 'experiment', $4, $5, $6)`,
        [set, w.tenant, w.caseId, randomUUID(), w.gate, conn],
      );
      const task = async (n: number) =>
        (
          await q(
            `INSERT INTO platform.task(tenant_id, case_id, task_set_id, ordinal, title, function, deliverable)
             VALUES ($1, $2, $3, $4, 'Run interviews', 'sales', 'Notes') RETURNING id`,
            [w.tenant, w.caseId, set, n],
          )
        ).rows[0].id as string;
      const unsent = await task(1);
      const sent = await task(2);
      await q(
        `INSERT INTO platform.external_task_link(tenant_id, task_id, connection_id, idempotency_key, sync_status, external_key)
         VALUES ($1, $2, $3, $4, 'confirmed', 'VAL-9')`,
        [w.tenant, sent, conn, 'b'.repeat(64)],
      );
      const remove = (id: string) =>
        q(`UPDATE platform.task SET removed_at = now(), removed_by = $2 WHERE id = $1`, [id, w.maya]);
      await remove(unsent);
      await refused(() => remove(sent), /a sent task cannot be removed/);
      await refused(
        () => q(`UPDATE platform.task SET removed_at = NULL, removed_by = NULL WHERE id = $1`, [unsent]),
        /stays removed/,
      );
    });
  });
});
