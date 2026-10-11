/**
 * Pilot plan and tasks (S11, ME-12). Activation needs the G2 approval effective, every blocking
 * condition met and every task owned (all unmet items are listed together). Activation commits the
 * plan version and locks its task set for WS6 (`owner_type 'pilot_plan_version'`, authorizing gate =
 * G2); WS4b never sends tasks. Task completion never passes a gate. Message drafts stay drafts.
 */
import { API, STOP_RULE_CONSEQUENCE_LABELS, type TaskStatus } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { caseMachine } from '@growth-os/domain';
import { caseVisible, roleAllows } from '../../../platform/authz';
import type { Authorization } from '../../../platform/context';
import { applyMateriality } from '../../../platform/materiality';
import { ApiError, notFound } from '../../../platform/errors';
import { assertIfMatch, command, query, type HandlerMap } from '../../../platform/pipeline';
import {
  asOfDate,
  caseById,
  caseByRef,
  peopleOf,
  refuse,
  tenantIdSql,
  type CaseLite,
} from '../gates/lib/common';
import { moveCase, SYSTEM_GATE } from '../gates/lib/moves';
import { contentOf, snapshotById } from '../gates/lib/serialize';
import { saveMilestones, saveTasks } from './draft';
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

function scoped(
  subject: Parameters<typeof roleAllows>[0],
  c: CaseLite,
  action: Parameters<typeof roleAllows>[1],
): Authorization {
  const v = caseVisible(subject, c);
  if (!v.allow) return v;
  return roleAllows(subject, action, { businessUnitId: c.businessUnitId, caseId: c.id });
}

const needPlan = (plan: PilotPlanRow | undefined): PilotPlanRow => {
  if (!plan) throw notFound();
  return plan;
};

/** A stop rule of the approved G2 snapshot of this case's pilot plan (D-127); otherwise 404. */
async function stopRuleCtx(tx: Tx, ref: string, stopRuleId: string) {
  const { c, plan: p } = await caseAndPlan(tx, ref);
  const plan = needPlan(p);
  const gate = plan.gate_request_id
    ? await tx
        .selectFrom('platform.gate_request')
        .select(['id', 'status', 'current_snapshot_id'])
        .where('id', '=', plan.gate_request_id)
        .executeTakeFirst()
    : undefined;
  const decided =
    gate && ['approved', 'approved_with_conditions', 'invalidated', 'expired'].includes(gate.status);
  const snap = decided && gate.current_snapshot_id ? await snapshotById(tx, gate.current_snapshot_id) : null;
  const rule = snap ? contentOf(snap).stopRules?.find((r) => r.id === stopRuleId) : undefined;
  if (!rule) throw notFound();
  return { c, plan, rule, gateRequestId: gate!.id };
}

async function taskCtx(tx: Tx, id: string) {
  const t = await tx.selectFrom('platform.task').selectAll().where('id', '=', id).executeTakeFirst();
  if (!t) throw notFound();
  const c = await caseById(tx, t.case_id);
  if (!c) throw notFound();
  return { t, c };
}

/** Task owners may update their own tasks; otherwise a role with task.update in scope. */
function taskAuth(
  subject: Parameters<typeof roleAllows>[0],
  userId: string,
  c: CaseLite,
  ownerId: string | null,
): Authorization {
  const v = caseVisible(subject, c);
  if (!v.allow) return v;
  if (ownerId === userId && subject.actor.kind === 'human') return { ...v, rule: 'task.owner' };
  return roleAllows(subject, 'task.update', { businessUnitId: c.businessUnitId, caseId: c.id });
}

export const pilotHandlers: HandlerMap = {
  [API.pilot.get.id]: query(API.pilot.get, {
    load: (ctx, tx) => caseAndPlan(tx, ctx.params.caseRef),
    authorize: (ctx, { c }) => caseVisible(ctx.identity.subject, c),
    handle: async (ctx, { tx }, { c, plan }) =>
      pilotView(tx, c, needPlan(plan), asOfDate(ctx.now, ctx.identity.tenant.timeZone), ctx.now),
  }),

  [API.pilot.saveDraft.id]: command(API.pilot.saveDraft, {
    load: (ctx, tx) => caseAndPlan(tx, ctx.params.caseRef),
    authorize: (ctx, { c }) => scoped(ctx.identity.subject, c, 'pilot.edit_plan'),
    handle: async (ctx, t, { c, plan: p }) => {
      const plan = needPlan(p);
      const draft = await versionById(t.tx, plan.draft_version_id);
      if (!draft)
        throw new ApiError(
          'INVALID_TRANSITION',
          'The plan is active. Changing budget, sites, dates or tasks needs a scope-change request.',
        );
      assertIfMatch(ctx, draft.row_version);
      if (!draft.task_set_id) throw new ApiError('INVALID_TRANSITION', 'The plan has no task set yet.');
      const setId = draft.task_set_id;
      const { tx } = t;
      if (ctx.body.milestones) await saveMilestones(tx, setId, ctx.body.milestones);
      if (ctx.body.tasks) await saveTasks(tx, c, setId, draft, ctx.body.tasks);
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
      return pilotView(
        tx,
        c,
        (await pilotPlanOf(tx, c.id))!,
        asOfDate(ctx.now, ctx.identity.tenant.timeZone),
        ctx.now,
      );
    },
  }),

  [API.pilot.activate.id]: command(API.pilot.activate, {
    load: (ctx, tx) => caseAndPlan(tx, ctx.params.caseRef),
    authorize: (ctx, { c }) => scoped(ctx.identity.subject, c, 'pilot.activate'),
    handle: async (ctx, t, { c, plan: p }) => {
      const plan = needPlan(p);
      const { tx } = t;
      const draft = await versionById(tx, plan.draft_version_id);
      const facts = await activationFacts(tx, plan, draft, ctx.now);
      const r = caseMachine.apply(c.stage as never, 'pilot_activated', SYSTEM_GATE, {
        approval: facts.approval,
        blockingConditionsMet: facts.blockingConditionsMet,
        allTasksOwned: facts.allTasksOwned,
      });
      if (!r.ok) {
        if (r.code === 'INVALID_TRANSITION') refuse(r, 'Activation needs the case at Pilot approved.');
        throw new ApiError(
          r.code === 'PRECONDITIONS_UNMET' ? 'PRECONDITIONS_UNMET' : r.code,
          'Activation blocked',
          {
            blockers: facts.blockers,
          },
        );
      }
      if (!draft)
        throw new ApiError('PRECONDITIONS_UNMET', 'Activation blocked', { blockers: facts.blockers });
      const g2 = (await tx
        .selectFrom('platform.gate_request')
        .select(['id', 'current_snapshot_id'])
        .where('id', '=', plan.gate_request_id!)
        .executeTakeFirst())!;
      // The task set for WS6: one per committed plan version, authorized by G2.
      let setId = draft.task_set_id;
      const mapping = await tx
        .selectFrom('platform.connector_mapping')
        .select(['id', 'connection_id'])
        .where('purpose', '=', 'pilot_tasks')
        .executeTakeFirst();
      if (!setId) {
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
        await tx
          .updateTable('platform.task_set')
          .set((eb) => ({
            authorizing_gate_request_id: g2.id,
            owner_type: 'pilot_plan_version',
            owner_id: draft.id,
            connection_id: eb.fn.coalesce('connection_id', eb.val(mapping?.connection_id ?? null)),
            mapping_id: eb.fn.coalesce('mapping_id', eb.val(mapping?.id ?? null)),
          }))
          .where('id', '=', setId)
          .execute();
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
      return pilotView(
        tx,
        (await caseById(tx, c.id))!,
        (await pilotPlanOf(tx, c.id))!,
        asOfDate(ctx.now, ctx.identity.tenant.timeZone),
        ctx.now,
      );
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
          .values({
            tenant_id: tenantIdSql,
            case_id: c.id,
            target_type: 'task',
            target_id: task.id,
            author_id: ctx.userId,
            body: ctx.body.note,
            created_at: ctx.now,
          })
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
      return (
        await toTasks(
          t.tx,
          rows.filter((r) => r.id === task.id),
        )
      )[0]!;
    },
  }),

  [API.pilot.reportBlocker.id]: command(API.pilot.reportBlocker, {
    load: (ctx, tx) => taskCtx(tx, ctx.params.id),
    authorize: (ctx, { t: task, c }) => taskAuth(ctx.identity.subject, ctx.userId, c, task.owner_user_id),
    handle: async (ctx, t, { t: task, c }) => {
      if (ctx.identity.kind !== 'human')
        throw new ApiError('AGENT_IDENTITY_FORBIDDEN', 'Only people report blockers.');
      await t.tx
        .updateTable('platform.task')
        .set({ status: 'blocked', completed_at: null })
        .where('id', '=', task.id)
        .execute();
      // The blocker text is stored as a comment on the task (audit carries no free text).
      await t.tx
        .insertInto('platform.comment')
        .values({
          tenant_id: tenantIdSql,
          case_id: c.id,
          target_type: 'task',
          target_id: task.id,
          author_id: ctx.userId,
          body: ctx.body.text,
          created_at: ctx.now,
        })
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
      return (
        await toTasks(
          t.tx,
          rows.filter((r) => r.id === task.id),
        )
      )[0]!;
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
        throw new ApiError(
          'INVALID_TRANSITION',
          'A scope change applies to an active plan. Edit the draft instead.',
        );
      const ch = ctx.body.requestedChanges;
      const ceiling = ch.budgetCeiling ?? ch.budget ?? current.budget_ceiling;
      if (!/^\d{1,16}(\.\d{1,2})?$/.test(ceiling))
        throw new ApiError('VALIDATION_FAILED', 'budgetCeiling must be a decimal amount.', {
          errors: [
            {
              path: 'body.requestedChanges.budgetCeiling',
              code: 'custom',
              message: 'Decimal amount such as "150000.00"',
            },
          ],
        });
      const versions = await tx
        .selectFrom('me.pilot_plan_version')
        .select('version')
        .where('pilot_plan_id', '=', plan.id)
        .execute();
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
      await tx
        .updateTable('me.pilot_plan_version')
        .set({ state: 'committed', committed_at: ctx.now })
        .where('id', '=', nv.id)
        .execute();
      await tx
        .updateTable('me.pilot_plan')
        .set({ current_version_id: nv.id })
        .where('id', '=', plan.id)
        .execute();
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

  [API.pilot.tripStopRule.id]: command(API.pilot.tripStopRule, {
    load: (ctx, tx) => stopRuleCtx(tx, ctx.params.caseRef, ctx.params.stopRuleId),
    // The rule's owner reports a trip; so may the case owner or the pilot owner (pilot.edit_plan).
    authorize: (ctx, { c, rule }) => {
      const subject = ctx.identity.subject;
      const v = caseVisible(subject, c);
      if (!v.allow) return v;
      if (subject.actor.kind === 'human' && ctx.userId === rule.ownerId)
        return { allow: true, rule: 'stop_rule.owner', authorityGrantId: null };
      return roleAllows(subject, 'pilot.edit_plan', { businessUnitId: c.businessUnitId, caseId: c.id });
    },
    handle: async (ctx, t, { c, rule, gateRequestId }) => {
      const { tx } = t;
      const open = await tx
        .selectFrom('platform.review_request')
        .select('id')
        .where('case_id', '=', c.id)
        .where('target_type', '=', 'stop_rule')
        .where('target_id', '=', rule.id)
        .where('status', '=', 'open')
        .executeTakeFirst();
      if (open)
        throw new ApiError(
          'INVALID_TRANSITION',
          `${rule.key} is already tripped · the sponsor review is open.`,
        );
      // The only write: a review item for the sponsor. No task, gate, plan or case state changes
      // (never-rule 7); the sponsor decides what happens next.
      const rr = await tx
        .insertInto('platform.review_request')
        .values({
          tenant_id: tenantIdSql,
          case_id: c.id,
          area: 'sponsor',
          target_type: 'stop_rule',
          target_id: rule.id,
          question: `${rule.key} tripped: ${rule.trigger.text}. Review the pilot and decide what happens next.`,
          what_to_check: [
            `Pre-registered consequence: ${STOP_RULE_CONSEQUENCE_LABELS[rule.consequence]}`,
            `Evidence: ${ctx.body.evidence.trim()}`,
          ],
          requested_by: ctx.userId,
          reviewer_user_id: c.sponsorUserId,
          due_on: null,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'stop_rule.tripped',
        objectType: 'stop_rule',
        objectId: rule.id,
        caseId: c.id,
        summary: `${rule.key} tripped · sponsor review requested (no task, gate or case change)`,
        details: { key: rule.key, reviewRequestId: rr.id, gateRequestId, consequence: rule.consequence },
      });
      return pilotView(
        tx,
        c,
        (await pilotPlanOf(tx, c.id))!,
        asOfDate(ctx.now, ctx.identity.tenant.timeZone),
        ctx.now,
      );
    },
  }),

  [API.pilot.messageDrafts.id]: query(API.pilot.messageDrafts, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => caseVisible(ctx.identity.subject, c),
    handle: async (_ctx, { tx }, c) => ({ items: await messageDrafts(tx, c.id) }),
  }),

  [API.pilot.updateMessageDraft.id]: command(API.pilot.updateMessageDraft, {
    load: async (ctx, tx) => {
      const d = await tx
        .selectFrom('me.message_draft')
        .selectAll()
        .where('id', '=', ctx.params.id)
        .executeTakeFirst();
      if (!d) throw notFound();
      const c = await caseById(tx, d.case_id);
      if (!c) throw notFound();
      return { d, c };
    },
    authorize: (ctx, { c }) => scoped(ctx.identity.subject, c, 'pilot.edit_plan'),
    handle: async (ctx, t, { d, c }) => {
      assertIfMatch(ctx, d.row_version);
      const changed =
        (ctx.body.title !== undefined && ctx.body.title !== d.title) ||
        (ctx.body.body !== undefined && ctx.body.body !== d.body);
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
