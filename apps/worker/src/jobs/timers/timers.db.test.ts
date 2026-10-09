/**
 * Timer jobs against real Postgres (RLS on, worker role). Each test builds its own tenant inside a
 * transaction and rolls it back, so nothing persists. Runs with `pnpm test:db` (db project).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, sql, type Tx } from '@growth-os/db';
import { advancePilotWindowsInTenant, expireApprovalsInTenant, type TimerContext } from './store';

const db = createDb('worker', 2);
afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

interface World {
  tenant: string;
  bu: string;
  owner: string;
  sponsor: string;
  caseId: string;
  gate: string;
  snapshot: string;
  approval: string;
}

async function inTenantTx(fn: (tx: Tx, w: World) => Promise<void>): Promise<void> {
  const w: World = {
    tenant: randomUUID(),
    bu: randomUUID(),
    owner: randomUUID(),
    sponsor: randomUUID(),
    caseId: randomUUID(),
    gate: randomUUID(),
    snapshot: randomUUID(),
    approval: randomUUID(),
  };
  try {
    await db.transaction().execute(async (tx) => {
      await sql`SELECT set_config('app.tenant_id', ${w.tenant}, true)`.execute(tx);
      await sql`INSERT INTO platform.tenant(id, slug, name) VALUES (${w.tenant}, ${`t-${w.tenant}`}, 'T')`.execute(
        tx,
      );
      await sql`INSERT INTO platform.business_unit(id, tenant_id, key, name) VALUES (${w.bu}, ${w.tenant}, 'water', 'BU Water')`.execute(
        tx,
      );
      await sql`INSERT INTO platform.app_user(id, tenant_id, email, display_name, initials, kind) VALUES
        (${w.owner}, ${w.tenant}, 'maya@x', 'Maya', 'MR', 'human'),
        (${w.sponsor}, ${w.tenant}, 'elena@x', 'Elena', 'EF', 'human')`.execute(tx);
      await sql`INSERT INTO platform.workflow_case(id, tenant_id, app_type, display_key, title, business_unit_id,
          owner_user_id, sponsor_user_id, stage, origin_type, created_by)
        VALUES (${w.caseId}, ${w.tenant}, 'market_expansion', 'ME-104', 't', ${w.bu}, ${w.owner}, ${w.sponsor},
          'pilot_approval_pending', 'direct', ${w.owner})`.execute(tx);
      await sql`INSERT INTO platform.gate_request(id, tenant_id, display_key, case_id, subject_type, subject_id,
          business_unit_id, gate_code, status, scope, requested_amount, currency, created_by)
        VALUES (${w.gate}, ${w.tenant}, 'ME-104-G2', ${w.caseId}, 'case', ${w.caseId}, ${w.bu}, 'G2',
          'awaiting_decision', '{}', 120000, 'EUR', ${w.owner})`.execute(tx);
      const canonical = '{"ask":"Approve pilot €120k · 90 days"}';
      const snap = await sql<{
        hash: string;
      }>`INSERT INTO platform.decision_snapshot(id, tenant_id, gate_request_id,
          case_id, version, subject_id, content_canonical, content_hash, created_by)
        VALUES (${w.snapshot}, ${w.tenant}, ${w.gate}, ${w.caseId}, 4, ${w.caseId}, ${canonical},
          encode(sha256(convert_to(${canonical}, 'UTF8')), 'hex'), ${w.owner})
        RETURNING content_hash AS hash`.execute(tx);
      const session = randomUUID();
      await sql`INSERT INTO platform.session(id, tenant_id, user_id, token_hash, auth_method, expires_at)
        VALUES (${session}, ${w.tenant}, ${w.sponsor}, ${`h-${session}`}, 'dev_persona', now() + interval '1 day')`.execute(
        tx,
      );
      const grant = randomUUID();
      await sql`INSERT INTO platform.authority_grant(id, tenant_id, user_id, gate_code, business_unit_id,
          ceiling_amount, currency, valid_from, granted_by)
        VALUES (${grant}, ${w.tenant}, ${w.sponsor}, 'G2', ${w.bu}, 250000, 'EUR', '2026-01-01', ${w.sponsor})`.execute(
        tx,
      );
      await sql`INSERT INTO platform.approval(id, tenant_id, gate_request_id, snapshot_id, snapshot_hash,
          approver_user_id, approver_role, authority_grant_id, session_id, disposition, rationale, idempotency_key)
        VALUES (${w.approval}, ${w.tenant}, ${w.gate}, ${w.snapshot}, ${snap.rows[0]!.hash}, ${w.sponsor}, 'sponsor',
          ${grant}, ${session}, 'approve_with_conditions', 'Bounded pilot', ${randomUUID()})`.execute(tx);
      await sql`UPDATE platform.gate_request SET status = 'approved_with_conditions',
          expires_at = '2026-12-11T23:59:00+01:00' WHERE id = ${w.gate}`.execute(tx);
      await sql`UPDATE platform.workflow_case SET stage = 'pilot_approved' WHERE id = ${w.caseId}`.execute(
        tx,
      );
      await fn(tx, w);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

const ctx = (now: string): TimerContext => ({ now, timeZone: 'Europe/Berlin', correlationId: 'test-timers' });

describe('timers.approval_expiry (db)', () => {
  it('expires an unused approval: gate expired, invalidation row, unsent writes paused, audit', async () => {
    await inTenantTx(async (tx, w) => {
      const pending = randomUUID();
      const confirmed = randomUUID();
      for (const [id, status] of [
        [pending, 'pending'],
        [confirmed, 'checking'],
      ] as const) {
        await sql`INSERT INTO platform.outbox_message(id, tenant_id, kind, aggregate_type, aggregate_id,
            idempotency_key, payload, status, authorization_ref, correlation_id)
          VALUES (${id}, ${w.tenant}, 'task.create', 'external_task_link', ${randomUUID()}, ${id}, '{}', ${status},
            ${JSON.stringify({ gateRequestId: w.gate })}::jsonb, 'c')`.execute(tx);
      }
      // 'checking' counts as executed (an ambiguous send may have succeeded) → not expired.
      expect(await expireApprovalsInTenant(tx, ctx('2026-12-12T00:00:00+01:00'))).toEqual({
        expired: 0,
        skipped: 1,
      });
      await sql`UPDATE platform.outbox_message SET status = 'failed' WHERE id = ${confirmed}`.execute(tx);

      expect(await expireApprovalsInTenant(tx, ctx('2026-12-11T23:00:00+01:00'))).toEqual({
        expired: 0,
        skipped: 0,
      });
      expect(await expireApprovalsInTenant(tx, ctx('2026-12-12T00:00:00+01:00'))).toEqual({
        expired: 1,
        skipped: 0,
      });

      const g = await sql<{
        status: string;
      }>`SELECT status FROM platform.gate_request WHERE id = ${w.gate}`.execute(tx);
      expect(g.rows[0]?.status).toBe('expired');
      const inv = await sql<{ kind: string; reason: string }>`
        SELECT kind, reason FROM platform.approval_invalidation WHERE approval_id = ${w.approval}`.execute(
        tx,
      );
      expect(inv.rows).toEqual([{ kind: 'expired', reason: 'Approval expired unused (expiry 11 Dec 2026)' }]);
      const ob = await sql<{ id: string; status: string }>`
        SELECT id, status FROM platform.outbox_message WHERE id IN (${pending}, ${confirmed}) ORDER BY status`.execute(
        tx,
      );
      expect(ob.rows.find((r) => r.id === pending)?.status).toBe('paused');
      const audit = await sql<{ action: string; actor_kind: string; summary: string }>`
        SELECT action, actor_kind, summary FROM platform.audit_event WHERE object_id = ${w.gate}`.execute(tx);
      expect(audit.rows).toEqual([
        {
          action: 'gate.approval_expired',
          actor_kind: 'system',
          summary: 'Approval expired unused (expiry 11 Dec 2026)',
        },
      ]);

      // D-035: the case returns to Pilot approval pending so a new G2 request can be decided.
      const c = await sql<{ stage: string }>`
        SELECT stage FROM platform.workflow_case WHERE id = ${w.caseId}`.execute(tx);
      expect(c.rows[0]?.stage).toBe('pilot_approval_pending');
      const caseAudit = await sql<{ action: string; details: { from: string; to: string } }>`
        SELECT action, details FROM platform.audit_event WHERE object_id = ${w.caseId}`.execute(tx);
      expect(caseAudit.rows).toEqual([
        {
          action: 'case.stage_changed',
          details: { from: 'pilot_approved', to: 'pilot_approval_pending', reason: 'g2_expired' },
        },
      ]);

      // Idempotent: a second run finds nothing to do.
      expect(await expireApprovalsInTenant(tx, ctx('2026-12-13T00:00:00+01:00'))).toEqual({
        expired: 0,
        skipped: 0,
      });
    });
  });

  it('never expires an approval that activated the pilot', async () => {
    await inTenantTx(async (tx, w) => {
      await sql`INSERT INTO me.pilot_plan(tenant_id, case_id, gate_request_id, status, activated_at, activated_by)
        VALUES (${w.tenant}, ${w.caseId}, ${w.gate}, 'active', now(), ${w.owner})`.execute(tx);
      expect(await expireApprovalsInTenant(tx, ctx('2026-12-20T00:00:00+01:00'))).toEqual({
        expired: 0,
        skipped: 1,
      });
    });
  });

  it('cannot see or touch another tenant (RLS)', async () => {
    await inTenantTx(async (tx) => {
      await sql`SELECT set_config('app.tenant_id', ${randomUUID()}, true)`.execute(tx);
      expect(await expireApprovalsInTenant(tx, ctx('2026-12-20T00:00:00+01:00'))).toEqual({
        expired: 0,
        skipped: 0,
      });
    });
  });
});

describe('timers.pilot_window (db)', () => {
  it('moves pilot_running → review_due after the window and writes an audit event', async () => {
    await inTenantTx(async (tx, w) => {
      await sql`UPDATE platform.workflow_case SET stage = 'pilot_running' WHERE id = ${w.caseId}`.execute(tx);
      const plan = randomUUID();
      const version = randomUUID();
      await sql`INSERT INTO me.pilot_plan(id, tenant_id, case_id, gate_request_id, status, activated_at, activated_by)
        VALUES (${plan}, ${w.tenant}, ${w.caseId}, ${w.gate}, 'active', now(), ${w.owner})`.execute(tx);
      await sql`INSERT INTO me.pilot_plan_version(id, tenant_id, pilot_plan_id, version, state, budget_ceiling,
          currency, window_start, window_end, scope_text, created_by, committed_at)
        VALUES (${version}, ${w.tenant}, ${plan}, 1, 'committed', 120000, 'EUR', '2026-12-01', '2027-02-28',
          'Up to 4 sites', ${w.owner}, now())`.execute(tx);
      await sql`UPDATE me.pilot_plan SET current_version_id = ${version} WHERE id = ${plan}`.execute(tx);

      expect(await advancePilotWindowsInTenant(tx, ctx('2027-02-28T22:59:00Z'))).toEqual({
        advanced: 0,
        overdueExperiments: 0,
      });
      expect(await advancePilotWindowsInTenant(tx, ctx('2027-02-28T23:00:00Z'))).toEqual({
        advanced: 1,
        overdueExperiments: 0,
      });
      const c = await sql<{
        stage: string;
      }>`SELECT stage FROM platform.workflow_case WHERE id = ${w.caseId}`.execute(tx);
      expect(c.rows[0]?.stage).toBe('review_due');
      const audit = await sql<{ action: string; object_type: string }>`
        SELECT action, object_type FROM platform.audit_event WHERE object_id = ${w.caseId}`.execute(tx);
      expect(audit.rows).toEqual([{ action: 'case.stage_changed', object_type: 'case' }]);
    });
  });
});
