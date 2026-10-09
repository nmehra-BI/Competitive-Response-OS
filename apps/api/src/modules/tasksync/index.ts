/**
 * Task sync (WS6, WF-07, ARCHITECTURE.md §13): per-task external status, the mandatory dry-run
 * preview, send through the transactional outbox, retry of failed tasks only (same keys), and the
 * CSV export fallback. The worker (`apps/worker/src/jobs/outbox`) performs every external write and
 * re-checks authorization at send time; this module never calls `createTask`.
 */
import { randomUUID } from 'node:crypto';
import { ConnectorError, createConnectorFactory, type ExternalTaskInput } from '@growth-os/connectors';
import { API, type Blocker, type ConnectorStatus, type TaskSyncPreview } from '@growth-os/contracts';
import { sql, type Tx } from '@growth-os/db';
import { syncMachine, type ApplyResult, type WorkflowFacts } from '@growth-os/domain';
import { caseVisible, roleAllows } from '../../platform/authz';
import type { Authorization, Identity } from '../../platform/context';
import { ApiError } from '../../platform/errors';
import { sha256Hex, stableStringify } from '../../platform/hash';
import { command, query, type HandlerMap } from '../../platform/pipeline';
import { isoDateTime } from '../../platform/serialize';
import {
  destinationOf,
  externalInput,
  loadGateContext,
  loadTaskSet,
  planIsCurrent,
  planVersionIdOf,
  toTaskSetView,
  type LoadedSet,
  type TaskRow,
} from './store';
import { tasksCsv } from './text';
import { devHandlers } from './dev';

/** A preview is valid for 30 minutes; after that, preview again before sending. */
export const PREVIEW_TTL_MS = 30 * 60_000;
const OUTBOX_DISPATCH = 'outbox.dispatch';
const UNSENT = new Set(['not_sent', 'in_preview']);

function access(
  identity: Identity,
  s: LoadedSet,
  action: 'task_sync.preview' | 'task_sync.send',
): Authorization {
  const visible = caseVisible(identity.subject, s.kase);
  if (!visible.allow) return visible;
  return roleAllows(identity.subject, action, { businessUnitId: s.kase.businessUnitId, caseId: s.kase.id });
}

function refuse(r: Extract<ApplyResult<string, string>, { ok: false }>): never {
  const blockers: Blocker[] = r.failed.map((f) => ({ key: f.key, message: f.message ?? f.key }));
  throw new ApiError(r.code, r.reasons[0] ?? 'This action is not possible now.', { blockers });
}

function requireDestination(s: LoadedSet): void {
  if (!s.connection || !s.mapping)
    throw new ApiError('PRECONDITIONS_UNMET', 'Choose a destination for these tasks first.', {
      blockers: [{ key: 'destination', message: 'No task tool destination is mapped for this task set.' }],
    });
}

/** Canonical preview content: what the send is bound to by hash. */
function previewContent(
  s: LoadedSet,
  planVersionId: string,
  items: { task: TaskRow; input: ExternalTaskInput }[],
): Record<string, unknown> {
  return {
    taskSetId: s.id,
    planVersionId,
    connectionId: s.connection!.id,
    project: s.mapping!.project,
    issueType: s.mapping!.issueType,
    items: items.map(({ task, input }) => ({
      taskId: task.id,
      idempotencyKey: input.idempotencyKey,
      title: task.title,
      ownerId: task.owner?.id ?? null,
      assignee: input.assignee,
      dueOn: task.dueOn,
      deliverable: task.deliverable,
      milestoneId: task.milestoneId,
    })),
  };
}

const contentHash = (content: unknown): string => sha256Hex(stableStringify(content));

async function lockLinks(tx: Tx, setId: string): Promise<void> {
  // Serialises concurrent send / retry clicks on one task set: the second waits, then sees the
  // first one's writes and finds nothing left to do.
  await sql`SELECT id FROM platform.task_set WHERE id = ${setId} FOR UPDATE`.execute(tx);
}

async function enqueueDispatch(
  t: { enqueue: (n: string, p?: Record<string, unknown>, o?: { jobKey?: string }) => Promise<string> },
  messageId: string,
): Promise<void> {
  await t.enqueue(OUTBOX_DISPATCH, { outboxMessageId: messageId }, { jobKey: `outbox:${messageId}` });
}

export const taskSyncHandlers: HandlerMap = {
  // ---- GET /me/task-sets/:id ---------------------------------------------------------------------
  [API.taskSync.get.id]: query(API.taskSync.get, {
    load: (ctx, tx) => loadTaskSet(tx, ctx.params.id),
    authorize: (ctx, s) => caseVisible(ctx.identity.subject, s.kase),
    handle: async (_ctx, _t, s) => toTaskSetView(s),
  }),

  // ---- POST /me/task-sets/:id/previews (dry run) -------------------------------------------------
  [API.taskSync.preview.id]: command(API.taskSync.preview, {
    load: (ctx, tx) => loadTaskSet(tx, ctx.params.id),
    authorize: (ctx, s) => access(ctx.identity, s, 'task_sync.preview'),
    handle: async (ctx, t, s) => {
      requireDestination(s);
      const gate = await loadGateContext(t.tx, s.gateRequestId, ctx.now);
      const allowed = syncMachine.apply('not_sent', 'preview', ctx.identity.actor, {
        approval: gate.approval,
      });
      if (!allowed.ok) refuse(allowed);

      const planVersionId = await planVersionIdOf(t.tx, s);
      const unsent = s.tasks.filter((task) => UNSENT.has(s.links.get(task.id)?.status ?? 'not_sent'));
      const items = unsent.map((task) => ({
        task,
        input: externalInput(s, task, { tenantId: ctx.tenantId, planVersionId, gateLabel: gate.gateLabel }),
      }));

      // Dry run through the connector (no writes in the tool). Runs on the pool, not the business
      // transaction: the tool is a remote system.
      const connector = createConnectorFactory({ sim: ctx.deps.db })({
        id: s.connection!.id,
        provider: s.connection!.provider,
      });
      let connectionStatus: ConnectorStatus = s.connection!.status;
      const problems: Blocker[] = [];
      let toolResults: { fields: Record<string, string>; problems: string[] }[] = [];
      if (connectionStatus === 'connected' && items.length > 0) {
        try {
          toolResults = await connector.preview(items.map((i) => i.input));
        } catch (e) {
          if (!(e instanceof ConnectorError)) throw e;
          connectionStatus = e.kind === 'token_expired' ? 'expired' : 'unavailable';
        }
      }
      if (connectionStatus !== 'connected')
        problems.push({
          key: 'connection',
          message:
            connectionStatus === 'expired'
              ? 'The task tool connection expired. Reconnect it or export CSV instead.'
              : 'The task tool connection is not usable. Export CSV instead.',
        });
      items.forEach(({ task, input }, i) => {
        if (!task.owner)
          problems.push({ key: `task-${task.ordinal}-owner`, message: `Task ${task.ordinal} has no owner` });
        else if (!input.assignee)
          problems.push({
            key: `task-${task.ordinal}-assignee`,
            message: `Task ${task.ordinal}: assignee ${task.owner.display_name} is not mapped to a ${destinationOf(s)!.tool} account`,
          });
        for (const p of toolResults[i]?.problems ?? [])
          if (input.assignee)
            problems.push({ key: `task-${task.ordinal}-tool`, message: `Task ${task.ordinal}: ${p}` });
      });

      const content = previewContent(s, planVersionId, items);
      const hash = contentHash(content);
      const expiresAt = new Date(ctx.now.getTime() + PREVIEW_TTL_MS);
      const preview = await t.tx
        .insertInto('platform.task_sync_preview')
        .values({
          tenant_id: ctx.tenantId,
          task_set_id: s.id,
          plan_version_id: planVersionId,
          content: JSON.stringify(content),
          content_hash: hash,
          created_by: ctx.userId,
          created_at: ctx.now,
          expires_at: expiresAt,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      for (const { task, input } of items) {
        const link = s.links.get(task.id);
        if (!link) {
          await t.tx
            .insertInto('platform.external_task_link')
            .values({
              tenant_id: ctx.tenantId,
              task_id: task.id,
              connection_id: s.connection!.id,
              idempotency_key: input.idempotencyKey,
              sync_status: 'in_preview',
              preview_id: preview.id,
            })
            .execute();
        } else {
          const to = link.status === 'not_sent' ? 'in_preview' : link.status; // in_preview stays
          await t.tx
            .updateTable('platform.external_task_link')
            .set({ sync_status: to, preview_id: preview.id, updated_at: ctx.now })
            .where('id', '=', link.id)
            .execute();
        }
      }

      await t.audit({
        action: 'task_sync.previewed',
        objectType: 'task_set',
        objectId: s.id,
        caseId: s.kase.id,
        summary: `Previewed ${items.length} task(s) for ${s.mapping!.project} · ${s.kase.key} · ${gate.gateLabel}`,
        details: { previewId: preview.id, willCreate: items.length, problems: problems.length },
      });

      const dest = destinationOf(s)!;
      const owners = [
        ...new Map(items.filter((i) => i.task.owner).map((i) => [i.task.owner!.id, i])).values(),
      ];
      const matched = owners.filter((i) => i.input.assignee).map((i) => i.task.owner!.display_name);
      const unmatched = owners.filter((i) => !i.input.assignee).map((i) => i.task.owner!.display_name);
      const result: TaskSyncPreview = {
        id: preview.id,
        taskSetId: s.id,
        planVersionId,
        contentHash: hash,
        destination: dest,
        willCreate: items.length,
        linkText: `each linked to ${s.kase.key} · ${gate.gateLabel}`,
        assigneesText:
          [
            matched.length ? `Matched by directory: ${matched.join(', ')}` : null,
            unmatched.length ? `Not matched: ${unmatched.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'No assignees',
        permissionsText: `${s.connection!.scopeText} · as ${ctx.identity.user.displayName}`,
        repeatsText: 'Each task has a fixed reference; retrying never duplicates',
        items: items.map(({ task, input }, i) => ({
          taskId: task.id,
          title: task.title,
          assignee: input.assignee,
          fields: toolResults[i]?.fields ?? { project: input.project, issueType: input.issueType },
        })),
        problems,
        connectionStatus,
        createdAt: isoDateTime(ctx.now),
        expiresAt: isoDateTime(expiresAt),
      };
      return result;
    },
  }),

  // ---- POST /me/task-sets/:id/sync ------------------------------------------------------------------
  [API.taskSync.send.id]: command(API.taskSync.send, {
    load: (ctx, tx) => loadTaskSet(tx, ctx.params.id),
    authorize: (ctx, s) => access(ctx.identity, s, 'task_sync.send'),
    handle: async (ctx, t, loaded) => {
      requireDestination(loaded);
      await lockLinks(t.tx, loaded.id);
      const s = await loadTaskSet(t.tx, loaded.id, { lockLinks: true });
      const gate = await loadGateContext(t.tx, s.gateRequestId, ctx.now);
      const planVersionId = await planVersionIdOf(t.tx, s);

      const preview = await t.tx
        .selectFrom('platform.task_sync_preview')
        .selectAll()
        .where('id', '=', ctx.body.previewId)
        .where('task_set_id', '=', s.id)
        .executeTakeFirst();
      const previewTaskIds = new Set(
        ((preview?.content as { items?: { taskId: string }[] } | undefined)?.items ?? []).map(
          (i) => i.taskId,
        ),
      );
      const previewed = s.tasks.filter((task) => previewTaskIds.has(task.id));
      // The plan content now, for the previewed tasks: any change since the preview breaks the hash.
      const currentItems = previewed.map((task) => ({
        task,
        input: externalInput(s, task, { tenantId: ctx.tenantId, planVersionId, gateLabel: gate.gateLabel }),
      }));
      const previewCurrent =
        !!preview &&
        new Date(preview.expires_at).getTime() > ctx.now.getTime() &&
        preview.content_hash.trim() === ctx.body.previewHash &&
        contentHash(previewContent(s, planVersionId, currentItems)) === preview.content_hash.trim();

      const facts: WorkflowFacts = {
        approval: gate.approval,
        previewCurrent,
        blockingConditionsMet: gate.blockingConditionsMet,
        ownerAssigned: previewed.length > 0 && previewed.every((task) => task.owner !== null),
      };
      const eligible = currentItems.filter(({ task }) =>
        UNSENT.has(s.links.get(task.id)?.status ?? 'not_sent'),
      );
      if (preview && previewCurrent && eligible.length === 0)
        throw new ApiError(
          'INVALID_TRANSITION',
          'These tasks were already sent. Retry failed tasks instead.',
        );
      // Every guard is evaluated (an empty or stale preview still reports why).
      const froms = eligible.length
        ? eligible.map(({ task }) => s.links.get(task.id)?.status ?? 'not_sent')
        : (['in_preview'] as const);
      for (const from of froms) {
        const r = syncMachine.apply(from, 'enqueue', ctx.identity.actor, facts);
        if (!r.ok) refuse(r);
      }
      // The plan that owns the tasks must be the one in force (pilot activated, experiment locked).
      if (!(await planIsCurrent(t.tx, s)))
        throw new ApiError('PRECONDITIONS_UNMET', 'Activate the plan before creating its tasks.', {
          blockers: [
            {
              key: 'plan_current',
              message:
                s.ownerType === 'pilot_plan_version'
                  ? 'The pilot plan is not active, or a newer plan version replaced it.'
                  : 'The experiment is not locked by the approval that authorizes these tasks.',
            },
          ],
        });

      for (const { task, input } of eligible) {
        const link = s.links.get(task.id);
        const linkId =
          link?.id ??
          (
            await t.tx
              .insertInto('platform.external_task_link')
              .values({
                tenant_id: ctx.tenantId,
                task_id: task.id,
                connection_id: s.connection!.id,
                idempotency_key: input.idempotencyKey,
                sync_status: 'sending',
                preview_id: preview!.id,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        await t.tx
          .updateTable('platform.external_task_link')
          .set({ sync_status: 'sending', preview_id: preview!.id, updated_at: ctx.now })
          .where('id', '=', linkId)
          .execute();
        const msg = await t.tx
          .insertInto('platform.outbox_message')
          .values({
            tenant_id: ctx.tenantId,
            kind: 'task.create',
            aggregate_type: 'external_task_link',
            aggregate_id: linkId,
            idempotency_key: input.idempotencyKey,
            payload: JSON.stringify(input),
            status: 'pending',
            actor_user_id: ctx.userId,
            authorization_ref: JSON.stringify({
              gateRequestId: s.gateRequestId,
              approvalId: gate.approvalId,
              snapshotHash: gate.snapshotHash,
              planVersionId,
              previewId: preview!.id,
            }),
            correlation_id: ctx.correlationId,
          })
          .onConflict((oc) => oc.columns(['tenant_id', 'kind', 'idempotency_key']).doNothing())
          .returning('id')
          .executeTakeFirst();
        if (msg) await enqueueDispatch(t, msg.id);
      }

      await t.audit({
        action: 'task_sync.requested',
        objectType: 'task_set',
        objectId: s.id,
        caseId: s.kase.id,
        summary: `Sent ${eligible.length} task(s) to ${s.mapping!.project} · ${s.kase.key} · ${gate.gateLabel}`,
        details: { previewId: preview!.id, tasks: eligible.length, gateRequestId: s.gateRequestId },
      });
      await t.emit({
        type: 'task_sync.requested',
        eventId: randomUUID(),
        tenantId: ctx.tenantId,
        caseId: s.kase.id,
        actorId: ctx.userId,
        occurredAt: isoDateTime(ctx.now),
        correlationId: ctx.correlationId,
        taskSetId: s.id,
        previewId: preview!.id,
        taskIds: eligible.map((e) => e.task.id),
      });
      return toTaskSetView(await loadTaskSet(t.tx, s.id));
    },
  }),

  // ---- POST /me/task-sets/:id/retry (failed tasks only, same keys) ------------------------------
  [API.taskSync.retry.id]: command(API.taskSync.retry, {
    load: (ctx, tx) => loadTaskSet(tx, ctx.params.id),
    authorize: (ctx, s) => access(ctx.identity, s, 'task_sync.send'),
    handle: async (ctx, t, loaded) => {
      requireDestination(loaded);
      await lockLinks(t.tx, loaded.id);
      const s = await loadTaskSet(t.tx, loaded.id, { lockLinks: true });
      const wanted = ctx.body.taskIds ? new Set(ctx.body.taskIds) : null;
      if (wanted && [...wanted].some((id) => !s.tasks.some((task) => task.id === id)))
        throw new ApiError('VALIDATION_FAILED', 'A task does not belong to this task set.');
      const failed = s.tasks.filter(
        (task) => s.links.get(task.id)?.status === 'failed' && (!wanted || wanted.has(task.id)),
      );
      if (failed.length === 0)
        throw new ApiError('INVALID_TRANSITION', 'There are no failed tasks to retry.');

      const gate = await loadGateContext(t.tx, s.gateRequestId, ctx.now);
      const facts: WorkflowFacts = {
        approval: gate.approval,
        connector: s.connection!.status,
        blockingConditionsMet: gate.blockingConditionsMet,
        ownerAssigned: failed.every((task) => task.owner !== null),
        previewCurrent: true,
      };
      for (const task of failed) {
        const r = syncMachine.apply('failed', 'manual_retry', ctx.identity.actor, facts);
        if (!r.ok) refuse(r);
        if (!task.owner)
          throw new ApiError('PRECONDITIONS_UNMET', 'Assign an owner first.', {
            blockers: [{ key: `task-${task.ordinal}-owner`, message: `Task ${task.ordinal} has no owner` }],
          });
      }

      const planVersionId = await planVersionIdOf(t.tx, s);
      for (const task of failed) {
        const link = s.links.get(task.id)!;
        const existing = await t.tx
          .selectFrom('platform.outbox_message')
          .select(['id', 'payload'])
          .where('kind', '=', 'task.create')
          .where('idempotency_key', '=', link.idempotencyKey)
          .forUpdate()
          .executeTakeFirst();
        // Same key and destination project as the first send; content (e.g. a fixed assignee
        // mapping) is rebuilt from the plan as it is now.
        const project = (existing?.payload as { project?: string } | undefined)?.project;
        const input = externalInput(s, task, {
          tenantId: ctx.tenantId,
          planVersionId,
          gateLabel: gate.gateLabel,
          project,
        });
        let messageId = existing?.id;
        if (existing) {
          await sql`
            UPDATE platform.outbox_message
               SET status = 'pending', next_attempt_at = now(), locked_until = NULL, updated_at = now(),
                   payload = ${JSON.stringify(input)}::jsonb, actor_user_id = ${ctx.userId},
                   max_attempts = greatest(max_attempts, attempts + 5), last_error = NULL
             WHERE id = ${existing.id} AND status = 'failed'`.execute(t.tx);
        } else {
          const msg = await t.tx
            .insertInto('platform.outbox_message')
            .values({
              tenant_id: ctx.tenantId,
              kind: 'task.create',
              aggregate_type: 'external_task_link',
              aggregate_id: link.id,
              idempotency_key: link.idempotencyKey,
              payload: JSON.stringify(input),
              actor_user_id: ctx.userId,
              authorization_ref: JSON.stringify({
                gateRequestId: s.gateRequestId,
                approvalId: gate.approvalId,
                snapshotHash: gate.snapshotHash,
                planVersionId,
              }),
              correlation_id: ctx.correlationId,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          messageId = msg.id;
        }
        await t.tx
          .updateTable('platform.external_task_link')
          .set({ sync_status: 'sending', retryable: true, updated_at: ctx.now })
          .where('id', '=', link.id)
          .where('sync_status', '=', 'failed')
          .execute();
        await enqueueDispatch(t, messageId!);
      }

      await t.audit({
        action: 'task_sync.retried',
        objectType: 'task_set',
        objectId: s.id,
        caseId: s.kase.id,
        summary: `Retry ${failed.length} failed task(s) · ${failed.map((f) => `Task ${f.ordinal}`).join(', ')}`,
        details: { tasks: failed.length, gateRequestId: s.gateRequestId },
      });
      return toTaskSetView(await loadTaskSet(t.tx, s.id));
    },
  }),

  // ---- GET /me/task-sets/:id/export.csv (outage fallback) ----------------------------------------
  [API.taskSync.exportCsv.id]: query(API.taskSync.exportCsv, {
    load: (ctx, tx) => loadTaskSet(tx, ctx.params.id),
    authorize: (ctx, s) => {
      const preview = access(ctx.identity, s, 'task_sync.preview');
      if (preview.allow || preview.code === 'NOT_FOUND') return preview;
      return roleAllows(ctx.identity.subject, 'task.update', {
        businessUnitId: s.kase.businessUnitId,
        caseId: s.kase.id,
      });
    },
    handle: async (ctx, _t, s) => {
      const csv = tasksCsv(
        s.tasks.map((task) => {
          const link = s.links.get(task.id);
          return {
            ordinal: task.ordinal,
            title: task.title,
            milestone: task.milestoneLabel,
            function: task.function,
            owner: task.owner?.display_name ?? null,
            assignee: task.owner && s.mapping ? (s.mapping.assigneeMap[task.owner.id] ?? null) : null,
            dueOn: task.dueOn,
            dueRule: task.dueRule,
            deliverable: task.deliverable,
            dependsOn: task.dependsOn.map((d) => `Task ${d.ordinal}`).join('; '),
            conditionKey: task.conditionKey,
            status: task.status,
            syncStatus: link?.status ?? 'not_sent',
            externalKey: link?.externalKey ?? null,
            reference: link?.idempotencyKey ?? null,
          };
        }),
      );
      ctx.setHeader('content-type', 'text/csv; charset=utf-8');
      ctx.setHeader('content-disposition', `attachment; filename="${s.kase.key}-tasks.csv"`);
      return csv;
    },
  }),

  ...devHandlers,
};
