/**
 * FROZEN analysis subsystem contracts (PRD §8): runs, steps, tool calls, proposals, skill outputs.
 *
 * Run status is separate from case stage. Agent output never becomes a business record directly:
 * it is stored as a Proposal that a human accepts, edits or rejects. Traces hold structured
 * outputs and tool events only, never hidden reasoning.
 */
import { z } from 'zod';
import {
  AgentToolName,
  EpistemicKind,
  ProposalStatus,
  RunStatus,
  RunStepKind,
  SkillKey,
  ToolCallOutcome,
} from '../enums';
import { DecimalString, Id, IsoDateTime, PersonRef, Sha256Hex } from '../primitives';

export const RunBudget = z.object({
  wallTimeMs: z.number().int().positive(),
  maxToolCalls: z.number().int().positive(),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  maxCostMicros: z.number().int().positive(),
});
export type RunBudget = z.infer<typeof RunBudget>;

export const RunUsage = z.object({
  elapsedMs: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costMicros: z.number().int().nonnegative(),
});
export type RunUsage = z.infer<typeof RunUsage>;

export const AnalysisRun = z.object({
  id: Id,
  caseId: Id.nullable(),
  mandateId: Id.nullable(),
  skill: SkillKey,
  skillVersion: z.string(),
  goal: z.string(),
  status: RunStatus,
  statusLabel: z.string(), // business copy from RUN_STATUS_LABELS
  statusDetail: z.string().nullable(), // "competitor scan · started 10:41 · your edits are saved"
  requestedBy: PersonRef, // the human the run acts for; tools use this person's access
  provider: z.string(), // "fixture" | "claude"
  modelConfig: z.string().nullable(), // configured model name, recorded for traceability
  inputSnapshotHash: Sha256Hex,
  budget: RunBudget,
  usage: RunUsage,
  lastCheckpointSeq: z.number().int().nonnegative(),
  needsInput: z.object({ question: z.string(), options: z.array(z.string()) }).nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  correlationId: z.string(),
  /**
   * The run's output envelope besides proposals: its summary, the unknowns it named and "What the
   * analysis did not check". Null until the run produced output. Additive (D-081, CR-WS5-2).
   */
  output: z
    .object({ summary: z.string(), unknowns: z.array(z.string()), notChecked: z.array(z.string()) })
    .nullable()
    .optional(),
});
export type AnalysisRun = z.infer<typeof AnalysisRun>;

export const RunStep = z.object({
  id: Id,
  runId: Id,
  seq: z.number().int().nonnegative(),
  kind: RunStepKind,
  status: z.enum(['started', 'succeeded', 'failed']),
  summary: z.string(), // structured summary only
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
});
export type RunStep = z.infer<typeof RunStep>;

/** Admin diagnostics trace row (S14). Args are redacted; restricted content is never stored. */
export const ToolCallRecord = z.object({
  id: Id,
  runId: Id,
  tool: AgentToolName,
  toolVersion: z.string(),
  argsHash: Sha256Hex,
  argsRedacted: z.record(z.string(), z.unknown()),
  scopeCheck: z.object({
    tenant: z.boolean(),
    entitlement: z.boolean().nullable(),
    schema: z.boolean(),
    budget: z.boolean(),
  }),
  outcome: ToolCallOutcome,
  resultSummary: z.string(), // "3 documents", "denied · not summarised", "SAM 40,000,000 · reproducible"
  latencyMs: z.number().int().nonnegative(),
  createdAt: IsoDateTime,
});
export type ToolCallRecord = z.infer<typeof ToolCallRecord>;

// ---------------------------------------------------------------------------
// Skill outputs (validated before anything is stored)
// ---------------------------------------------------------------------------

/** Every factual statement cites evidence ids that were returned to this run, or is labelled. */
export const ProposedClaim = z.object({
  statement: z.string().min(1),
  kind: EpistemicKind, // evidence | inference_ai | assumption | unknown; never scenario/actual from AI
  evidenceIds: z.array(Id), // passage ids returned by evidence.get in this run
  confidenceNote: z.null().default(null), // AI confidence scores are not displayed (research §6.8)
});
export type ProposedClaim = z.infer<typeof ProposedClaim>;

export const ProposalPayload = z.discriminatedUnion('type', [
  z.object({ type: z.literal('claim'), claim: ProposedClaim }),
  z.object({
    type: z.literal('opportunity_candidate'),
    name: z.string(),
    trigger: z.string(),
    fitRationale: z.string(),
    fitCriteria: z.array(z.object({ criterion: z.string(), result: z.enum(['met', 'not_met', 'unknown']) })),
    unknowns: z.array(z.string()),
    evidenceIds: z.array(Id),
    likelyDuplicateOfOpportunityId: Id.nullable(),
  }),
  z.object({
    type: z.literal('search_plan'),
    segments: z.array(z.string()),
    geographies: z.array(z.string()),
    queries: z.array(z.string()),
    notValidatedNotice: z.literal('AI draft · not validated'),
  }),
  z.object({
    type: z.literal('market_boundary'),
    marketUnit: z.string(),
    populationUnit: z.enum(['site', 'company', 'customer']),
    includes: z.array(z.string()),
    excludes: z.array(z.string()),
  }),
  z.object({
    type: z.literal('assumption_value'),
    inputKey: z.string(),
    value: DecimalString.nullable(),
    valueText: z.string().nullable(),
    basis: z.string(),
    evidenceIds: z.array(Id),
  }),
  z.object({
    type: z.literal('cohort_dedup'),
    cohortAId: Id,
    cohortBId: Id,
    proposedOverlap: z.number().int(),
    method: z.string(),
  }),
  z.object({
    type: z.literal('feasibility_question'),
    dimension: z.string(),
    question: z.string(), // AI may draft the question, never the answer (research §4.7)
  }),
  z.object({
    type: z.literal('assumption_priority'),
    assumptionId: Id,
    suggestedSensitivity: z.enum(['high', 'medium', 'low']),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('experiment_design'),
    assumptionIds: z.array(Id),
    hypothesis: z.string(),
    method: z.string(),
    sampleText: z.string(),
    metrics: z.array(z.object({ name: z.string(), thresholdText: z.string() })),
    decisionRules: z.array(z.object({ condition: z.string(), action: z.string() })),
    couldFalsify: z.string(),
  }),
  z.object({
    type: z.literal('pilot_task'),
    title: z.string(),
    function: z.string(),
    suggestedOwnerId: Id.nullable(),
    deliverable: z.string(),
    dependsOnTitles: z.array(z.string()),
    dueOffsetDays: z.number().int().nullable(),
  }),
  z.object({
    type: z.literal('outcome_review_draft'),
    whatWeLearned: z.array(z.string()),
    causalLimitations: z.array(z.string()),
    recommendedOutcome: z.enum(['proceed', 'revise', 'extend', 'stop', 'scale']),
    rationale: z.string(),
  }),
  z.object({
    type: z.literal('message_draft'),
    title: z.string(),
    body: z.string(),
  }),
]);
export type ProposalPayload = z.infer<typeof ProposalPayload>;

/** Common envelope every skill returns. */
export const SkillOutput = z.object({
  summary: z.string(),
  proposals: z.array(ProposalPayload),
  unknowns: z.array(z.string()),
  notChecked: z.array(z.string()), // "What the analysis did not check"
});
export type SkillOutput = z.infer<typeof SkillOutput>;

export const Proposal = z.object({
  id: Id,
  caseId: Id.nullable(),
  runId: Id,
  skill: SkillKey,
  payload: ProposalPayload,
  targetType: z.string().nullable(),
  targetId: Id.nullable(),
  status: ProposalStatus,
  decidedBy: PersonRef.nullable(),
  decidedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type Proposal = z.infer<typeof Proposal>;
