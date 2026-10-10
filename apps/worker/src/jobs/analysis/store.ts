/**
 * Postgres RunStore for the analysis harness (worker role, RLS on). Every `commit` is one tenant
 * transaction that locks the run row, refuses if the status changed meanwhile (a person cancelled),
 * and writes the status transition (+ audit, system actor `worker`), steps, the tool-call record,
 * proposals (superseding earlier pending ones of the same skill and subject; accepted or edited ones
 * are never touched), usage and the checkpoint together. A crash therefore loses at most the step in
 * flight, and a retried job resumes from `checkpoint`.
 *
 * `agent_run.checkpoint` holds `{ focus }` until the first commit and the harness checkpoint
 * (`v: 1`) afterwards; the run's focus (e.g. a fixture name) is kept inside it.
 */
import type { RunBudget, RunStatus, RunUsage, SkillKey } from '@growth-os/contracts';
import {
  RunStateChanged,
  type Checkpoint,
  type CommitInput,
  type RunRecord,
  type RunStore,
} from '@growth-os/ai';
import { auditWriter, sql, withTenant, type Db, type Tx } from '@growth-os/db';
import { loadCaseContext } from './context';

export const DEFAULT_TENANT_CONCURRENCY = 4;

const ZERO: RunUsage = { elapsedMs: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 };

interface StoredCheckpoint {
  v?: number;
  focus?: Record<string, string>;
}

export function splitCheckpoint(raw: unknown): {
  checkpoint: Checkpoint | null;
  focus: Record<string, string>;
} {
  const c = (raw ?? {}) as StoredCheckpoint;
  return { checkpoint: c.v === 1 ? (raw as Checkpoint) : null, focus: c.focus ?? {} };
}

export function createPgRunStore(
  db: Db,
  ctx: { tenantId: string; correlationId: string; concurrency?: number },
): RunStore {
  const tx = <T>(fn: (t: Tx) => Promise<T>) =>
    withTenant(db, { tenantId: ctx.tenantId, userId: null, correlationId: ctx.correlationId }, fn);

  return {
    loadRun: (runId) =>
      tx(async (t) => {
        const r = await t
          .selectFrom('platform.agent_run')
          .selectAll()
          .where('id', '=', runId)
          .executeTakeFirst();
        if (!r) throw new Error(`analysis run ${runId} not found in tenant`);
        const { checkpoint, focus } = splitCheckpoint(r.checkpoint);
        return {
          id: r.id,
          tenantId: r.tenant_id,
          caseId: r.case_id,
          mandateId: r.subject_type === 'mandate' ? r.subject_id : null,
          skill: r.skill_key as SkillKey,
          skillVersion: r.skill_version,
          goal: r.goal,
          focus,
          status: r.status as RunStatus,
          requestedBy: r.requested_by,
          budget: r.budget as unknown as RunBudget,
          usage: { ...ZERO, ...(r.usage as unknown as Partial<RunUsage>) },
          checkpoint,
          correlationId: r.correlation_id,
        } satisfies RunRecord;
      }),

    status: (runId) =>
      tx(async (t) => {
        const r = await t
          .selectFrom('platform.agent_run')
          .select('status')
          .where('id', '=', runId)
          .executeTakeFirstOrThrow();
        return r.status as RunStatus;
      }),

    caseContext: (run) =>
      tx((t) =>
        loadCaseContext(t, { caseId: run.caseId, mandateId: run.mandateId, requestedBy: run.requestedBy }),
      ),

    concurrencyAvailable: () =>
      tx(async (t) => {
        const r = await t
          .selectFrom('platform.agent_run')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('status', '=', 'running')
          .executeTakeFirstOrThrow();
        return Number(r.n) < (ctx.concurrency ?? DEFAULT_TENANT_CONCURRENCY);
      }),

    commit: (runId, input: CommitInput) =>
      tx(async (t) => {
        const run = await t
          .selectFrom('platform.agent_run')
          .select(['status', 'usage', 'checkpoint', 'case_id', 'subject_type', 'subject_id', 'skill_key'])
          .where('id', '=', runId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (run.status !== input.expect) throw new RunStateChanged(run.status as RunStatus);
        const { focus } = splitCheckpoint(run.checkpoint);

        // Steps (structured summaries only) and the tool-call record.
        const stepIds = new Map<number, string>();
        for (const s of input.steps ?? []) {
          const row = await t
            .insertInto('platform.agent_run_step')
            .values({
              tenant_id: ctx.tenantId,
              run_id: runId,
              seq: s.seq,
              kind: s.kind,
              status: s.status,
              summary: s.summary.slice(0, 280),
              data: JSON.stringify(s.data),
              finished_at: s.status === 'started' ? null : sql<Date>`now()`,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          stepIds.set(s.seq, row.id);
        }
        if (input.toolCall) {
          const rec = input.toolCall.record;
          await t
            .insertInto('platform.tool_call')
            .values({
              tenant_id: ctx.tenantId,
              run_id: runId,
              step_id: stepIds.get(input.toolCall.seq) ?? null,
              tool_name: rec.tool,
              tool_version: rec.toolVersion,
              args_hash: rec.argsHash,
              args_redacted: JSON.stringify(rec.argsRedacted),
              scope_check: JSON.stringify(rec.scopeCheck),
              outcome: rec.outcome,
              result_summary: rec.resultSummary.slice(0, 280),
              latency_ms: rec.latencyMs,
            })
            .execute();
        }

        // Proposals: regeneration supersedes pending proposals of the same skill and subject only.
        const proposalIds: string[] = [];
        const checkpoint: Checkpoint & { focus: Record<string, string> } = { ...input.checkpoint, focus };
        if (input.proposals) {
          const subjectRuns = t
            .selectFrom('platform.agent_run')
            .select('id')
            .where('subject_type', '=', run.subject_type)
            .where('subject_id', '=', run.subject_id);
          await t
            .updateTable('platform.proposal')
            .set({ status: 'superseded' })
            .where('status', '=', 'proposed')
            .where('skill_key', '=', input.proposals.skill)
            .where('run_id', 'in', subjectRuns)
            .execute();
          for (const payload of input.proposals.output.proposals) {
            const row = await t
              .insertInto('platform.proposal')
              .values({
                tenant_id: ctx.tenantId,
                case_id: run.case_id,
                run_id: runId,
                skill_key: input.proposals.skill,
                payload: JSON.stringify(payload),
                status: 'proposed',
                // Distinct, increasing timestamps keep the proposals in output order.
                created_at: sql<Date>`clock_timestamp()`,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            proposalIds.push(row.id);
          }
          checkpoint.output = { proposalIds };
          if (proposalIds.length > 0)
            await auditWriter.record(t, {
              actorUserId: null,
              actorKind: 'system',
              actorRole: null,
              action: 'proposal.created',
              objectType: 'analysis_run',
              objectId: runId,
              objectVersion: null,
              caseId: run.case_id,
              beforeHash: null,
              afterHash: null,
              summary: `${proposalIds.length} AI proposal${proposalIds.length === 1 ? '' : 's'} for review (${input.proposals.skill})`,
              details: { count: proposalIds.length, skill: input.proposals.skill },
              authz: { decision: 'allow', rule: 'system:worker', authorityGrantId: null },
            });
        }

        // Usage, checkpoint and transition.
        const usage = { ...ZERO, ...(run.usage as unknown as Partial<RunUsage>) };
        for (const [k, v] of Object.entries(input.usage ?? {})) usage[k as keyof RunUsage] += v ?? 0;
        const tr = input.transition;
        await t
          .updateTable('platform.agent_run')
          .set({
            checkpoint: JSON.stringify(checkpoint),
            last_checkpoint_seq: input.checkpoint.seq,
            usage: JSON.stringify(usage),
            ...(tr
              ? {
                  status: tr.to,
                  status_detail: tr.detail,
                  ...(tr.needsInput !== undefined
                    ? { needs_input: tr.needsInput ? JSON.stringify(tr.needsInput) : null }
                    : {}),
                  ...(tr.error !== undefined ? { error: tr.error ? JSON.stringify(tr.error) : null } : {}),
                  ...(tr.started
                    ? { started_at: sql<Date>`coalesce(started_at, now())`, finished_at: null }
                    : {}),
                  ...(tr.finished ? { finished_at: sql<Date>`now()` } : {}),
                }
              : {}),
          })
          .where('id', '=', runId)
          .execute();
        if (tr) {
          await auditWriter.record(t, {
            actorUserId: null,
            actorKind: 'system',
            actorRole: null,
            action: tr.auditAction,
            objectType: 'analysis_run',
            objectId: runId,
            objectVersion: null,
            caseId: run.case_id,
            beforeHash: null,
            afterHash: null,
            summary: `Analysis ${run.skill_key}: ${tr.from} → ${tr.to}`,
            details: { from: tr.from, to: tr.to, errorCode: tr.error?.code ?? null },
            authz: { decision: 'allow', rule: 'system:worker', authorityGrantId: null },
          });
          await auditWriter.emit(t, {
            type: 'analysis_run.status_changed',
            eventId: crypto.randomUUID(),
            tenantId: ctx.tenantId,
            caseId: run.case_id,
            actorId: null,
            occurredAt: new Date().toISOString(),
            correlationId: ctx.correlationId,
            runId,
            from: tr.from,
            to: tr.to,
          });
        }
        return { proposalIds };
      }),
  };
}
