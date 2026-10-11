/**
 * Validation task set drafted from a locked experiment plan (decisions.md D-090, interim answer to
 * PQ-13). G1 approval locks the experiment and the gate decision drafts its validation tasks in the
 * same transaction: no separate endpoint authors them and no person can add a task the plan does not
 * describe. Pure: owners and due dates come only from the plan and the experiment.
 *
 *   1. Select the sample          experiment owner   window start
 *   2. Brief fieldwork            fieldwork owner    window start + 1 day
 *   3…n. One task per metric      fieldwork owner    window end
 *   n+1. Record results           experiment owner   window end
 */
export interface ValidationPlanInput {
  sampleSize: number | null;
  /** ISO dates (YYYY-MM-DD). */
  windowStart: string;
  windowEnd: string;
  metrics: readonly { name: string; thresholdText: string; unit: string }[];
}

export interface ValidationTaskDraft {
  ordinal: number;
  title: string;
  function: 'strategy' | 'sales';
  ownerUserId: string;
  dueOn: string;
  deliverable: string;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function draftValidationTasks(
  plan: ValidationPlanInput,
  owners: { ownerUserId: string; fieldworkOwnerUserId: string | null },
): ValidationTaskDraft[] {
  const field = owners.fieldworkOwnerUserId ?? owners.ownerUserId;
  const briefDue =
    addDays(plan.windowStart, 1) > plan.windowEnd ? plan.windowEnd : addDays(plan.windowStart, 1);
  const tasks: Omit<ValidationTaskDraft, 'ordinal'>[] = [
    {
      title: plan.sampleSize ? `Select ${plan.sampleSize} sites for the sample` : 'Select the sample',
      function: 'strategy',
      ownerUserId: owners.ownerUserId,
      dueOn: plan.windowStart,
      deliverable: 'Sample list',
    },
    {
      title: 'Brief fieldwork on the method and outreach script',
      function: 'sales',
      ownerUserId: field,
      dueOn: briefDue,
      deliverable: 'Fieldwork briefed',
    },
    ...plan.metrics.map((m) => ({
      title: `${m.name} (target ${m.thresholdText.replace(/^≥\s*/, '')})`,
      function: 'sales' as const,
      ownerUserId: field,
      dueOn: plan.windowEnd,
      deliverable: `Record of ${m.unit}`,
    })),
    {
      title: 'Record results and nonresponse',
      function: 'strategy',
      ownerUserId: owners.ownerUserId,
      dueOn: plan.windowEnd,
      deliverable: 'Result record',
    },
  ];
  return tasks.map((t, i) => ({ ...t, ordinal: i + 1 }));
}

// ---------------------------------------------------------------------------
// S09 "Validation tasks · Draft" (D-113, D-128)
// ---------------------------------------------------------------------------

/**
 * Sync states in which a validation task is still a draft: never sent, or only previewed. Anything
 * past `in_preview` (sending, confirmed, failed, checking, paused …) is read-only here, and the database
 * guard `task_removal_guard` refuses removing it as well.
 */
export const DRAFT_TASK_SYNC_STATES: ReadonlySet<string> = new Set(['not_sent', 'in_preview']);

export function isDraftTask(syncStatus: string | null | undefined): boolean {
  return DRAFT_TASK_SYNC_STATES.has(syncStatus ?? 'not_sent');
}

/** A draft task edit: wording, owner, due date and deliverable only — never threshold, sample or budget. */
export interface ValidationTaskDraftFields {
  title: string;
  ownerId: string;
  /** ISO date (YYYY-MM-DD) or null (no due date yet). */
  dueOn: string | null;
  deliverable: string;
}

export interface DraftTaskProblem {
  field: 'title' | 'ownerId' | 'dueOn' | 'deliverable';
  message: string;
}

/**
 * Checks a draft task against the experiment: a title and a deliverable, an owner from the directory
 * (the caller passes whether the person is an active human in the tenant), and a due date inside the
 * experiment window (inclusive). Returns every problem, in field order.
 */
export function checkValidationTaskDraft(
  t: ValidationTaskDraftFields,
  ctx: { windowStart: string; windowEnd: string; ownerIsActivePerson: boolean },
): DraftTaskProblem[] {
  const problems: DraftTaskProblem[] = [];
  if (!t.title.trim()) problems.push({ field: 'title', message: 'A task needs a title.' });
  if (!ctx.ownerIsActivePerson)
    problems.push({ field: 'ownerId', message: 'Choose an owner from the directory.' });
  if (t.dueOn !== null && (t.dueOn < ctx.windowStart || t.dueOn > ctx.windowEnd))
    problems.push({
      field: 'dueOn',
      message: `The due date must be inside the experiment window (${ctx.windowStart} to ${ctx.windowEnd}).`,
    });
  if (!t.deliverable.trim()) problems.push({ field: 'deliverable', message: 'A task needs a deliverable.' });
  return problems;
}

/** The next ordinal for an added task: after every task of the set, removed ones included (D-128). */
export function nextTaskOrdinal(ordinals: readonly number[]): number {
  return ordinals.reduce((max, o) => Math.max(max, o), 0) + 1;
}
