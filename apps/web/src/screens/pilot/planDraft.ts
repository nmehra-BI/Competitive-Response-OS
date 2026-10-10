/**
 * S11 pilot plan editor model (D-112 §5): the editable rows of the plan draft and the `pilot.saveDraft`
 * patch built from them. New rows have no ids yet, so tasks name their milestone and dependencies by
 * ordinal (their number in the editor); the API resolves ordinals in the same patch and refuses cycles.
 * A blank budget line is no line (never €0); an unreadable amount blocks saving.
 */
import type { API, PilotPlanView, Task, TaskFunction } from '@growth-os/contracts';
import { isPositiveAmount, parseAmount } from './money';

export const FUNCTION_LABEL: Record<TaskFunction, string> = {
  product: 'Product',
  sales: 'Sales',
  marketing: 'Marketing',
  operations: 'Operations',
  strategy: 'Strategy',
  finance: 'Finance',
  specialist: 'Specialist',
};

export interface MilestoneRow {
  key: string;
  id: string | null;
  name: string;
  windowText: string;
  dueOn: string;
  evidenceExpected: string;
}

export interface TaskRow {
  key: string;
  id: string | null;
  title: string;
  /** 1-based number of the milestone row, or 0 for none. */
  milestone: number;
  fn: TaskFunction;
  ownerId: string;
  dependsOn: string; // "4, 5"
  dueOn: string;
  dueRule: string | null;
  deliverable: string;
  conditionKey: string | null;
  budgetAmount: string;
  budgetNote: string;
  /** Sent tasks cannot be removed (the task tool holds them). */
  locked: boolean;
}

export interface PlanRows {
  milestones: MilestoneRow[];
  tasks: TaskRow[];
}

let seq = 0;
const nextKey = (p: string) => `${p}-new-${++seq}`;

export function rowsFrom(v: PilotPlanView): PlanRows {
  const ms = v.draft?.milestones ?? [];
  const tasks = v.taskSet?.tasks ?? [];
  const ordinalOf = new Map(tasks.map((t) => [t.id, t.ordinal]));
  return {
    milestones: ms.map((m) => ({
      key: m.id,
      id: m.id,
      name: m.name,
      windowText: m.windowText,
      dueOn: m.dueOn ?? '',
      evidenceExpected: m.evidenceExpected ?? '',
    })),
    tasks: tasks.map((t: Task) => ({
      key: t.id,
      id: t.id,
      title: t.title,
      milestone: t.milestoneId ? ms.findIndex((m) => m.id === t.milestoneId) + 1 : 0,
      fn: t.function,
      ownerId: t.owner?.id ?? '',
      dependsOn: t.dependsOnTaskIds
        .map((d) => ordinalOf.get(d))
        .filter((n): n is number => n !== undefined)
        .sort((a, b) => a - b)
        .join(', '),
      dueOn: t.dueOn ?? '',
      dueRule: t.dueRule,
      deliverable: t.deliverable,
      conditionKey: t.conditionKey,
      budgetAmount: t.budgetLine?.amount ?? '',
      budgetNote: t.budgetLine?.note ?? '',
      locked: t.sync.attempts > 0 || t.sync.status !== 'not_sent',
    })),
  };
}

export const newMilestone = (n: number): MilestoneRow => ({
  key: nextKey('m'),
  id: null,
  name: `M${n} · `,
  windowText: '',
  dueOn: '',
  evidenceExpected: '',
});

export const newTask = (): TaskRow => ({
  key: nextKey('t'),
  id: null,
  title: '',
  milestone: 0,
  fn: 'operations',
  ownerId: '',
  dependsOn: '',
  dueOn: '',
  dueRule: null,
  deliverable: '',
  conditionKey: null,
  budgetAmount: '',
  budgetNote: '',
  locked: false,
});

/** "4, 5" → [4, 5]; null when the text is not a list of task numbers. */
export function parseOrdinals(text: string): number[] | null {
  const parts = text
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.some((p) => !/^\d+$/.test(p) || Number(p) < 1)) return null;
  return [...new Set(parts.map(Number))];
}

export interface PlanProblem {
  field: string;
  message: string;
}

/** Field problems the editor shows before saving (the API checks the same and more). */
export function problemsOf(rows: PlanRows): PlanProblem[] {
  const out: PlanProblem[] = [];
  rows.milestones.forEach((m, i) => {
    if (!m.name.trim()) out.push({ field: `m${i}.name`, message: `Milestone ${i + 1} needs a name.` });
  });
  rows.tasks.forEach((t, i) => {
    const n = i + 1;
    if (!t.title.trim()) out.push({ field: `t${i}.title`, message: `Task ${n} needs a title.` });
    if (!t.deliverable.trim())
      out.push({ field: `t${i}.deliverable`, message: `Task ${n} needs a deliverable.` });
    const deps = parseOrdinals(t.dependsOn);
    if (deps === null)
      out.push({ field: `t${i}.dependsOn`, message: `Task ${n}: list task numbers, such as 4, 5.` });
    else if (deps.some((d) => d > rows.tasks.length))
      out.push({ field: `t${i}.dependsOn`, message: `Task ${n} depends on a task that does not exist.` });
    else if (deps.includes(n))
      out.push({ field: `t${i}.dependsOn`, message: `Task ${n} cannot depend on itself.` });
    if (t.budgetAmount.trim() && !isPositiveAmount(parseAmount(t.budgetAmount)))
      out.push({
        field: `t${i}.budget`,
        message: `Task ${n}: enter the budget line as an amount, such as 8000.`,
      });
  });
  return out;
}

type Patch = (typeof API.pilot.saveDraft.body)['_input'];

export function patchFrom(rows: PlanRows, currency: string): Patch {
  return {
    milestones: rows.milestones.map((m, i) => ({
      id: m.id,
      name: m.name.trim(),
      windowText: m.windowText.trim(),
      ordinal: i + 1,
      dueOn: m.dueOn || null,
      evidenceExpected: m.evidenceExpected.trim() || null,
    })),
    tasks: rows.tasks.map((t) => {
      const ms = t.milestone > 0 ? rows.milestones[t.milestone - 1] : undefined;
      const amount = t.budgetAmount.trim() ? parseAmount(t.budgetAmount) : null;
      return {
        id: t.id,
        title: t.title.trim(),
        milestoneId: ms?.id ?? null,
        milestoneOrdinal: ms && !ms.id ? t.milestone : null,
        function: t.fn,
        ownerId: t.ownerId || null,
        dependsOnTaskIds: [],
        dependsOnOrdinals: parseOrdinals(t.dependsOn) ?? [],
        dueOn: t.dueOn || null,
        dueRule: t.dueRule,
        deliverable: t.deliverable.trim(),
        conditionKey: t.conditionKey,
        budgetLine: amount ? { amount, currency, note: t.budgetNote.trim() || null } : null,
      };
    }),
  };
}
