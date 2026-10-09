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
