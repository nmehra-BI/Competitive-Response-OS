/**
 * FROZEN endpoints: pilot plan and tasks (S11), task sync via outbox (S09, S11), budget,
 * outcomes and review decisions (S12).
 */
import { z } from 'zod';
import { DecisionOutcome, TaskFunction, TaskStatus, ThresholdResult } from '../enums';
import {
  BudgetEntry,
  BudgetMeter,
  DecisionRecord,
  MessageDraft,
  OutcomeObservation,
  OutcomeReviewView,
  PilotPlanView,
  ScopeChangeRequest,
  Task,
  TaskSet,
  TaskSyncPreview,
} from '../entities/execution';
import { GateRequest } from '../entities/gate';
import { CurrencyCode, DecimalString, Id, IsoDate, Sha256Hex } from '../primitives';
import { CaseParams, endpoint, IdParams } from './endpoint';

export const TaskDraftInput = z.object({
  id: Id.nullable(),
  title: z.string().min(1),
  milestoneId: Id.nullable(),
  function: TaskFunction,
  ownerId: Id.nullable(),
  dependsOnTaskIds: z.array(Id),
  dueOn: IsoDate.nullable(),
  dueRule: z.string().nullable(),
  deliverable: z.string().min(1),
  conditionKey: z.string().nullable(),
  /**
   * S11 pilot plan editor (D-112 §5), additive. New rows have no ids yet, so a task may name its
   * milestone and dependencies by ordinal within the same patch. Ids win when both are given.
   */
  milestoneOrdinal: z.number().int().positive().nullable().optional(),
  dependsOnOrdinals: z.array(z.number().int().positive()).optional(),
  budgetLine: z
    .object({ amount: DecimalString, currency: CurrencyCode, note: z.string().nullable() })
    .nullable()
    .optional(),
});
export type TaskDraftInput = z.infer<typeof TaskDraftInput>;

/** S09 "Validation tasks · Draft" (D-113): wording, owner, due date and deliverable only. */
export const ValidationTaskDraftInput = z.object({
  title: z.string().min(1),
  ownerId: Id,
  dueOn: IsoDate.nullable(), // inside the experiment window
  deliverable: z.string().min(1),
  function: TaskFunction.optional(), // default: the experiment owner's function, else "strategy"
});
export type ValidationTaskDraftInput = z.infer<typeof ValidationTaskDraftInput>;

export const pilotEndpoints = {
  get: endpoint({
    id: 'pilot.get',
    method: 'GET',
    path: '/me/cases/:caseRef/pilot-plan',
    summary:
      'Pinned approved baseline, conditions, budget meter, milestones/tasks with internal and external status, activation blockers.',
    screens: ['S11'],
    prd: ['ME-12', 'ME-13'],
    params: CaseParams,
    response: PilotPlanView,
  }),
  saveDraft: endpoint({
    id: 'pilot.saveDraft',
    method: 'PATCH',
    path: '/me/cases/:caseRef/pilot-plan/draft',
    summary: 'Edit milestones and tasks in the plan draft. Dependency cycles are rejected.',
    screens: ['S11'],
    prd: ['ME-12'],
    ifMatch: true,
    params: CaseParams,
    body: z.object({
      milestones: z
        .array(
          z.object({
            id: Id.nullable(),
            name: z.string(),
            windowText: z.string(),
            ordinal: z.number().int(),
            /** Additive (D-112 §5): milestone date and the evidence expected. */
            dueOn: IsoDate.nullable().optional(),
            evidenceExpected: z.string().nullable().optional(),
          }),
        )
        .optional(),
      tasks: z.array(TaskDraftInput).optional(),
    }),
    response: PilotPlanView,
  }),
  activate: endpoint({
    id: 'pilot.activate',
    method: 'POST',
    path: '/me/cases/:caseRef/pilot-plan/activate',
    summary:
      'Activate the approved plan: G2 approval effective and unexpired, blocking conditions met, every task has an owner. Commits the plan version and moves the case to Pilot running.',
    screens: ['S11'],
    prd: ['ME-12', 'ME-11'],
    auth: 'human',
    idempotent: true,
    params: CaseParams,
    response: PilotPlanView,
    successStatus: 200,
  }),
  updateTask: endpoint({
    id: 'tasks.update',
    method: 'PATCH',
    path: '/me/tasks/:id',
    summary: 'Update internal status/progress. Never changes external sync status. Never passes a gate.',
    screens: ['S11', 'MYWORK'],
    prd: ['ME-12'],
    ifMatch: true,
    params: IdParams,
    body: z.object({ status: TaskStatus.optional(), note: z.string().optional() }),
    response: Task,
  }),
  reportBlocker: endpoint({
    id: 'tasks.reportBlocker',
    method: 'POST',
    path: '/me/tasks/:id/blockers',
    summary: 'Report a blocker on a task (sets status Blocked, notifies the case owner).',
    screens: ['S11', 'MYWORK'],
    prd: ['ME-12'],
    idempotent: true,
    params: IdParams,
    body: z.object({ text: z.string().min(1) }),
    response: Task,
  }),
  requestScopeChange: endpoint({
    id: 'pilot.requestScopeChange',
    method: 'POST',
    path: '/me/cases/:caseRef/scope-change-requests',
    summary: 'Changing budget, sites or dates needs a new authorization; this opens one.',
    screens: ['S11'],
    prd: ['ME-11', '§4'],
    auth: 'human',
    idempotent: true,
    params: CaseParams,
    body: z.object({ description: z.string().min(1), requestedChanges: z.record(z.string(), z.string()) }),
    response: ScopeChangeRequest,
  }),
  messageDrafts: endpoint({
    id: 'pilot.messageDrafts',
    method: 'GET',
    path: '/me/cases/:caseRef/message-drafts',
    summary: 'Outbound message drafts. There is no send endpoint in MVP.',
    screens: ['S11'],
    prd: ['§3', 'S11'],
    params: CaseParams,
    response: z.object({ items: z.array(MessageDraft) }),
  }),
  updateMessageDraft: endpoint({
    id: 'pilot.updateMessageDraft',
    method: 'PATCH',
    path: '/me/message-drafts/:id',
    summary: 'Edit a draft. Stays a draft.',
    screens: ['S11'],
    prd: ['S11'],
    ifMatch: true,
    params: IdParams,
    body: z.object({ title: z.string().optional(), body: z.string().optional() }),
    response: MessageDraft,
  }),
  tripStopRule: endpoint({
    id: 'pilot.tripStopRule',
    method: 'POST',
    path: '/me/cases/:caseRef/stop-rules/:stopRuleId/trips',
    summary:
      'Report that a pre-registered stop rule tripped, with evidence. Creates a review item for the sponsor; never stops the case, pauses execution or passes a gate by itself (D-112). Added by D-127.',
    screens: ['S11', 'MYWORK'],
    prd: ['ME-12', '§4'],
    auth: 'human',
    idempotent: true,
    params: CaseParams.extend({ stopRuleId: Id }),
    body: z.object({ evidence: z.string().min(1) }),
    response: PilotPlanView,
  }),
};

export const taskSyncEndpoints = {
  get: endpoint({
    id: 'taskSync.get',
    method: 'GET',
    path: '/me/task-sets/:id',
    summary: 'Per-task external sync status ("5 of 6 tasks confirmed in Jira · 1 failed").',
    screens: ['S09', 'S11'],
    prd: ['ME-13'],
    params: IdParams,
    response: TaskSet,
  }),
  preview: endpoint({
    id: 'taskSync.preview',
    method: 'POST',
    path: '/me/task-sets/:id/previews',
    summary: 'Dry run: destination, project, assignees, fields, permissions. Writes nothing external.',
    screens: ['S09', 'S11'],
    prd: ['ME-13'],
    idempotent: true,
    params: IdParams,
    response: TaskSyncPreview,
  }),
  send: endpoint({
    id: 'taskSync.send',
    method: 'POST',
    path: '/me/task-sets/:id/sync',
    summary:
      'Create the approved tasks from a current preview. Writes one outbox row per task with a stable idempotency key, in one transaction. Returns immediately (202).',
    screens: ['S09', 'S11'],
    prd: ['ME-13', 'ME-11'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: z.object({ previewId: Id, previewHash: Sha256Hex }),
    response: TaskSet,
    successStatus: 202,
  }),
  retry: endpoint({
    id: 'taskSync.retry',
    method: 'POST',
    path: '/me/task-sets/:id/retry',
    summary: 'Retry only failed tasks (same idempotency keys). Confirmed tasks are never re-sent.',
    screens: ['S09', 'S11'],
    prd: ['ME-13'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: z.object({ taskIds: z.array(Id).optional() }),
    response: TaskSet,
    successStatus: 202,
  }),
  exportCsv: endpoint({
    id: 'taskSync.exportCsv',
    method: 'GET',
    path: '/me/task-sets/:id/export.csv',
    summary: 'Outage fallback: export the approved tasks as CSV (PRD §10).',
    screens: ['S11'],
    prd: ['ME-13', '§10'],
    params: IdParams,
    response: z.unknown(),
  }),
  addDraftTask: endpoint({
    id: 'tasks.addDraft',
    method: 'POST',
    path: '/me/task-sets/:id/tasks',
    summary:
      'S09 "Validation tasks · Draft": add an unsent task to a validation task set. Never carries threshold, sample or budget (D-113). Added by D-128.',
    screens: ['S09'],
    prd: ['ME-09', 'ME-13'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: ValidationTaskDraftInput,
    response: TaskSet,
  }),
  editDraftTask: endpoint({
    id: 'tasks.editDraft',
    method: 'PATCH',
    path: '/me/tasks/:id/draft',
    summary:
      'Edit title, owner, due date or deliverable of an unsent validation task. A sent task is read-only (INVALID_TRANSITION). Audited as task.updated; not material (D-113). Added by D-128.',
    screens: ['S09'],
    prd: ['ME-09', 'ME-13'],
    auth: 'human',
    ifMatch: true,
    params: IdParams,
    body: ValidationTaskDraftInput.partial(),
    response: Task,
  }),
  removeDraftTask: endpoint({
    id: 'tasks.removeDraft',
    method: 'POST',
    path: '/me/tasks/:id/removal',
    summary:
      'Remove an unsent validation draft task (kept in history, never deleted). A sent task cannot be removed (D-113). Added by D-128.',
    screens: ['S09'],
    prd: ['ME-09', 'ME-13'],
    auth: 'human',
    idempotent: true,
    ifMatch: true,
    params: IdParams,
    response: TaskSet,
    successStatus: 200,
  }),
};

export const budgetEndpoints = {
  recordEntry: endpoint({
    id: 'budget.recordEntry',
    method: 'POST',
    path: '/me/cases/:caseRef/budget-entries',
    summary:
      'Manual committed/spent entry against an approved gate budget. Over-cap spend is rejected; use a scope change.',
    screens: ['S11'],
    prd: ['ME-14'],
    auth: 'human',
    idempotent: true,
    params: CaseParams,
    body: z.object({
      gateRequestId: Id,
      kind: z.enum(['committed', 'spent']),
      amount: DecimalString,
      currency: CurrencyCode,
      asOf: IsoDate,
      sourceText: z.string().min(1), // the description
      /** S11 "Record spend" (D-114 §2), additive: PO or invoice number and an optional task link. */
      reference: z.string().min(1).nullable().optional(),
      taskId: Id.nullable().optional(),
    }),
    response: BudgetEntry,
  }),
  listEntries: endpoint({
    id: 'budget.listEntries',
    method: 'GET',
    path: '/me/cases/:caseRef/budget-entries',
    summary:
      'Budget entries (committed and spent, with reversals) and the meter for an approved gate budget. Added by D-133.',
    screens: ['S11'],
    prd: ['ME-14'],
    params: CaseParams,
    query: z.object({ gateRequestId: Id.optional() }),
    response: z.object({ items: z.array(BudgetEntry), meter: BudgetMeter.nullable() }),
  }),
  reverseEntry: endpoint({
    id: 'budget.reverseEntry',
    method: 'POST',
    path: '/me/budget-entries/:id/reversals',
    summary:
      'Correct an entry with a reversing entry and a reason (append-only; the original stays). An entry is reversed at most once; a reversal cannot be reversed. Added by D-133.',
    screens: ['S11'],
    prd: ['ME-14'],
    auth: 'human',
    idempotent: true,
    params: IdParams,
    body: z.object({ reason: z.string().min(1) }),
    response: BudgetEntry,
  }),
};

export const outcomeEndpoints = {
  get: endpoint({
    id: 'outcomes.get',
    method: 'GET',
    path: '/me/cases/:caseRef/outcome-review',
    summary: 'Baseline vs actuals, limitations, readiness, recommendation, decision and scale-gate blockers.',
    screens: ['S12'],
    prd: ['ME-14'],
    params: CaseParams,
    response: OutcomeReviewView,
  }),
  recordObservation: endpoint({
    id: 'outcomes.recordObservation',
    method: 'POST',
    path: '/me/cases/:caseRef/outcome-observations',
    summary: 'Record an actual with period and source. Edits append a new version (supersedesId).',
    screens: ['S12', 'MYWORK'],
    prd: ['ME-14'],
    auth: 'human',
    idempotent: true,
    params: CaseParams,
    body: z.object({
      targetId: Id.nullable(),
      valueText: z.string().min(1),
      value: DecimalString.nullable(),
      unit: z.string(),
      periodStart: IsoDate,
      periodEnd: IsoDate,
      sourceText: z.string().min(1),
      sourceId: Id.nullable(),
      supersedesId: Id.nullable(),
      /**
       * The person's reading against a target whose threshold has no number (a placeholder such as
       * "Within [hours per site]" or a qualitative target). For a numeric threshold it
       * must agree with the computed result (thresholds never move silently). Additive (D-081).
       */
      result: ThresholdResult.nullable().optional(),
    }),
    response: OutcomeObservation,
  }),
  saveReviewDraft: endpoint({
    id: 'outcomes.saveReviewDraft',
    method: 'PATCH',
    path: '/me/cases/:caseRef/outcome-review',
    summary:
      'Edit learned / changes next / causal limitations / recommendation (recommendation is not a decision).',
    screens: ['S12'],
    prd: ['ME-14'],
    ifMatch: true,
    params: CaseParams,
    body: z.object({
      whatWeLearned: z.array(z.string()).optional(),
      whatChangesNext: z.array(z.string()).optional(),
      causalLimitations: z.array(z.string()).optional(),
      recommendation: z.object({ outcome: DecisionOutcome, text: z.string() }).nullable().optional(),
    }),
    response: OutcomeReviewView,
  }),
  decide: endpoint({
    id: 'outcomes.decide',
    method: 'POST',
    path: '/me/cases/:caseRef/outcome-decisions',
    summary:
      'Sponsor records stop / revise / extend / proceed. "scale" is not accepted here: scale needs a G3 gate request. Extend requires an X gate request with its own cap.',
    screens: ['S12'],
    prd: ['ME-14', '§4'],
    auth: 'human',
    idempotent: true,
    params: CaseParams,
    body: z.object({
      outcome: z.enum(['stop', 'revise', 'extend', 'proceed']),
      label: z.string().min(1),
      rationale: z.string().min(1),
    }),
    response: z.object({ decision: DecisionRecord, review: OutcomeReviewView }),
  }),
  requestExtension: endpoint({
    id: 'outcomes.requestExtension',
    method: 'POST',
    path: '/me/cases/:caseRef/extension-requests',
    summary:
      'Convenience: create and submit an X gate request with its own spend cap and scope. Does not unblock G3.',
    screens: ['S12'],
    prd: ['ME-14', '§6'],
    auth: 'human',
    idempotent: true,
    params: CaseParams,
    body: z.object({
      parentGateRequestId: Id,
      // Null = the PRD placeholder ("€[cap]", "[duration] days"): submittable, never approvable
      // (D-040, widened by D-068).
      spendCap: DecimalString.nullable(),
      currency: CurrencyCode,
      durationDays: z.number().int().positive().nullable(),
      ownerId: Id,
      scopeItems: z.array(z.string()).min(1),
      /**
       * D-110 (D-136), additive: the extension window, the parent targets it re-tests
       * (unmet or inconclusive; pre-registered with the request), and the site count (a subset of the
       * parent scope: same or fewer sites, no new sites, no prospect outreach).
       */
      windowStart: IsoDate.nullable().optional(),
      windowEnd: IsoDate.nullable().optional(),
      retestTargetIds: z.array(Id).optional(),
      maxSites: z.number().int().positive().nullable().optional(),
    }),
    response: GateRequest,
  }),
};
