/**
 * S09 "Validation tasks · Draft" (D-113, D-128): after G1 approves an experiment, its experiment owner
 * and the case owner may edit the wording, owner, due date and deliverable of an unsent validation
 * task, add a task, or remove an unsent one. Tasks never carry threshold, sample or budget: those change
 * only by an amendment with a reason (D-086). Draft edits are not material (G1 authorizes the experiment
 * and its budget, not task wording), each one is audited, and none emits an analytics event.
 *
 * A sent task (any sync state past `in_preview`) is read-only and cannot be removed; the database guard
 * `task_removal_guard` refuses the removal too. Removal marks the row (never DELETE). Any edit after a
 * preview breaks that preview's content hash, so the next send refuses it until the tasks are previewed
 * again: what is written to the task tool is always what was last previewed.
 */
import { API, type Task, type TaskFunction, type ValidationTaskDraftInput } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { checkValidationTaskDraft, isDraftTask, nextTaskOrdinal } from '@growth-os/domain';
import { caseVisible, roleAllows } from '../../platform/authz';
import type { Authorization, Identity } from '../../platform/context';
import { ApiError, notFound } from '../../platform/errors';
import { assertIfMatch, command, type HandlerMap, type Tools } from '../../platform/pipeline';
import { isoDate, isoDateOrNull } from '../../platform/serialize';
import { loadTaskSet, planIsCurrent, toTaskSetView, type LoadedSet } from './store';

/** May this person edit the drafts of this set? Case visibility first (404), then `experiment.edit`. */
export function draftAccess(identity: Identity, s: LoadedSet): Authorization {
  const visible = caseVisible(identity.subject, s.kase);
  if (!visible.allow) return visible;
  const scope = { businessUnitId: s.kase.businessUnitId, caseId: s.kase.id };
  const r = roleAllows(identity.subject, 'experiment.edit', scope);
  return r.allow ? { ...r, rule: `validation_task_draft:${r.rule}` } : r;
}

/** `TaskSet.draftEditable` for the viewer: an experiment set, still in force, and the viewer may edit it. */
export async function draftEditableFor(tx: Tx, identity: Identity, s: LoadedSet): Promise<boolean> {
  if (s.ownerType !== 'experiment') return false;
  if (!draftAccess(identity, s).allow) return false;
  return planIsCurrent(tx, s);
}

interface DraftFacts {
  set: LoadedSet;
  task: TaskRecord | null;
}

interface TaskRecord {
  id: string;
  ordinal: number;
  title: string;
  owner_user_id: string | null;
  due_on: string | null;
  deliverable: string;
  function: string;
  row_version: number;
  removed_at: Date | null;
  sync_status: string | null;
}

async function loadTask(tx: Tx, id: string): Promise<DraftFacts> {
  const t = await tx
    .selectFrom('platform.task as t')
    .leftJoin('platform.task_set as s', 's.id', 't.task_set_id')
    .leftJoin('platform.external_task_link as l', (j) =>
      j.onRef('l.task_id', '=', 't.id').onRef('l.connection_id', '=', 's.connection_id'),
    )
    .select([
      't.id',
      't.task_set_id',
      't.ordinal',
      't.title',
      't.owner_user_id',
      't.due_on',
      't.deliverable',
      't.function',
      't.row_version',
      't.removed_at',
      'l.sync_status',
    ])
    .where('t.id', '=', id)
    .executeTakeFirst();
  if (!t) throw notFound();
  const set = await loadTaskSet(tx, t.task_set_id);
  return {
    set,
    task: {
      ...t,
      due_on: isoDateOrNull(t.due_on),
    },
  };
}

/** Only an experiment (validation) set in force can be edited here. */
async function requireEditableSet(tx: Tx, s: LoadedSet): Promise<void> {
  if (s.ownerType !== 'experiment')
    throw new ApiError(
      'INVALID_TRANSITION',
      'Pilot tasks are edited in the pilot plan, not as validation drafts.',
    );
  if (!(await planIsCurrent(tx, s)))
    throw new ApiError(
      'PRECONDITIONS_UNMET',
      'Validation tasks can be edited once G1 approves the experiment.',
      {
        blockers: [
          {
            key: 'plan_current',
            message: 'The experiment is not locked by the approval that authorizes these tasks.',
          },
        ],
      },
    );
}

function requireUnsent(task: TaskRecord, verb: 'edit' | 'remove'): void {
  if (task.removed_at !== null)
    throw new ApiError('INVALID_TRANSITION', 'This task was removed. Add a new task instead.');
  if (!isDraftTask(task.sync_status))
    throw new ApiError(
      'INVALID_TRANSITION',
      verb === 'edit'
        ? 'This task was sent to the task tool and is read-only here.'
        : 'A sent task cannot be removed.',
    );
}

/** The experiment window (the plan in force: the latest version, amendments included). */
async function experimentWindow(tx: Tx, experimentId: string): Promise<{ start: string; end: string }> {
  const v = await tx
    .selectFrom('me.experiment_plan_version')
    .select(['window_start', 'window_end'])
    .where('experiment_id', '=', experimentId)
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
  return { start: isoDate(v.window_start), end: isoDate(v.window_end) };
}

async function isActivePerson(tx: Tx, userId: string): Promise<boolean> {
  const u = await tx
    .selectFrom('platform.app_user')
    .select('id')
    .where('id', '=', userId)
    .where('kind', '=', 'human')
    .where('is_active', '=', true)
    .executeTakeFirst();
  return !!u;
}

async function validate(tx: Tx, s: LoadedSet, input: ValidationTaskDraftInput): Promise<void> {
  const window = await experimentWindow(tx, s.ownerId);
  const problems = checkValidationTaskDraft(input, {
    windowStart: window.start,
    windowEnd: window.end,
    ownerIsActivePerson: await isActivePerson(tx, input.ownerId),
  });
  if (problems.length)
    throw new ApiError('VALIDATION_FAILED', problems[0]!.message, {
      errors: problems.map((p) => ({ path: `body.${p.field}`, code: 'invalid', message: p.message })),
    });
}

/** Field names that changed (never their values: the audit trail carries no task text). */
function changedFields(before: TaskRecord, after: ValidationTaskDraftInput): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push('title');
  if (before.owner_user_id !== after.ownerId) out.push('owner');
  if (before.due_on !== after.dueOn) out.push('due date');
  if (before.deliverable !== after.deliverable) out.push('deliverable');
  if (after.function && before.function !== after.function) out.push('function');
  return out;
}

async function setView(t: Tools, identity: Identity, setId: string) {
  const s = await loadTaskSet(t.tx, setId);
  return toTaskSetView(s, { draftEditable: await draftEditableFor(t.tx, identity, s) });
}

export const taskDraftHandlers: HandlerMap = {
  // ---- POST /me/task-sets/:id/tasks ---------------------------------------------------------------
  [API.taskSync.addDraftTask.id]: command(API.taskSync.addDraftTask, {
    load: (ctx, tx) => loadTaskSet(tx, ctx.params.id),
    authorize: (ctx, s) => draftAccess(ctx.identity, s),
    handle: async (ctx, t, s) => {
      await requireEditableSet(t.tx, s);
      await validate(t.tx, s, ctx.body);
      const ordinals = await t.tx
        .selectFrom('platform.task')
        .select('ordinal')
        .where('task_set_id', '=', s.id)
        .execute();
      const ordinal = nextTaskOrdinal(ordinals.map((o) => o.ordinal));
      const fn: TaskFunction = ctx.body.function ?? 'strategy';
      const row = await t.tx
        .insertInto('platform.task')
        .values({
          tenant_id: ctx.tenantId,
          case_id: s.kase.id,
          task_set_id: s.id,
          ordinal,
          title: ctx.body.title.trim(),
          function: fn,
          owner_user_id: ctx.body.ownerId,
          due_on: ctx.body.dueOn,
          deliverable: ctx.body.deliverable.trim(),
          created_at: ctx.now,
        })
        .returning(['id', 'row_version'])
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'task.created',
        objectType: 'task',
        objectId: row.id,
        objectVersion: row.row_version,
        caseId: s.kase.id,
        summary: `Validation task ${ordinal} added as a draft (not sent until previewed and sent)`,
        details: { taskSetId: s.id, ordinal, material: false },
        after: { ...ctx.body, function: fn },
      });
      return setView(t, ctx.identity, s.id);
    },
  }),

  // ---- PATCH /me/tasks/:id/draft (If-Match) -------------------------------------------------------
  [API.taskSync.editDraftTask.id]: command(API.taskSync.editDraftTask, {
    load: (ctx, tx) => loadTask(tx, ctx.params.id),
    authorize: (ctx, f) => draftAccess(ctx.identity, f.set),
    handle: async (ctx, t, { set, task }): Promise<Task> => {
      const tk = task!;
      await requireEditableSet(t.tx, set);
      requireUnsent(tk, 'edit');
      assertIfMatch(ctx, tk.row_version);
      const next: ValidationTaskDraftInput = {
        title: (ctx.body.title ?? tk.title).trim(),
        ownerId: ctx.body.ownerId ?? tk.owner_user_id ?? '',
        dueOn: ctx.body.dueOn !== undefined ? ctx.body.dueOn : tk.due_on,
        deliverable: (ctx.body.deliverable ?? tk.deliverable).trim(),
        ...(ctx.body.function ? { function: ctx.body.function } : {}),
      };
      await validate(t.tx, set, next);
      const fields = changedFields(tk, next);
      if (fields.length > 0) {
        const updated = await t.tx
          .updateTable('platform.task')
          .set({
            title: next.title,
            owner_user_id: next.ownerId,
            due_on: next.dueOn,
            deliverable: next.deliverable,
            ...(next.function ? { function: next.function } : {}),
          })
          .where('id', '=', tk.id)
          .where('row_version', '=', tk.row_version)
          .where('removed_at', 'is', null)
          .returning('row_version')
          .executeTakeFirst();
        if (!updated) throw new ApiError('VERSION_CONFLICT', 'This task changed since you opened it.');
        // A previewed task changed: its preview no longer describes it. Back to "Not sent" so the
        // owner previews again; the send would refuse the old preview (content hash) anyway.
        if (tk.sync_status === 'in_preview' && set.connection)
          await t.tx
            .updateTable('platform.external_task_link')
            .set({ sync_status: 'not_sent', preview_id: null, updated_at: ctx.now })
            .where('task_id', '=', tk.id)
            .where('connection_id', '=', set.connection.id)
            .where('sync_status', '=', 'in_preview')
            .execute();
        await t.audit({
          action: 'task.updated',
          objectType: 'task',
          objectId: tk.id,
          objectVersion: updated.row_version,
          caseId: set.kase.id,
          summary: `Validation task ${tk.ordinal} draft edited: ${fields.join(', ')} (not material)`,
          details: { taskSetId: set.id, ordinal: tk.ordinal, fields: fields.join(','), material: false },
          before: {
            title: tk.title,
            ownerId: tk.owner_user_id,
            dueOn: tk.due_on,
            deliverable: tk.deliverable,
          },
          after: next,
        });
      } else {
        await t.audit({
          action: 'task.updated',
          objectType: 'task',
          objectId: tk.id,
          objectVersion: tk.row_version,
          caseId: set.kase.id,
          summary: `Validation task ${tk.ordinal} draft saved without changes`,
          details: { taskSetId: set.id, ordinal: tk.ordinal, fields: '', material: false },
        });
      }
      const view = await setView(t, ctx.identity, set.id);
      const out = view.tasks.find((x) => x.id === tk.id)!;
      ctx.setETag(out.rowVersion);
      return out;
    },
  }),

  // ---- POST /me/tasks/:id/removal (If-Match) ------------------------------------------------------
  [API.taskSync.removeDraftTask.id]: command(API.taskSync.removeDraftTask, {
    load: (ctx, tx) => loadTask(tx, ctx.params.id),
    authorize: (ctx, f) => draftAccess(ctx.identity, f.set),
    handle: async (ctx, t, { set, task }) => {
      const tk = task!;
      await requireEditableSet(t.tx, set);
      requireUnsent(tk, 'remove');
      assertIfMatch(ctx, tk.row_version);
      // The guard `task_removal_guard` refuses this too when the task was sent meanwhile.
      const removed = await t.tx
        .updateTable('platform.task')
        .set({ removed_at: ctx.now, removed_by: ctx.userId })
        .where('id', '=', tk.id)
        .where('row_version', '=', tk.row_version)
        .where('removed_at', 'is', null)
        .returning('row_version')
        .executeTakeFirst();
      if (!removed) throw new ApiError('VERSION_CONFLICT', 'This task changed since you opened it.');
      await t.audit({
        action: 'task.removed',
        objectType: 'task',
        objectId: tk.id,
        objectVersion: removed.row_version,
        caseId: set.kase.id,
        summary: `Validation task ${tk.ordinal} removed before sending (kept in history)`,
        details: { taskSetId: set.id, ordinal: tk.ordinal, material: false },
        before: { removedAt: null },
        after: { removedAt: ctx.now.toISOString() },
      });
      return setView(t, ctx.identity, set.id);
    },
  }),
};
