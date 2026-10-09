/**
 * Pilot plan and tasks (S11, ME-12). Activation needs the G2 approval effective, every blocking
 * condition met and every task owned (all unmet items are listed together). Activation commits the
 * plan version and locks its task set for WS6 (`owner_type 'pilot_plan_version'`, authorizing gate =
 * G2); WS4b never sends tasks. Task completion never passes a gate. Message drafts stay drafts.
 */
import { API, type TaskStatus } from '@growth-os/contracts';
import { sql, type Tx } from '@growth-os/db';
import { caseMachine } from '@growth-os/domain';
import { caseVisible, roleAllows } from '../../../platform/authz';
import type { Authorization } from '../../../platform/context';
import { applyMateriality } from '../../../platform/materiality';
import { ApiError, notFound } from '../../../platform/errors';
import { assertIfMatch, command, query, type HandlerMap } from '../../../platform/pipeline';
import { asOfDate, caseById, caseByRef, peopleOf, refuse, tenantIdSql, type CaseLite } from '../gates/lib/common';
import { moveCase, SYSTEM_GATE } from '../gates/lib/moves';
import { contentOf, snapshotById } from '../gates/lib/serialize';
import {
  activationFacts,
  messageDrafts,
  pilotPlanOf,
  pilotView,
  taskRows,
  toMessageDraft,
  toTasks,
  versionById,
  type PilotPlanRow,
} from './view';

async function caseOr404(tx: Tx, ref: string): Promise<CaseLite> {
  const c = await caseByRef(tx, ref);
  if (!c) throw notFound();
  return c;
}

async function caseAndPlan(tx: Tx, ref: string): Promise<{ c: CaseLite; plan: PilotPlanRow }> {
  const c = await caseOr404(tx, ref);
  const plan = await pilotPlanOf(tx, c.id);
  return { c, plan: plan! };
}

function scoped(subject: Parameters<typeof roleAllows>[0], c: CaseLite, action: Parameters<typeof roleAllows>[1]): Authorization {
  const v = caseVisible(subject, c);
  if (!v.allow) return v;
  return roleAllows(subject, action, { businessUnitId: c.businessUnitId, caseId: c.id });
}

const needPlan = (plan: PilotPlanRow | undefined): PilotPlanRow => {
  if (!plan) throw notFound();
  return plan;
};

/** Reject dependency cycles (DFS over the proposed edges). */
function assertAcyclic(edges: Map<string, string[]>): void {
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

async function taskCtx(tx: Tx, id: string) {
  const t = await tx.selectFrom('platform.task').selectAll().where('id', '=', id).executeTakeFirst();
  if (!t) throw notFound();
  const c = await caseById(tx, t.case_id);
  if (!c) throw notFound();
  return { t, c };
}

/** Task owners may update their own tasks; otherwise a role with task.update in scope. */
function taskAuth(subject: Parameters<typeof roleAllows>[0], userId: string, c: CaseLite, ownerId: string | null): Authorization {
  const v = caseVisible(subject, c);
  if (!v.allow) return v;
  if (ownerId === userId && subject.actor.kind === 'human') return { ...v, rule: 'task.owner' };
  return roleAllows(subject, 'task.update', { businessUnitId: c.businessUnitId, caseId: c.id });
}

export const pilotHandlers: HandlerMap = {
  [API.pilot.get.id]: query(API.pilot.get, {
    load: (ctx, tx) => caseAndPlan(tx, ctx.params.caseRef),
    authorize: (ctx, { c }) => caseVisible(ctx.identity.subject, c),
    handle: async (ctx, { tx }, { c, plan }) => pilotView(tx, c, needPlan(plan), asOfDate(ctx.now)),
  }),

  [API.pilot.saveDraft.id]: command(API.pilot.saveDraft, {
    load: (ctx, tx) => caseAndPlan(tx, ctx.params.caseRef),
    authorize: (ctx, { c }) => scoped(ctx.identity.subject, c, 'pilot.edit_plan'),
    handle: async (ctx, t, { c, plan: p }) => {
      const plan = needPlan(p);
      const draft = await versionById(t.tx, plan.draft_version_id);
      if (!draft)
        throw new ApiError('INVALID_TRANSITION', 'The plan is active. Changing budget, sites, dates or tasks needs a scope-change request.');
      assertIfMatch(ctx, draft.row_version);
      if (!draft.task_set_id) throw new ApiError('INVALID_TRANSITION', 'The plan has no task set yet.');
      const setId = draft.task_set_id;
      const { tx } = t;
      if (ctx.body.milestones) {
        const existing = await tx.selectFrom('platform.milestone').select('id').where('task_set_id', '=', setId).execute();
        await tx.updateTable('platform.milestone').set({ ordinal: sql`ordinal + 1000` }).where('task_set_id', '=', setId).execute();
        const keep = new Set<string>();
        for (const m of ctx.body.milestones) {
          if (m.id && existing.some((e) => e.id === m.id)) {
            keep.add(m.id);
            await tx.updateTable('platform.milestone').set({ name: m.name, window_text: m.windowText, ordinal: m.ordinal }).where('id', '=', m.id).execute();
          } else {
            const r = await tx
              .insertInto('platform.milestone')
              .values({ tenant_id: tenantIdSql, task_set_id: setId, name: m.name, window_text: m.windowText, ordinal: m.ordinal })
              .returning('id')
              .executeTakeFirstOrThrow();
            keep.add(r.id);
          }
        }
        const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
        if (drop.length) {
          await tx.updateTable('platform.task').set({ milestone_id: null }).where('milestone_id', 'in', drop).execute();
          await tx.deleteFrom('platform.milestone').where('id', 'in', drop).execute();
        }
      }
      if (ctx.body.tasks) {
        const existing = await taskRows(tx, setId);
        const ids = ctx.body.tasks.map((x) => x.id).filter((x): x is string => !!x);
        if (ids.some((id) => !existing.some((e) => e.id === id))) throw notFound();
        // Temporary ordinals avoid unique collisions while re-ordering.
        await tx.updateTable('platform.task').set({ ordinal: sql`ordinal + 1000` }).where('task_set_id', '=', setId).execute();
        const idOf: string[] = [];
        for (const [i, x] of ctx.body.tasks.entries()) {
          const values = {
            ordinal: i + 1,
            title: x.title,
            milestone_id: x.milestoneId,
            function: x.function,
            owner_user_id: x.ownerId,
            due_on: x.dueOn,
            due_rule: x.dueRule,
            deliverable: x.deliverable,
            condition_key: x.conditionKey,
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
          const linked = await tx.selectFrom('platform.external_task_link').select('task_id').where('task_id', 'in', removed).executeTakeFirst();
          if (linked) throw new ApiError('INVALID_TRANSITION', 'A task already sent to the task tool cannot be removed.');
          await tx.deleteFrom('platform.task_dependency').where((eb) => eb.or([eb('task_id', 'in', removed), eb('depends_on_task_id', 'in', removed)])).execute();
          await tx.deleteFrom('platform.task').where('id', 'in', removed).execute();
        }
        const edges = new Map<string, string[]>();
        ctx.body.tasks.forEach((x, i) => edges.set(idOf[i]!, x.dependsOnTaskIds));
        for (const deps of edges.values()) if (deps.some((d) => !idOf.includes(d))) throw notFound();
        assertAcyclic(edges);
        await tx.deleteFrom('platform.task_dependency').where('task_id', 'in', idOf).execute();
        for (const [taskId, deps] of edges)
          for (const d of deps)
            await tx.insertInto('platform.task_dependency').values({ tenant_id: tenantIdSql, task_id: taskId, depends_on_task_id: d }).execute();
      }
      const upd = await tx
        .updateTable('me.pilot_plan_version')
        .set({ updated_at: ctx.now })
        .where('id', '=', draft.id)
        .returning('row_version')
        .executeTakeFirstOrThrow();
      ctx.setETag(upd.row_version);
      await t.audit({
        action: 'pilot_plan.draft_saved',
        objectType: 'pilot_plan_version',
        objectId: draft.id,
        objectVersion: draft.version,
        caseId: c.id,
        summary: `Pilot plan draft v${draft.version} edited`,
        details: { tasks: ctx.body.tasks?.length ?? null, milestones: ctx.body.milestones?.length ?? null },
      });
      return pilotView(tx, c, (await pilotPlanOf(tx, c.id))!, asOfDate(ctx.now));
    },
  }),

  [API.pilot.activate.id]: command(API.pilot.activate, {
    load: (ctx, tx) => caseAndPlan(tx, ctx.params.caseRef),
    authorize: (ctx, { c }) => scoped(ctx.identity.subject, c, 'pilot.activate'),
    handle: async (ctx, t, { c, plan: p }) => {
      const plan = needPlan(p);
      const { tx } = t;
      const draft = await versionById(tx, plan.draft_version_id);
      const facts = await activationFacts(tx, plan, draft);
      const r = caseMachine.apply(c.stage as never, 'pilot_activated', SYSTEM_GATE, {
        approval: facts.approval,
        blockingConditionsMet: facts.blockingConditionsMet,
        allTasksOwned: facts.allTasksOwned,
      });
      if (!r.ok) {
        if (r.code === 'INVALID_TRANSITION') refuse(r, 'Activation needs the case at Pilot approved.');
        throw new ApiError(r.code === 'PRECONDITIONS_UNMET' ? 'PRECONDITIONS_UNMET' : r.code, 'Activation blocked', {
          blockers: facts.blockers,
        });
      }
      if (!draft) throw new ApiError('PRECONDITIONS_UNMET', 'Activation blocked', { blockers: facts.blockers });
      const g2 = (await tx
        .selectFrom('platform.gate_request')
        .select(['id', 'current_snapshot_id'])
        .where('id', '=', plan.gate_request_id!)
        .executeTakeFirst())!;
      // The task set for WS6: one per committed plan version, authorized by G2.
      let setId = draft.task_set_id;
      if (!setId) {
        const mapping = await tx
          .selectFrom('platform.connector_mapping')
          .select(['id', 'connection_id'])
          .where('purpose', '=', 'pilot_tasks')
          .executeTakeFirst();
        const s = await tx
          .insertInto('platform.task_set')
          .values({
            tenant_id: tenantIdSql,
            case_id: c.id,
            owner_type: 'pilot_plan_version',
            owner_id: draft.id,
            authorizing_gate_request_id: g2.id,
            connection_id: mapping?.connection_id ?? null,
            mapping_id: mapping?.id ?? null,
            created_at: ctx.now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        setId = s.id;
      } else {
        await tx.updateTable('platform.task_set').set({ authorizing_gate_request_id: g2.id }).where('id', '=', setId).execute();
      }
      await tx
        .updateTable('me.pilot_plan_version')
        .set({
          task_set_id: setId,
          state: 'committed',
          committed_at: ctx.now,
          baseline_snapshot_id: g2.current_snapshot_id,
        })
        .where('id', '=', draft.id)
        .execute();
      // The approved G2 snapshot authorizes exactly this plan version: index it so a later scope
      // change of the plan is evaluated against that approval (materiality, never-rule 10).
      if (g2.current_snapshot_id)
        await tx
          .insertInto('platform.snapshot_component')
          .values({
            tenant_id: tenantIdSql,
            snapshot_id: g2.current_snapshot_id,
            component_type: 'pilot_plan_version',
            component_id: draft.id,
            component_version: draft.version,
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
      await tx
        .updateTable('me.pilot_plan')
        .set({
          status: 'active',
          current_version_id: draft.id,
          draft_version_id: null,
          activated_at: ctx.now,
          activated_by: ctx.userId,
        })
        .where('id', '=', plan.id)
        .execute();
      // Outcome review v1 opens with the approved package's limitations as the causal-limitation draft.
      const snap = g2.current_snapshot_id ? await snapshotById(tx, g2.current_snapshot_id) : null;
      await tx
        .insertInto('me.outcome_review')
        .values({
          tenant_id: tenantIdSql,
          case_id: c.id,
          gate_request_id: g2.id,
          version: 1,
          status: 'incomplete',
          causal_limitations: snap ? contentOf(snap).knownLimitations : [],
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const tasks = await taskRows(tx, setId);
      await t.audit({
        action: 'pilot.activated',
        objectType: 'pilot_plan_version',
        objectId: draft.id,
        objectVersion: draft.version,
        caseId: c.id,
        summary: `Pilot plan v${draft.version} activated (${tasks.length} tasks)`,
        details: { taskSetId: setId, gateRequestId: g2.id, tasks: tasks.length },
      });
      await moveCase(t, c.id, 'pilot_activated', {
        facts: { approval: facts.approval, blockingConditionsMet: true, allTasksOwned: true },
        strict: true,
        props: { pilot_activated: { tasks: tasks.length } },
      });
      return pilotView(tx, (await caseById(tx, c.id))!, (await pilotPlanOf(tx, c.id))!, asOfDate(ctx.now));
    },
  }),

  [API.pilot.updateTask.id]: command(API.pilot.updateTask, {
    load: (ctx, tx) => taskCtx(tx, ctx.params.id),
    authorize: (ctx, { t: task, c }) => taskAuth(ctx.identity.subject, ctx.userId, c, task.owner_user_id),
    handle: async (ctx, t, { t: task, c }) => {
      assertIfMatch(ctx, task.row_version);
      const status: TaskStatus = ctx.body.status ?? (task.status as TaskStatus);
      const upd = await t.tx
        .updateTable('platform.task')
        .set({ status, completed_at: status === 'done' ? (task.completed_at ?? ctx.now) : null })
        .where('id', '=', task.id)
        .returning('row_version')
        .executeTakeFirstOrThrow();
      if (ctx.body.note)
        await t.tx
          .insertInto('platform.comment')
          .values({ tenant_id: tenantIdSql, case_id: c.id, target_type: 'task', target_id: task.id, author_id: ctx.userId, body: ctx.body.note, created_at: ctx.now })
          .execute();
      ctx.setETag(upd.row_version);
      await t.audit({
        action: 'task.updated',
        objectType: 'task',
        objectId: task.id,
        objectVersion: upd.row_version,
        caseId: c.id,
        summary: `Task ${task.ordinal} status ${status.replace(/_/g, ' ')}`,
        details: { from: task.status, to: status, note: !!ctx.body.note },
      });
      const rows = await taskRows(t.tx, task.task_set_id);
      return (await toTasks(t.tx, rows.filter((r) => r.id === task.id)))[0]!;
    },
  }),

  [API.pilot.reportBlocker.id]: command(API.pilot.reportBlocker, {
    load: (ctx, tx) => taskCtx(tx, ctx.params.id),
    authorize: (ctx, { t: task, c }) => taskAuth(ctx.identity.subject, ctx.userId, c, task.owner_user_id),
    handle: async (ctx, t, { t: task, c }) => {
      if (ctx.identity.kind !== 'human') throw new ApiError('AGENT_IDENTITY_FORBIDDEN', 'Only people report blockers.');
      await t.tx.updateTable('platform.task').set({ status: 'blocked', completed_at: null }).where('id', '=', task.id).execute();
      // The blocker text is stored as a comment on the task (audit carries no free text).
      await t.tx
        .insertInto('platform.comment')
        .values({ tenant_id: tenantIdSql, case_id: c.id, target_type: 'task', target_id: task.id, author_id: ctx.userId, body: ctx.body.text, created_at: ctx.now })
        .execute();
      await t.audit({
        action: 'task.blocker_reported',
        objectType: 'task',
        objectId: task.id,
        caseId: c.id,
        summary: `Task ${task.ordinal} blocked; case owner notified`,
        details: { notify: c.ownerUserId },
      });
      const rows = await taskRows(t.tx, task.task_set_id);
      return (await toTasks(t.tx, rows.filter((r) => r.id === task.id)))[0]!;
    },
  }),

  [API.pilot.requestScopeChange.id]: command(API.pilot.requestScopeChange, {
    load: (ctx, tx) => caseAndPlan(tx, ctx.params.caseRef),
    authorize: (ctx, { c }) => scoped(ctx.identity.subject, c, 'pilot.edit_plan'),
    handle: async (ctx, t, { c, plan: p }) => {
      const plan = needPlan(p);
      const { tx } = t;
      const current = await versionById(tx, plan.current_version_id);
      if (!current || plan.status !== 'active')
        throw new ApiError('INVALID_TRANSITION', 'A scope change applies to an active plan. Edit the draft instead.');
      const ch = ctx.body.requestedChanges;
      const ceiling = ch.budgetCeiling ?? ch.budget ?? current.budget_ceiling;
      if (!/^\d{1,16}(\.\d{1,2})?$/.test(ceiling))
        throw new ApiError('VALIDATION_FAILED', 'budgetCeiling must be a decimal amount.', {
          errors: [{ path: 'body.requestedChanges.budgetCeiling', code: 'custom', message: 'Decimal amount such as "150000.00"' }],
        });
      const versions = await tx.selectFrom('me.pilot_plan_version').select('version').where('pilot_plan_id', '=', plan.id).execute();
      const next = Math.max(...versions.map((v) => v.version)) + 1;
      const nv = await tx
        .insertInto('me.pilot_plan_version')
        .values({
          tenant_id: tenantIdSql,
          pilot_plan_id: plan.id,
          version: next,
          state: 'draft',
          baseline_snapshot_id: current.baseline_snapshot_id,
          budget_ceiling: ceiling,
          currency: current.currency,
          window_start: ch.windowStart ?? current.window_start,
          window_end: ch.windowEnd ?? current.window_end,
          scope_text: ch.scopeText ?? ctx.body.description,
          thresholds_text: current.thresholds_text,
          task_set_id: null,
          created_by: ctx.userId,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.updateTable('me.pilot_plan_version').set({ state: 'committed', committed_at: ctx.now }).where('id', '=', nv.id).execute();
      await tx.updateTable('me.pilot_plan').set({ current_version_id: nv.id }).where('id', '=', plan.id).execute();
      const scr = await tx
        .insertInto('me.scope_change_request')
        .values({
          tenant_id: tenantIdSql,
          case_id: c.id,
          requested_by: ctx.userId,
          description: ctx.body.description,
          requested_changes: JSON.stringify(ch),
          status: 'open',
          created_at: ctx.now,
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'pilot.scope_change_requested',
        objectType: 'scope_change_request',
        objectId: scr.id,
        objectVersion: next,
        caseId: c.id,
        summary: `Scope change requested: pilot plan v${next} committed; a new authorization is needed`,
        details: { planVersionId: nv.id, keys: Object.keys(ch).join(',').slice(0, 120) },
      });
      const spend = ceiling !== current.budget_ceiling;
      await applyMateriality(
        t,
        {
          changeType: spend ? 'spend_ceiling_changed' : 'plan_tasks_changed',
          objectType: 'pilot_plan_version',
          objectId: current.id,
          componentType: 'pilot_plan_version',
          fromVersion: current.version,
          toVersion: next,
        },
        { now: ctx.now, actorUserId: ctx.userId },
      );
      const people = await peopleOf(tx, [ctx.userId]);
      return {
        id: scr.id,
        caseId: c.id,
        requestedBy: people(ctx.userId),
        description: ctx.body.description,
        requestedChanges: ch,
        status: 'open' as const,
        gateRequestId: null,
        createdAt: new Date(scr.created_at).toISOString(),
      };
    },
  }),

  [API.pilot.messageDrafts.id]: query(API.pilot.messageDrafts, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => caseVisible(ctx.identity.subject, c),
    handle: async (_ctx, { tx }, c) => ({ items: await messageDrafts(tx, c.id) }),
  }),

  [API.pilot.updateMessageDraft.id]: command(API.pilot.updateMessageDraft, {
    load: async (ctx, tx) => {
      const d = await tx.selectFrom('me.message_draft').selectAll().where('id', '=', ctx.params.id).executeTakeFirst();
      if (!d) throw notFound();
      const c = await caseById(tx, d.case_id);
      if (!c) throw notFound();
      return { d, c };
    },
    authorize: (ctx, { c }) => scoped(ctx.identity.subject, c, 'pilot.edit_plan'),
    handle: async (ctx, t, { d, c }) => {
      assertIfMatch(ctx, d.row_version);
      const changed = (ctx.body.title !== undefined && ctx.body.title !== d.title) || (ctx.body.body !== undefined && ctx.body.body !== d.body);
      const row = await t.tx
        .updateTable('me.message_draft')
        .set({
          title: ctx.body.title ?? d.title,
          body: ctx.body.body ?? d.body,
          origin: changed && d.origin === 'ai' ? 'ai_edited' : d.origin,
        })
        .where('id', '=', d.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      ctx.setETag(row.row_version);
      await t.audit({
        action: 'message_draft.edited',
        objectType: 'message_draft',
        objectId: d.id,
        objectVersion: row.row_version,
        caseId: c.id,
        summary: 'Outbound message draft edited (stays a draft; never sent)',
        details: { origin: row.origin },
      });
      return toMessageDraft(row);
    },
  }),
};
