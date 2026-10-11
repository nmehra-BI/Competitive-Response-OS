/**
 * S11 pilot plan editor (D-112 §5): milestones (name, window, date, evidence expected) and tasks (title,
 * owner, dependencies, due date, deliverable, optional one-time budget line) of the plan draft.
 *
 * New rows have no ids yet, so a task may name its milestone by the milestone's ordinal and its
 * dependencies by task ordinal (its 1-based position in the patch); ids win when both are given.
 * Dependency cycles are refused. A task budget line is one-time pilot money in the plan's currency and
 * inside the approved ceiling; it is never a per-year figure and never summed with one.
 */
import type { API, TaskDraftInput } from '@growth-os/contracts';
import { sql, type Tx } from '@growth-os/db';
import { ApiError, notFound } from '../../../platform/errors';
import { cents, fmtMoneyShort, tenantIdSql, type CaseLite } from '../gates/lib/common';
import { taskRows, type VersionRow } from './view';

type Body = (typeof API.pilot.saveDraft.body)['_output'];

const invalid = (path: string, message: string, title = message): ApiError =>
  new ApiError('VALIDATION_FAILED', title, { errors: [{ path, code: 'custom', message }] });

/** Reject dependency cycles (DFS over the proposed edges). */
export function assertAcyclic(edges: Map<string, string[]>): void {
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 1) return false;
    if (state.get(n) === 2) return true;
    state.set(n, 1);
    for (const m of edges.get(n) ?? []) if (!visit(m)) return false;
    state.set(n, 2);
    return true;
  };
  for (const n of edges.keys())
    if (!visit(n))
      throw new ApiError('VALIDATION_FAILED', 'Task dependencies form a cycle.', {
        errors: [{ path: 'body.tasks', code: 'custom', message: 'Dependency cycle' }],
      });
}

export async function saveMilestones(
  tx: Tx,
  setId: string,
  milestones: NonNullable<Body['milestones']>,
): Promise<void> {
  const ordinals = milestones.map((m) => m.ordinal);
  if (new Set(ordinals).size !== ordinals.length)
    throw invalid('body.milestones', 'Each milestone needs its own number.');
  milestones.forEach((m, i) => {
    if (!m.name.trim()) throw invalid(`body.milestones.${i}.name`, 'Name the milestone.');
  });
  const existing = await tx
    .selectFrom('platform.milestone')
    .select('id')
    .where('task_set_id', '=', setId)
    .execute();
  if (milestones.some((m) => m.id && !existing.some((e) => e.id === m.id))) throw notFound();
  await tx
    .updateTable('platform.milestone')
    .set({ ordinal: sql`ordinal + 1000` })
    .where('task_set_id', '=', setId)
    .execute();
  const keep = new Set<string>();
  for (const m of milestones) {
    const values = {
      name: m.name.trim(),
      window_text: m.windowText,
      ordinal: m.ordinal,
      // Absent keeps the stored value (older clients); null clears it.
      ...(m.dueOn !== undefined ? { due_on: m.dueOn } : {}),
      ...(m.evidenceExpected !== undefined
        ? { evidence_expected: m.evidenceExpected?.trim() ? m.evidenceExpected.trim() : null }
        : {}),
    };
    if (m.id) {
      keep.add(m.id);
      await tx.updateTable('platform.milestone').set(values).where('id', '=', m.id).execute();
    } else {
      const r = await tx
        .insertInto('platform.milestone')
        .values({ ...values, tenant_id: tenantIdSql, task_set_id: setId })
        .returning('id')
        .executeTakeFirstOrThrow();
      keep.add(r.id);
    }
  }
  const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (drop.length) {
    await tx
      .updateTable('platform.task')
      .set({ milestone_id: null })
      .where('milestone_id', 'in', drop)
      .execute();
    await tx.deleteFrom('platform.milestone').where('id', 'in', drop).execute();
  }
}

type BudgetColumns = Partial<{
  budget_amount: string | null;
  budget_currency: string | null;
  budget_note: string | null;
}>;

function budgetValues(x: TaskDraftInput, i: number, plan: VersionRow): BudgetColumns {
  if (x.budgetLine === undefined) return {}; // absent keeps the stored line (older clients)
  if (x.budgetLine === null) return { budget_amount: null, budget_currency: null, budget_note: null };
  const b = x.budgetLine;
  if (b.amount.startsWith('-'))
    throw invalid(`body.tasks.${i}.budgetLine.amount`, 'A budget line is a positive one-time amount.');
  if (b.currency !== plan.currency)
    throw invalid(
      `body.tasks.${i}.budgetLine.currency`,
      `Use ${plan.currency}, the currency of the approved budget.`,
    );
  return { budget_amount: b.amount, budget_currency: b.currency, budget_note: b.note?.trim() || null };
}

export async function saveTasks(
  tx: Tx,
  c: CaseLite,
  setId: string,
  plan: VersionRow,
  tasks: TaskDraftInput[],
): Promise<void> {
  const existing = await taskRows(tx, setId);
  const ids = tasks.map((x) => x.id).filter((x): x is string => !!x);
  if (ids.some((id) => !existing.some((e) => e.id === id))) throw notFound();
  const milestones = await tx
    .selectFrom('platform.milestone')
    .select(['id', 'ordinal'])
    .where('task_set_id', '=', setId)
    .execute();
  const milestoneOf = (x: TaskDraftInput, i: number): string | null => {
    if (x.milestoneId) {
      if (!milestones.some((m) => m.id === x.milestoneId)) throw notFound();
      return x.milestoneId;
    }
    if (x.milestoneOrdinal === null || x.milestoneOrdinal === undefined) return null;
    const m = milestones.find((y) => y.ordinal === x.milestoneOrdinal);
    if (!m)
      throw invalid(`body.tasks.${i}.milestoneOrdinal`, `There is no milestone M${x.milestoneOrdinal}.`);
    return m.id;
  };
  // One-time task budget lines stay inside the approved ceiling of this plan version (exact decimals).
  const lines = tasks.map((x, i) => ({ i, v: budgetValues(x, i, plan) }));
  const total = tasks.reduce((sum, x, i) => {
    const v = lines[i]!.v;
    const stored = existing.find((e) => e.id === x.id)?.budget_amount ?? null;
    const amount = 'budget_amount' in v ? v.budget_amount : stored;
    return amount ? sum + cents(amount) : sum;
  }, 0n);
  if (total > cents(plan.budget_ceiling))
    throw invalid(
      'body.tasks',
      `Task budget lines add up to more than the approved ${fmtMoneyShort(plan.budget_ceiling, plan.currency)}.`,
    );
  // Temporary ordinals avoid unique collisions while re-ordering.
  await tx
    .updateTable('platform.task')
    .set({ ordinal: sql`ordinal + 1000` })
    .where('task_set_id', '=', setId)
    .execute();
  const idOf: string[] = [];
  for (const [i, x] of tasks.entries()) {
    if (!x.title.trim()) throw invalid(`body.tasks.${i}.title`, 'Give the task a title.');
    const values = {
      ordinal: i + 1,
      title: x.title.trim(),
      milestone_id: milestoneOf(x, i),
      function: x.function,
      owner_user_id: x.ownerId,
      due_on: x.dueOn,
      due_rule: x.dueRule,
      deliverable: x.deliverable,
      condition_key: x.conditionKey,
      ...lines[i]!.v,
    };
    if (x.id) {
      await tx.updateTable('platform.task').set(values).where('id', '=', x.id).execute();
      idOf.push(x.id);
    } else {
      const r = await tx
        .insertInto('platform.task')
        .values({ ...values, tenant_id: tenantIdSql, case_id: c.id, task_set_id: setId })
        .returning('id')
        .executeTakeFirstOrThrow();
      idOf.push(r.id);
    }
  }
  const removed = existing.filter((e) => !idOf.includes(e.id)).map((e) => e.id);
  if (removed.length) {
    const linked = await tx
      .selectFrom('platform.external_task_link')
      .select('task_id')
      .where('task_id', 'in', removed)
      .executeTakeFirst();
    if (linked)
      throw new ApiError('INVALID_TRANSITION', 'A task already sent to the task tool cannot be removed.');
    const spent = await tx
      .selectFrom('me.budget_entry')
      .select('task_id')
      .where('task_id', 'in', removed)
      .executeTakeFirst();
    if (spent) throw new ApiError('INVALID_TRANSITION', 'A task with recorded spend cannot be removed.');
    await tx
      .deleteFrom('platform.task_dependency')
      .where((eb) => eb.or([eb('task_id', 'in', removed), eb('depends_on_task_id', 'in', removed)]))
      .execute();
    await tx.deleteFrom('platform.task').where('id', 'in', removed).execute();
  }
  const edges = new Map<string, string[]>();
  tasks.forEach((x, i) => {
    const byOrdinal = (x.dependsOnOrdinals ?? []).map((n) => {
      const id = idOf[n - 1];
      if (!id) throw invalid(`body.tasks.${i}.dependsOnOrdinals`, `There is no task ${n}.`);
      return id;
    });
    // Ids win when both are given.
    edges.set(idOf[i]!, x.dependsOnTaskIds.length ? x.dependsOnTaskIds : byOrdinal);
  });
  for (const deps of edges.values()) if (deps.some((d) => !idOf.includes(d))) throw notFound();
  assertAcyclic(edges);
  await tx.deleteFrom('platform.task_dependency').where('task_id', 'in', idOf).execute();
  for (const [taskId, deps] of edges)
    for (const d of new Set(deps))
      await tx
        .insertInto('platform.task_dependency')
        .values({ tenant_id: tenantIdSql, task_id: taskId, depends_on_task_id: d })
        .execute();
}
