/**
 * Postgres side of the timer jobs. Every function runs inside a tenant transaction (`withTenant`), so
 * RLS applies; the worker role reaches other tenants only through platform.list_tenant_ids().
 * State change, invalidation rows, paused writes and the audit event commit together.
 */
import { APPROVAL_EXECUTED_SQL, businessNow, sql, withTenant, type Db, type Tx } from '@growth-os/db';
import type { CaseStage, ExperimentLifecycle, GateCode, GateRequestStatus } from '@growth-os/contracts';
import {
  planApprovalExpiry,
  planPilotWindow,
  type ExperimentCandidate,
  type ExpiryAction,
  type ExpiryCandidate,
  type PilotCandidate,
  type PilotWindowAction,
} from './plan';

export interface TimerContext {
  /** ISO date-time of this run (injected so runs are reproducible). */
  now: string;
  /** Tenant-local time zone for calendar dates (pilot windows are local dates). */
  timeZone: string;
  correlationId: string;
}

const AUTHZ = (rule: string) => JSON.stringify({ decision: 'allow', rule, authorityGrantId: null });

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

// ---------------------------------------------------------------------------
// Approval expiry
// ---------------------------------------------------------------------------

/**
 * Approved gate requests past `expires_at`, with whether the approval was used. "Used" means: G0 and
 * G3 always (the decision moves the stage immediately); otherwise the pilot was activated under it,
 * an experiment it locked was started, or any task write authorized by it left the outbox.
 */
export async function loadExpiryCandidates(tx: Tx, now: string): Promise<ExpiryCandidate[]> {
  const r = await sql<{
    id: string;
    case_id: string | null;
    gate_code: GateCode;
    status: GateRequestStatus;
    expires_at: Date | string | null;
    executed: boolean;
    approval_ids: string[];
    case_stage: CaseStage | null;
  }>`
    SELECT g.id, g.case_id, g.gate_code, g.status, g.expires_at,
      (SELECT c.stage FROM platform.workflow_case c WHERE c.id = g.case_id) AS case_stage,
      ${APPROVAL_EXECUTED_SQL} AS executed,
      ARRAY(SELECT a.id::text FROM platform.approval a
             WHERE a.gate_request_id = g.id AND a.disposition IN ('approve','approve_with_conditions')
               AND NOT EXISTS (SELECT 1 FROM platform.approval_invalidation i WHERE i.approval_id = a.id)
             ORDER BY a.id) AS approval_ids
    FROM platform.gate_request g
    WHERE g.status IN ('approved','approved_with_conditions')
      AND g.expires_at IS NOT NULL AND g.expires_at <= ${now}::timestamptz
    ORDER BY g.id
    FOR UPDATE OF g SKIP LOCKED`.execute(tx);
  return r.rows.map((row) => ({
    gateRequestId: row.id,
    caseId: row.case_id,
    gateCode: row.gate_code,
    status: row.status,
    expiresAt: iso(row.expires_at),
    executed: row.executed,
    effectiveApprovalIds: row.approval_ids,
    caseStage: row.case_stage,
  }));
}

/** Apply one expiry. Returns false when the row changed since it was read (another run won). */
export async function applyExpiry(tx: Tx, a: ExpiryAction, ctx: TimerContext): Promise<boolean> {
  const updated = await sql<{ id: string }>`
    UPDATE platform.gate_request SET status = ${a.to}, row_version = row_version + 1
     WHERE id = ${a.gateRequestId} AND status = ${a.from}
     RETURNING id`.execute(tx);
  if (updated.rows.length === 0) return false;

  for (const approvalId of a.approvalIds) {
    await sql`
      INSERT INTO platform.approval_invalidation (tenant_id, approval_id, kind, reason)
      VALUES (platform.current_tenant_id(), ${approvalId}, 'expired', ${a.reason})
      ON CONFLICT (approval_id) DO NOTHING`.execute(tx);
  }

  // Never-rule 10: an expired approval pauses unsent external writes. Ambiguous sends ('checking')
  // keep reconciling; confirmed writes are preserved. A queued task reads "Sending…" while its row is
  // still pending, so its link pauses with the row (CR-WS6-3, D-083); rows in flight are not touched.
  const paused = await sql<{ aggregate_type: string; aggregate_id: string }>`
    UPDATE platform.outbox_message SET status = 'paused', updated_at = now()
     WHERE authorization_ref->>'gateRequestId' = ${a.gateRequestId} AND status = 'pending'
     RETURNING aggregate_type, aggregate_id`.execute(tx);
  const linkIds = paused.rows
    .filter((p) => p.aggregate_type === 'external_task_link')
    .map((p) => p.aggregate_id);
  if (linkIds.length > 0) {
    await sql`
      UPDATE platform.external_task_link SET sync_status = 'paused_approval_changed', updated_at = now()
       WHERE id = ANY(${linkIds}::uuid[])
         AND sync_status IN ('not_sent','in_preview','sending','retry_scheduled')`.execute(tx);
  }

  await sql`
    INSERT INTO platform.audit_event (tenant_id, actor_user_id, actor_kind, actor_role, action, object_type,
      object_id, object_version, case_id, summary, details, authz_context, correlation_id)
    VALUES (platform.current_tenant_id(), NULL, 'system', NULL, ${a.auditAction}, 'gate_request',
      ${a.gateRequestId}, NULL, ${a.caseId}, ${a.reason},
      ${JSON.stringify({
        gate: a.gateCode,
        from: a.from,
        to: a.to,
        approvals: a.approvalIds.length,
        pausedWrites: paused.rows.length,
      })}::jsonb,
      ${AUTHZ('timer:approval_expiry')}::jsonb, ${ctx.correlationId})`.execute(tx);

  // D-035: an expired G2 returns the case to Pilot approval pending (a new G2 request is needed).
  if (a.caseMove && a.caseId) {
    const moved = await sql<{ row_version: number }>`
      UPDATE platform.workflow_case SET stage = ${a.caseMove.to}
       WHERE id = ${a.caseId} AND stage = ${a.caseMove.from}
       RETURNING row_version`.execute(tx);
    const row = moved.rows[0];
    if (row)
      await sql`
        INSERT INTO platform.audit_event (tenant_id, actor_user_id, actor_kind, actor_role, action, object_type,
          object_id, object_version, case_id, summary, details, authz_context, correlation_id)
        VALUES (platform.current_tenant_id(), NULL, 'system', NULL, ${a.caseMove.auditAction}, 'case',
          ${a.caseId}, ${row.row_version}, ${a.caseId}, ${'Pilot approval expired unused. A new G2 request is needed.'},
          ${JSON.stringify({ from: a.caseMove.from, to: a.caseMove.to, reason: 'g2_expired' })}::jsonb,
          ${AUTHZ('timer:approval_expiry')}::jsonb, ${ctx.correlationId})`.execute(tx);
  }
  return true;
}

export interface ExpirySummary {
  expired: number;
  skipped: number;
}

export async function expireApprovalsInTenant(tx: Tx, ctx: TimerContext): Promise<ExpirySummary> {
  const candidates = await loadExpiryCandidates(tx, ctx.now);
  const plan = planApprovalExpiry(candidates, ctx.now, ctx.timeZone);
  let expired = 0;
  for (const a of plan.expire) if (await applyExpiry(tx, a, ctx)) expired += 1;
  return { expired, skipped: plan.skipped.length };
}

// ---------------------------------------------------------------------------
// Pilot window
// ---------------------------------------------------------------------------

export async function loadPilotCandidates(tx: Tx): Promise<PilotCandidate[]> {
  const r = await sql<{ case_id: string; stage: CaseStage; window_end: string }>`
    SELECT c.id AS case_id, c.stage, v.window_end::text AS window_end
      FROM platform.workflow_case c
      JOIN me.pilot_plan p ON p.case_id = c.id
      JOIN me.pilot_plan_version v ON v.id = p.current_version_id
     WHERE c.stage = 'pilot_running'
     ORDER BY c.id
     FOR UPDATE OF c SKIP LOCKED`.execute(tx);
  return r.rows.map((row) => ({ caseId: row.case_id, stage: row.stage, windowEnd: row.window_end }));
}

export async function loadExperimentCandidates(tx: Tx): Promise<ExperimentCandidate[]> {
  const r = await sql<{ id: string; case_id: string; lifecycle: ExperimentLifecycle; window_end: string }>`
    SELECT e.id, e.case_id, e.lifecycle, pv.window_end::text AS window_end
      FROM me.experiment e
      JOIN me.experiment_plan_version pv ON pv.experiment_id = e.id AND pv.version = e.current_plan_version
     WHERE e.lifecycle = 'running'
     ORDER BY e.id`.execute(tx);
  return r.rows.map((row) => ({
    experimentId: row.id,
    caseId: row.case_id,
    lifecycle: row.lifecycle,
    windowEnd: row.window_end,
  }));
}

export async function applyPilotWindowEnded(
  tx: Tx,
  a: PilotWindowAction,
  ctx: TimerContext,
): Promise<boolean> {
  const updated = await sql<{ row_version: number }>`
    UPDATE platform.workflow_case SET stage = ${a.to}, row_version = row_version + 1
     WHERE id = ${a.caseId} AND stage = ${a.from}
     RETURNING row_version`.execute(tx);
  const row = updated.rows[0];
  if (!row) return false;
  await sql`
    INSERT INTO platform.audit_event (tenant_id, actor_user_id, actor_kind, actor_role, action, object_type,
      object_id, object_version, case_id, summary, details, authz_context, correlation_id)
    VALUES (platform.current_tenant_id(), NULL, 'system', NULL, ${a.auditAction}, 'case',
      ${a.caseId}, ${row.row_version}, ${a.caseId}, ${'Pilot window ended. Review due.'},
      ${JSON.stringify({ from: a.from, to: a.to, windowEnd: a.windowEnd, reason: 'pilot_window_ended' })}::jsonb,
      ${AUTHZ('timer:pilot_window')}::jsonb, ${ctx.correlationId})`.execute(tx);
  return true;
}

export interface PilotWindowSummary {
  advanced: number;
  overdueExperiments: number;
}

export async function advancePilotWindowsInTenant(tx: Tx, ctx: TimerContext): Promise<PilotWindowSummary> {
  const plan = planPilotWindow(
    await loadPilotCandidates(tx),
    await loadExperimentCandidates(tx),
    ctx.now,
    ctx.timeZone,
  );
  let advanced = 0;
  for (const a of plan.advance) if (await applyPilotWindowEnded(tx, a, ctx)) advanced += 1;
  return { advanced, overdueExperiments: plan.overdueExperiments.length };
}

// ---------------------------------------------------------------------------
// Cross-tenant runners (one transaction per tenant; a failing tenant does not block the others)
// ---------------------------------------------------------------------------

export async function listTenantIds(db: Db): Promise<string[]> {
  const r = await sql<{ id: string }>`SELECT id FROM platform.list_tenant_ids() AS id`.execute(db);
  return r.rows.map((row) => row.id);
}

/** The tenant's own calendar zone (D-077); the job option is only the fallback. */
export async function tenantZone(tx: Tx, fallback: string): Promise<string> {
  const r = await tx.selectFrom('platform.tenant').select('time_zone').executeTakeFirst();
  return r?.time_zone ?? fallback;
}

export async function forEachTenant<T>(
  db: Db,
  ctx: TimerContext,
  fn: (tx: Tx, ctx: TimerContext) => Promise<T>,
): Promise<{ tenantId: string; result?: T; error?: string }[]> {
  const out: { tenantId: string; result?: T; error?: string }[] = [];
  for (const tenantId of await listTenantIds(db)) {
    try {
      const result = await withTenant(
        db,
        { tenantId, userId: null, correlationId: ctx.correlationId },
        async (tx) =>
          fn(tx, {
            ...ctx,
            timeZone: await tenantZone(tx, ctx.timeZone),
            // The tenant's business time: the dev clock moves it only in AUTH_MODE=dev for an
            // illustrative tenant (D-091); otherwise this is the run's own time.
            now: (await businessNow(tx, new Date(ctx.now))).toISOString(),
          }),
      );
      out.push({ tenantId, result });
    } catch (e) {
      out.push({ tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
