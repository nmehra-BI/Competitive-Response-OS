/**
 * FROZEN job catalogue. Jobs are enqueued with graphile_worker.add_job(...) INSIDE the same
 * transaction that writes the business change (transactional enqueue, D-007). Every payload carries
 * tenantId and correlationId; the job sets app.tenant_id before touching data (RLS stays on).
 */
export const JOBS = {
  /** Send one outbox row: re-check authorization, call connector, record result. Owner: WS6. */
  outboxDispatch: 'outbox.dispatch',
  /** After an ambiguous timeout: find by idempotency key before any retry. Owner: WS6. */
  outboxReconcile: 'outbox.reconcile',
  /** Periodic sweep: claim due outbox rows via platform.claim_outbox_batch (crash recovery). Owner: WS6. */
  outboxSweep: 'outbox.sweep',
  /** Execute or resume an analysis run within budget. Owner: WS5. */
  analysisRun: 'analysis.run',
  /** Expire unused approvals (approval_expiry policy) per tenant. Owner: WS3. */
  timersApprovalExpiry: 'timers.approval_expiry',
  /** Move pilot_running → review_due when the window ends; flag overdue experiments. Owner: WS3. */
  timersPilotWindow: 'timers.pilot_window',
  /** Ingest an authorized upload: sanitize, hash, store, extract permitted passages. Owner: WS1. */
  evidenceIngest: 'evidence.ingest',
  /** Recompute source freshness (current → ageing → stale) daily. Owner: WS1. */
  evidenceFreshness: 'evidence.freshness',
  /** Deliver analytics outbox rows to the sink (dev: table only). Owner: WS1. */
  analyticsFlush: 'analytics.flush',
  /**
   * Licence term ended: run the licence's on-expiry action (remove excerpts and embeddings, keep provenance
   * metadata) and drop its permissions to metadata only in the same write (D-120, D-129). Owner: Wave 4 E3.
   * Scheduled below; it runs once its handler is registered (schedule.ts keeps registered tasks only).
   */
  timersLicenseExpiry: 'timers.license_expiry',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export interface JobPayloadBase {
  tenantId: string;
  correlationId: string;
}

export interface OutboxDispatchPayload extends JobPayloadBase {
  outboxMessageId: string;
}
export interface AnalysisRunPayload extends JobPayloadBase {
  runId: string;
  resume: boolean;
}
export interface EvidenceIngestPayload extends JobPayloadBase {
  sourceId: string;
}

/** Cron schedule (graphile-worker crontab syntax). Timers iterate tenants via platform.list_tenant_ids(). */
export const CRONTAB = [
  `*/1 * * * * ${JOBS.outboxSweep}`,
  `*/15 * * * * ${JOBS.timersApprovalExpiry}`,
  `0 * * * * ${JOBS.timersPilotWindow}`,
  `30 3 * * * ${JOBS.evidenceFreshness}`,
  `*/1 * * * * ${JOBS.analyticsFlush}`,
  `15 2 * * * ${JOBS.timersLicenseExpiry}`,
].join('\n');
