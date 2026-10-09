/**
 * Analysis runs and proposals (WS5, PRD §8, ARCHITECTURE §12). Nine endpoints:
 *   analysis.start · analysis.get · analysis.latestForCase · analysis.cancel · analysis.resume ·
 *   analysis.provideInput · analysis.proposals · analysis.decideProposal · opportunities.requestDiscovery
 *
 * Runs execute in the worker (`analysis.run`), never in the request path: start, resume and answers are
 * acknowledged with 202 and the job is enqueued in the same transaction. Human commands on a run go
 * through `runMachine` (cancel by requester or case owner, resume from a checkpoint, answer by the
 * requester). Agent output is only ever a proposal; accepting one writes the business record with
 * provenance through the record writers, inside this pipeline. An outcome recommendation is never a
 * decision. Nothing else in the product depends on a run: with analysis turned off
 * (`ANALYSIS_ENABLED=false`) or failing, every workflow still completes by hand.
 */
import {
  API,
  ProposalPayload,
  RUN_STATUS_LABELS,
  type AnalysisRun,
  type Proposal,
  type RunBudget,
  type RunStatus,
  type RunStep,
  type SkillKey,
} from '@growth-os/contracts';
import { createFileSkillLoader, hashOf, type SkillLoader } from '@growth-os/ai';
import type { Tx } from '@growth-os/db';
import { runMachine } from '@growth-os/domain';
import { caseVisible, roleAllows } from '../../platform/authz';
import { isUuid, resolveCase, type CaseRow } from '../../platform/cases';
import type { Authorization, Identity } from '../../platform/context';
import { ApiError } from '../../platform/errors';
import { pageOf } from '../../platform/pagination';
import { command, query, type HandlerMap, type Tools } from '../../platform/pipeline';
import { isoDateTime, isoDateTimeOrNull, personRef } from '../../platform/serialize';
import { createOpportunityFromProposal } from '../me/opportunities/writers';
import { createClaimFromProposal } from '../me/thesis/writers';

export const ANALYSIS_RUN_JOB = 'analysis.run';
const DISCOVERY_SKILL: SkillKey = 'mandate-to-search-plan';

let skillLoader: SkillLoader | null = null;
const skills = () => (skillLoader ??= createFileSkillLoader());

/** Analysis is on unless ANALYSIS_ENABLED=false. Turning it off never blocks a manual workflow. */
export function analysisEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.ANALYSIS_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function providerInfo(env: NodeJS.ProcessEnv = process.env): {
  provider: string;
  modelConfig: string | null;
} {
  const provider = env.ANALYSIS_PROVIDER === 'claude' ? 'claude' : 'fixture';
  return { provider, modelConfig: provider === 'claude' ? (env.ANALYSIS_MODEL ?? null) : null };
}

// ---------------------------------------------------------------------------
// Loading and visibility
// ---------------------------------------------------------------------------

interface MandateRow {
  id: string;
  key: string;
  title: string;
  status: string;
  businessUnitId: string;
  ownerUserId: string | null;
}

async function resolveMandate(tx: Tx, ref: string): Promise<MandateRow | null> {
  const m = await tx
    .selectFrom('me.mandate as m')
    .leftJoin('me.mandate_version as v', 'v.id', 'm.current_version_id')
    .select(['m.id', 'm.display_key', 'm.title', 'm.status', 'm.business_unit_id', 'v.owner_user_id'])
    .where(isUuid(ref) ? 'm.id' : 'm.display_key', '=', ref)
    .executeTakeFirst();
  return m
    ? {
        id: m.id,
        key: m.display_key,
        title: m.title,
        status: m.status,
        businessUnitId: m.business_unit_id,
        ownerUserId: m.owner_user_id,
      }
    : null;
}

const mandateVisible = (identity: Identity, m: MandateRow): Authorization =>
  roleAllows(
    identity.subject,
    'case.read',
    { businessUnitId: m.businessUnitId, caseId: null },
    { hidden: true },
  );

/** A run's subject: its case, or the mandate of a discovery run. */
interface Subject {
  case: CaseRow | null;
  mandate: MandateRow | null;
}

function subjectVisible(identity: Identity, s: Subject): Authorization {
  if (s.case) return caseVisible(identity.subject, s.case);
  if (s.mandate) return mandateVisible(identity, s.mandate);
  return { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };
}

/** Commands on runs are for people only; agents and services are refused before anything is read. */
function personOnly(identity: Identity): Authorization | null {
  return identity.actor.kind === 'human' && identity.interactive
    ? null
    : {
        allow: false,
        rule: 'human_only',
        code: 'AGENT_IDENTITY_FORBIDDEN',
        reason: 'This action needs a person signed in interactively.',
      };
}

const scopeOf = (s: Subject) => ({
  businessUnitId: s.case?.businessUnitId ?? s.mandate?.businessUnitId ?? null,
  caseId: s.case?.id ?? null,
});

type RunRow = Awaited<ReturnType<typeof runRow>> & object;

async function runRow(tx: Tx, id: string) {
  return tx.selectFrom('platform.agent_run').selectAll().where('id', '=', id).executeTakeFirst();
}

async function subjectOfRun(tx: Tx, run: RunRow): Promise<Subject> {
  if (run.subject_type === 'case') return { case: await resolveCase(tx, run.subject_id), mandate: null };
  return { case: null, mandate: await resolveMandate(tx, run.subject_id) };
}

interface RunFacts {
  run: RunRow;
  subject: Subject;
}

async function loadRun(tx: Tx, id: string): Promise<RunFacts | null> {
  const run = await runRow(tx, id);
  if (!run) return null;
  return { run, subject: await subjectOfRun(tx, run) };
}

const authorizeRunRead = (identity: Identity, f: RunFacts | null): Authorization =>
  f
    ? subjectVisible(identity, f.subject)
    : { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

async function people(tx: Tx, ids: readonly (string | null)[]) {
  const want = [...new Set(ids.filter((x): x is string => x !== null))];
  const rows = want.length
    ? await tx
        .selectFrom('platform.app_user')
        .select(['id', 'display_name', 'title', 'initials'])
        .where('id', 'in', want)
        .execute()
    : [];
  return new Map(rows.map((r) => [r.id, personRef(r)]));
}

const ZERO_USAGE = { elapsedMs: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 };

function toRun(r: RunRow, who: Map<string, ReturnType<typeof personRef>>): AnalysisRun {
  const status = r.status as RunStatus;
  const checkpoint = (r.checkpoint ?? {}) as { v?: number; outputMeta?: AnalysisRun['output'] };
  return {
    id: r.id,
    caseId: r.case_id,
    mandateId: r.subject_type === 'mandate' ? r.subject_id : null,
    skill: r.skill_key as SkillKey,
    skillVersion: r.skill_version,
    goal: r.goal,
    status,
    statusLabel: RUN_STATUS_LABELS[status],
    statusDetail: r.status_detail,
    requestedBy: who.get(r.requested_by)!,
    provider: r.provider,
    modelConfig: r.model_config,
    inputSnapshotHash: r.input_snapshot_hash,
    budget: r.budget as unknown as RunBudget,
    usage: { ...ZERO_USAGE, ...(r.usage as object) },
    lastCheckpointSeq: checkpoint.v === 1 ? r.last_checkpoint_seq : 0,
    needsInput: (r.needs_input as AnalysisRun['needsInput']) ?? null,
    error: (r.error as AnalysisRun['error']) ?? null,
    createdAt: isoDateTime(r.created_at),
    startedAt: isoDateTimeOrNull(r.started_at),
    finishedAt: isoDateTimeOrNull(r.finished_at),
    correlationId: r.correlation_id,
    output: checkpoint.v === 1 ? (checkpoint.outputMeta ?? null) : null,
  };
}

async function serializeRun(tx: Tx, r: RunRow): Promise<AnalysisRun> {
  return toRun(r, await people(tx, [r.requested_by]));
}

async function stepsOf(tx: Tx, runId: string): Promise<RunStep[]> {
  const rows = await tx
    .selectFrom('platform.agent_run_step')
    .select(['id', 'run_id', 'seq', 'kind', 'status', 'summary', 'started_at', 'finished_at'])
    .where('run_id', '=', runId)
    .orderBy('seq')
    .execute();
  return rows.map((s) => ({
    id: s.id,
    runId: s.run_id,
    seq: s.seq,
    kind: s.kind as RunStep['kind'],
    status: s.status as RunStep['status'],
    summary: s.summary,
    startedAt: isoDateTime(s.started_at),
    finishedAt: isoDateTimeOrNull(s.finished_at),
  }));
}

type ProposalRow = Awaited<ReturnType<typeof proposalById>> & object;

function proposalById(tx: Tx, id: string) {
  return tx.selectFrom('platform.proposal').selectAll().where('id', '=', id).executeTakeFirst();
}

async function serializeProposals(tx: Tx, rows: readonly ProposalRow[]): Promise<Proposal[]> {
  const who = await people(
    tx,
    rows.map((r) => r.decided_by),
  );
  return rows.map((r) => ({
    id: r.id,
    caseId: r.case_id,
    runId: r.run_id,
    skill: r.skill_key as SkillKey,
    payload: ProposalPayload.parse(r.payload),
    targetType: r.target_type,
    targetId: r.target_id,
    status: r.status as Proposal['status'],
    decidedBy: r.decided_by ? (who.get(r.decided_by) ?? null) : null,
    decidedAt: isoDateTimeOrNull(r.decided_at),
    createdAt: isoDateTime(r.created_at),
  }));
}

// ---------------------------------------------------------------------------
// Commands on runs
// ---------------------------------------------------------------------------

async function createRun(
  ctx: { tenantId: string; userId: string; correlationId: string; idempotencyKey: string | null },
  t: Tools,
  input: { skill: SkillKey; goal: string; focus: Record<string, string>; subject: Subject },
): Promise<RunRow> {
  if (!analysisEnabled())
    throw new ApiError(
      'CONNECTOR_UNAVAILABLE',
      'Analysis is turned off. Continue by hand; nothing depends on it.',
    );
  const bundle = await skills().load(input.skill);
  const isMandate = !input.subject.case;
  if ((bundle.subject === 'mandate') !== isMandate)
    throw new ApiError(
      'VALIDATION_FAILED',
      isMandate
        ? 'This analysis needs an expansion case.'
        : 'Use discovery on the mandate for this analysis.',
      { errors: [{ path: 'body.skill', code: 'invalid_skill', message: 'Skill does not fit this subject' }] },
    );
  const subjectId = input.subject.case?.id ?? input.subject.mandate!.id;
  const agent = await t.tx
    .selectFrom('platform.app_user')
    .select('id')
    .where('kind', '=', 'agent')
    .where('is_active', '=', true)
    .orderBy('created_at')
    .executeTakeFirst();
  const { provider, modelConfig } = providerInfo();
  const row = await t.tx
    .insertInto('platform.agent_run')
    .values({
      tenant_id: ctx.tenantId,
      case_id: input.subject.case?.id ?? null,
      subject_type: isMandate ? 'mandate' : 'case',
      subject_id: subjectId,
      skill_key: input.skill,
      skill_version: bundle.version,
      goal: input.goal,
      status: 'queued',
      requested_by: ctx.userId,
      agent_principal_id: agent?.id ?? null,
      provider,
      model_config: modelConfig,
      input_snapshot_hash: hashOf({
        skill: input.skill,
        version: bundle.version,
        subjectId,
        goal: input.goal,
        focus: input.focus,
      }),
      budget: JSON.stringify(bundle.budget),
      checkpoint: JSON.stringify({ focus: input.focus }),
      correlation_id: ctx.correlationId,
      idempotency_key: `${ctx.userId}:${ctx.idempotencyKey ?? ctx.correlationId}`,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await t.audit({
    action: 'analysis_run.requested',
    objectType: 'analysis_run',
    objectId: row.id,
    caseId: row.case_id,
    summary: `Analysis requested: ${input.skill} on ${input.subject.case?.key ?? input.subject.mandate!.key}`,
    details: { skill: input.skill, skillVersion: bundle.version, provider },
  });
  await t.enqueue(ANALYSIS_RUN_JOB, { runId: row.id, resume: false });
  return row;
}

function applyHuman(identity: Identity, f: RunFacts, commandName: 'cancel' | 'resume' | 'input_received') {
  const ownerId = f.subject.case?.ownerUserId ?? f.subject.mandate?.ownerUserId ?? null;
  const budget = f.run.budget as unknown as RunBudget;
  const usage = { ...ZERO_USAGE, ...(f.run.usage as object) };
  const r = runMachine.apply(f.run.status as RunStatus, commandName, identity.actor, {
    requesterId: f.run.requested_by,
    caseOwnerId: ownerId,
    checkpointExists: ((f.run.checkpoint ?? {}) as { v?: number }).v === 1,
    budgetAvailable: usage.costMicros < budget.maxCostMicros,
  });
  if (!r.ok)
    throw new ApiError(r.code, r.reasons[0] ?? 'This action is not possible in the current state.', {
      blockers: r.failed.map((g) => ({ key: g.key, message: g.message ?? g.key })),
    });
  return r;
}

async function recordHuman(
  t: Tools,
  f: RunFacts,
  r: { auditAction: string; from: RunStatus; to: RunStatus },
  summary: string,
) {
  await t.audit({
    action: r.auditAction,
    objectType: 'analysis_run',
    objectId: f.run.id,
    caseId: f.run.case_id,
    summary,
    details: { from: r.from, to: r.to },
  });
}

// ---------------------------------------------------------------------------
// Proposal decisions
// ---------------------------------------------------------------------------

interface ProposalFacts {
  proposal: ProposalRow;
  run: RunRow;
  subject: Subject;
}

/** Edits may change wording and drop citations; they cannot change the type or add citations. */
function validateEdit(original: ProposalPayload, edited: unknown): ProposalPayload {
  const parsed = ProposalPayload.safeParse(edited);
  if (!parsed.success || parsed.data.type !== original.type)
    throw new ApiError('VALIDATION_FAILED', 'The edited proposal does not match its type.', {
      errors: [
        {
          path: 'body.editedPayload',
          code: 'invalid_payload',
          message: `Expected a ${original.type} proposal`,
        },
      ],
    });
  const cited = (p: ProposalPayload): string[] =>
    p.type === 'claim'
      ? p.claim.evidenceIds
      : p.type === 'opportunity_candidate' || p.type === 'assumption_value'
        ? p.evidenceIds
        : [];
  const allowed = new Set(cited(original));
  if (cited(parsed.data).some((id) => !allowed.has(id)))
    throw new ApiError('VALIDATION_FAILED', 'Edits cannot add citations the analysis did not return.', {
      errors: [{ path: 'body.editedPayload', code: 'citation_added', message: 'Only remove citations' }],
    });
  if (
    parsed.data.type === 'claim' &&
    cited(parsed.data).length === 0 &&
    parsed.data.claim.kind === 'evidence'
  )
    throw new ApiError(
      'VALIDATION_FAILED',
      'An evidence claim needs a citation; mark it as an assumption or unknown.',
    );
  return parsed.data;
}

/**
 * Map ids cited by the run (passage ids returned by `evidence.get`, or source ids) to source ids,
 * keeping only rows that exist in this tenant. The record writers take source ids.
 */
async function citedSourceIds(tx: Tx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const [passages, sources] = await Promise.all([
    tx
      .selectFrom('platform.evidence_passage')
      .select('source_id')
      .where('id', 'in', [...ids])
      .execute(),
    tx
      .selectFrom('platform.source')
      .select('id')
      .where('id', 'in', [...ids])
      .execute(),
  ]);
  return [...new Set([...passages.map((p) => p.source_id), ...sources.map((s) => s.id)])];
}

/**
 * Accepting a proposal writes the business record through WS4a's record writers (D-076), inside this
 * pipeline: a candidate becomes a Detected opportunity ("Proposed · AI"); a claim becomes an AI draft
 * claim on the case that a person still accepts as a fact with `claims.accept` (never-rule 11).
 */
async function applyAccepted(
  ctx: { tenantId: string; userId: string; now: Date; identity: Identity },
  t: Tools,
  f: ProposalFacts,
  payload: ProposalPayload,
  edited: boolean,
): Promise<{ targetType: string | null; targetId: string | null }> {
  const who = { tenantId: ctx.tenantId, actorUserId: ctx.userId, now: ctx.now, identity: ctx.identity };
  switch (payload.type) {
    case 'opportunity_candidate': {
      if (!f.subject.mandate)
        throw new ApiError('VALIDATION_FAILED', 'A candidate can only be accepted on its mandate.');
      const o = await createOpportunityFromProposal(t, who, {
        mandateId: f.subject.mandate.id,
        name: payload.name,
        trigger: payload.trigger,
        fitRationale: payload.fitRationale,
        fitCriteria: payload.fitCriteria.map((c) => ({ ...c, note: null })),
        unknowns: payload.unknowns,
        sourceIds: await citedSourceIds(t.tx, payload.evidenceIds),
        likelyDuplicateOfId: payload.likelyDuplicateOfOpportunityId,
        agentRunId: f.run.id,
        proposalId: f.proposal.id,
        edited,
      });
      return { targetType: 'opportunity', targetId: o.id };
    }
    case 'claim': {
      if (!f.run.case_id) throw new ApiError('VALIDATION_FAILED', 'A claim can only be accepted on a case.');
      const k = payload.claim.kind;
      if (k === 'scenario' || k === 'actual')
        throw new ApiError('VALIDATION_FAILED', 'An AI claim cannot be a scenario or an actual.');
      const c = await createClaimFromProposal(t, who, {
        caseId: f.run.case_id,
        statement: payload.claim.statement,
        sourceIds: await citedSourceIds(t.tx, payload.claim.evidenceIds),
        kind: k,
        edited,
        agentRunId: f.run.id,
        proposalId: f.proposal.id,
      });
      return { targetType: 'claim', targetId: c.id };
    }
    default:
      // Adopted as a draft for the owning screen. Never a decision, approval, sign-off or outcome:
      // an outcome recommendation stays a recommendation until an authorized person decides.
      return { targetType: null, targetId: null };
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const analysisHandlers: HandlerMap = {
  [API.analysis.start.id]: command(API.analysis.start, {
    load: (ctx, tx) => resolveCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) => {
      const person = personOnly(ctx.identity);
      if (person) return person;
      if (!c) return { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };
      const seen = caseVisible(ctx.identity.subject, c);
      if (!seen.allow) return seen;
      return roleAllows(ctx.identity.subject, 'analysis.start', {
        businessUnitId: c.businessUnitId,
        caseId: c.id,
      });
    },
    handle: async (ctx, t, c) => {
      const row = await createRun(ctx, t, {
        skill: ctx.body.skill,
        goal: ctx.body.goal,
        focus: ctx.body.focus,
        subject: { case: c!, mandate: null },
      });
      return serializeRun(t.tx, row);
    },
  }),

  [API.opportunities.requestDiscovery.id]: command(API.opportunities.requestDiscovery, {
    load: (ctx, tx) => resolveMandate(tx, ctx.params.ref),
    authorize: (ctx, m) => {
      const person = personOnly(ctx.identity);
      if (person) return person;
      if (!m) return { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };
      const seen = mandateVisible(ctx.identity, m);
      if (!seen.allow) return seen;
      return roleAllows(ctx.identity.subject, 'analysis.start', {
        businessUnitId: m.businessUnitId,
        caseId: null,
      });
    },
    handle: async (ctx, t, m) => {
      if (m!.status !== 'approved')
        throw new ApiError('PRECONDITIONS_UNMET', 'Discovery needs an approved mandate (G0).', {
          blockers: [{ key: 'mandate_approved', message: `${m!.key} is not approved yet` }],
        });
      const row = await createRun(ctx, t, {
        skill: DISCOVERY_SKILL,
        goal: `Discover candidates for ${m!.key}`,
        focus: {},
        subject: { case: null, mandate: m! },
      });
      return { runId: row.id };
    },
  }),

  [API.analysis.get.id]: query(API.analysis.get, {
    load: (ctx, tx) => loadRun(tx, ctx.params.id),
    authorize: (ctx, f) => authorizeRunRead(ctx.identity, f),
    handle: async (_ctx, { tx }, f) => ({
      run: await serializeRun(tx, f!.run),
      steps: await stepsOf(tx, f!.run.id),
    }),
  }),

  [API.analysis.latestForCase.id]: query(API.analysis.latestForCase, {
    load: (ctx, tx) => resolveCase(tx, ctx.params.caseRef),
    authorize: (ctx, c) =>
      c
        ? caseVisible(ctx.identity.subject, c)
        : { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' },
    handle: async (ctx, { tx }, c) => {
      const rows = await tx
        .selectFrom('platform.agent_run')
        .selectAll()
        .where('case_id', '=', c!.id)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      const page = pageOf(rows, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
        tenantId: ctx.tenantId,
        op: API.analysis.latestForCase.id,
        now: ctx.now,
        keyOf: (r) => ({ key: isoDateTime(r.created_at), id: r.id }),
      });
      const who = await people(
        tx,
        page.items.map((r) => r.requested_by),
      );
      return { items: page.items.map((r) => toRun(r, who)), nextCursor: page.nextCursor };
    },
  }),

  [API.analysis.cancel.id]: command(API.analysis.cancel, {
    load: (ctx, tx) => loadRun(tx, ctx.params.id),
    authorize: (ctx, f) => personOnly(ctx.identity) ?? authorizeRunRead(ctx.identity, f),
    handle: async (ctx, t, f) => {
      const r = applyHuman(ctx.identity, f!, 'cancel');
      const row = await t.tx
        .updateTable('platform.agent_run')
        .set({
          status: r.to,
          status_detail: 'Stopped — your work is saved',
          needs_input: null,
          finished_at: ctx.now,
        })
        .where('id', '=', f!.run.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await recordHuman(t, f!, r, `Analysis ${f!.run.skill_key} cancelled; results and edits kept`);
      return serializeRun(t.tx, row);
    },
  }),

  [API.analysis.resume.id]: command(API.analysis.resume, {
    load: (ctx, tx) => loadRun(tx, ctx.params.id),
    authorize: (ctx, f) => {
      const person = personOnly(ctx.identity);
      if (person) return person;
      const seen = authorizeRunRead(ctx.identity, f);
      if (!seen.allow) return seen;
      return roleAllows(ctx.identity.subject, 'analysis.start', scopeOf(f!.subject));
    },
    handle: async (ctx, t, f) => {
      const r = applyHuman(ctx.identity, f!, 'resume');
      if (!analysisEnabled())
        throw new ApiError(
          'CONNECTOR_UNAVAILABLE',
          'Analysis is turned off. Continue by hand; nothing depends on it.',
        );
      const row = await t.tx
        .updateTable('platform.agent_run')
        .set({ status: r.to, status_detail: null, error: null, finished_at: null })
        .where('id', '=', f!.run.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await recordHuman(t, f!, r, `Analysis ${f!.run.skill_key} resumed from its last checkpoint`);
      await t.enqueue(ANALYSIS_RUN_JOB, { runId: row.id, resume: true });
      return serializeRun(t.tx, row);
    },
  }),

  [API.analysis.provideInput.id]: command(API.analysis.provideInput, {
    load: (ctx, tx) => loadRun(tx, ctx.params.id),
    authorize: (ctx, f) => personOnly(ctx.identity) ?? authorizeRunRead(ctx.identity, f),
    handle: async (ctx, t, f) => {
      const r = applyHuman(ctx.identity, f!, 'input_received');
      const cp = (f!.run.checkpoint ?? {}) as Record<string, unknown>;
      const row = await t.tx
        .updateTable('platform.agent_run')
        .set({
          status: r.to,
          status_detail: null,
          needs_input: null,
          checkpoint: JSON.stringify({ ...cp, pendingAnswer: ctx.body.answer.slice(0, 2000) }),
        })
        .where('id', '=', f!.run.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await recordHuman(t, f!, r, `Answer given to analysis ${f!.run.skill_key}`);
      await t.enqueue(ANALYSIS_RUN_JOB, { runId: row.id, resume: false });
      return serializeRun(t.tx, row);
    },
  }),

  [API.analysis.proposals.id]: query(API.analysis.proposals, {
    // `caseRef` is a case, or a mandate for discovery proposals (MD-21): see notes, decision 6.
    load: async (ctx, tx): Promise<Subject | null> => {
      const c = await resolveCase(tx, ctx.params.caseRef);
      if (c) return { case: c, mandate: null };
      const m = await resolveMandate(tx, ctx.params.caseRef);
      return m ? { case: null, mandate: m } : null;
    },
    authorize: (ctx, s) =>
      s
        ? subjectVisible(ctx.identity, s)
        : { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' },
    handle: async (ctx, { tx }, s) => {
      const statuses =
        ctx.query.status === 'accepted'
          ? ['accepted', 'edited_and_accepted']
          : [ctx.query.status ?? 'proposed'];
      let q = tx.selectFrom('platform.proposal').selectAll().where('status', 'in', statuses);
      q = s!.case
        ? q.where('case_id', '=', s!.case.id)
        : q.where('run_id', 'in', (eb) =>
            eb
              .selectFrom('platform.agent_run')
              .select('id')
              .where('subject_type', '=', 'mandate')
              .where('subject_id', '=', s!.mandate!.id),
          );
      const rows = await q.orderBy('created_at').orderBy('id').execute();
      return { items: await serializeProposals(tx, rows) };
    },
  }),

  [API.analysis.decideProposal.id]: command(API.analysis.decideProposal, {
    load: async (ctx, tx): Promise<ProposalFacts | null> => {
      const proposal = await proposalById(tx, ctx.params.id);
      if (!proposal) return null;
      const run = await runRow(tx, proposal.run_id);
      if (!run) return null;
      return { proposal, run, subject: await subjectOfRun(tx, run) };
    },
    authorize: (ctx, f) => {
      if (!f) return { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };
      const seen = subjectVisible(ctx.identity, f.subject);
      if (!seen.allow) return seen;
      return roleAllows(ctx.identity.subject, 'proposal.decide', scopeOf(f.subject));
    },
    handle: async (ctx, t, f) => {
      const p = f!.proposal;
      if (p.status !== 'proposed')
        throw new ApiError(
          'INVALID_TRANSITION',
          p.status === 'superseded'
            ? 'A newer analysis replaced this proposal.'
            : 'This proposal has already been decided.',
        );
      const original = ProposalPayload.parse(p.payload);
      let status: Proposal['status'];
      let target: { targetType: string | null; targetId: string | null } = {
        targetType: null,
        targetId: null,
      };
      let payload = original;
      if (ctx.body.decision === 'reject') status = 'rejected';
      else {
        const edited = ctx.body.editedPayload !== undefined;
        payload = edited ? validateEdit(original, ctx.body.editedPayload) : original;
        status = edited ? 'edited_and_accepted' : 'accepted';
        target = await applyAccepted(ctx, t, f!, payload, edited);
      }
      const row = await t.tx
        .updateTable('platform.proposal')
        .set({
          status,
          payload: JSON.stringify(payload),
          target_type: target.targetType,
          target_id: target.targetId,
          decided_by: ctx.userId,
          decided_at: ctx.now,
          reason: ctx.body.reason,
        })
        .where('id', '=', p.id)
        .where('status', '=', 'proposed')
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new ApiError('INVALID_TRANSITION', 'This proposal has already been decided.');
      await t.audit({
        action: `proposal.${status}`,
        objectType: 'proposal',
        objectId: p.id,
        caseId: p.case_id,
        summary: `AI proposal (${original.type}) ${status.replace(/_/g, ' ')}${original.type === 'outcome_review_draft' ? ' · recommendation only, not a decision' : ''}`,
        details: {
          type: original.type,
          targetType: target.targetType,
          edited: status === 'edited_and_accepted',
        },
        before: original,
        after: payload,
      });
      await t.emit({
        type: 'proposal.decided',
        eventId: crypto.randomUUID(),
        tenantId: ctx.tenantId,
        caseId: p.case_id,
        actorId: ctx.userId,
        occurredAt: ctx.now.toISOString(),
        correlationId: ctx.correlationId,
        proposalId: p.id,
        status,
      });
      const [out] = await serializeProposals(t.tx, [row]);
      return out!;
    },
  }),
};
