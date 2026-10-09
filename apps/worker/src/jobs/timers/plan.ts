/**
 * Pure planners for the timer jobs (no I/O, no clock reads). The job runners load candidates inside
 * the tenant transaction, call these, and write what they return. Decisions go through the frozen
 * state machines, so a timer can never do what the transition table does not allow.
 */
import type { CaseStage, ExperimentLifecycle, GateCode, GateRequestStatus } from '@growth-os/contracts';
import { caseMachine, gateRequestMachine } from '@growth-os/domain';

const TIMER = { kind: 'system', reason: 'timer' } as const;

// ---------------------------------------------------------------------------
// Approval expiry (timers.approval_expiry, every 15 min)
// ---------------------------------------------------------------------------

export interface ExpiryCandidate {
  gateRequestId: string;
  caseId: string | null;
  gateCode: GateCode;
  status: GateRequestStatus;
  /** ISO date-time. */
  expiresAt: string | null;
  /** The approval has been used (pilot activated, experiments started, task writes sent). */
  executed: boolean;
  /** Approve/approve-with-conditions approvals on the gate with no invalidation row yet. */
  effectiveApprovalIds: readonly string[];
}

export interface ExpiryAction {
  gateRequestId: string;
  caseId: string | null;
  gateCode: GateCode;
  from: GateRequestStatus;
  to: GateRequestStatus;
  approvalIds: readonly string[];
  auditAction: string;
  /** e.g. "Approval expired unused (expiry 11 Dec 2026)". */
  reason: string;
}

export interface ExpiryPlan {
  expire: ExpiryAction[];
  /** Candidates the machine refused, with reasons (e.g. already executed, not yet due). */
  skipped: { gateRequestId: string; reasons: string[] }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-12-11T23:59:00+01:00" → "11 Dec 2026", in the given time zone. */
export function displayDate(iso: string, timeZone: string): string {
  const d = localDate(iso, timeZone);
  const [y, m, day] = d.split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function planApprovalExpiry(
  candidates: readonly ExpiryCandidate[],
  now: string,
  timeZone: string,
): ExpiryPlan {
  const plan: ExpiryPlan = { expire: [], skipped: [] };
  for (const c of candidates) {
    const r = gateRequestMachine.apply(c.status, 'expire', TIMER, {
      expiresAt: c.expiresAt,
      now,
      executed: c.executed,
    });
    if (!r.ok) {
      plan.skipped.push({ gateRequestId: c.gateRequestId, reasons: r.reasons });
      continue;
    }
    plan.expire.push({
      gateRequestId: c.gateRequestId,
      caseId: c.caseId,
      gateCode: c.gateCode,
      from: r.from,
      to: r.to,
      approvalIds: c.effectiveApprovalIds,
      auditAction: r.domainEvent ?? r.auditAction,
      reason: `Approval expired unused (expiry ${c.expiresAt ? displayDate(c.expiresAt, timeZone) : 'unknown'})`,
    });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Pilot window (timers.pilot_window, hourly)
// ---------------------------------------------------------------------------

export interface PilotCandidate {
  caseId: string;
  stage: CaseStage;
  /** Pilot window end (ISO date, tenant local). */
  windowEnd: string;
}

export interface ExperimentCandidate {
  experimentId: string;
  caseId: string;
  lifecycle: ExperimentLifecycle;
  /** Current plan window end (ISO date). */
  windowEnd: string;
}

export interface PilotWindowAction {
  caseId: string;
  from: CaseStage;
  to: CaseStage;
  windowEnd: string;
  auditAction: string;
}

export interface PilotWindowPlan {
  advance: PilotWindowAction[];
  /** Running experiments past their window with no result: flagged, never changed by the timer. */
  overdueExperiments: { experimentId: string; caseId: string; windowEnd: string }[];
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function planPilotWindow(
  pilots: readonly PilotCandidate[],
  experiments: readonly ExperimentCandidate[],
  now: string,
  timeZone: string,
): PilotWindowPlan {
  const today = localDate(now, timeZone);
  const advance: PilotWindowAction[] = [];
  for (const p of pilots) {
    const r = caseMachine.apply(p.stage, 'pilot_window_ended', TIMER, { windowEnd: p.windowEnd, today });
    if (r.ok) {
      advance.push({
        caseId: p.caseId,
        from: r.from,
        to: r.to,
        windowEnd: p.windowEnd,
        auditAction: r.domainEvent ?? r.auditAction,
      });
    }
  }
  const overdueExperiments = experiments
    .filter((e) => e.lifecycle === 'running' && today > e.windowEnd)
    .map((e) => ({ experimentId: e.experimentId, caseId: e.caseId, windowEnd: e.windowEnd }));
  return { advance, overdueExperiments };
}
