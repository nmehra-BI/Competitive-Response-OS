/**
 * Gates, snapshots, decisions, positions, dissent, conditions and material changes (S10, brief, G0,
 * G3, X). Approval integrity: a decision binds to the current snapshot's id AND hash; stale and
 * superseded snapshots are refused; the author/case owner, administrators and agents never approve;
 * authority ceilings apply on the tenant-local decision date. Errors in the D-046 order:
 * AGENT_IDENTITY_FORBIDDEN → SNAPSHOT_STALE → SNAPSHOT_HASH_MISMATCH → FORBIDDEN (admin) →
 * SELF_APPROVAL_PROHIBITED → CONFLICT_OF_INTEREST → AUTHORITY_INSUFFICIENT → PRECONDITIONS_UNMET.
 */
import { API, type ConditionInput, type GateCode, type GateRequestStatus } from '@growth-os/contracts';
import { sql, type Tx } from '@growth-os/db';
import {
  createMaterialityEvaluator,
  createPolicyEngine,
  experimentMachine,
  followOnForGate,
  gateRequestMachine,
  mandateMachine,
  snapshotMachine,
  staleBanner,
  type Actor,
  type GateCommand,
  type MandateStatusValue,
} from '@growth-os/domain';
import { caseVisible, matchingRole, roleAllows } from '../../../platform/authz';
import { ApiError, notFound } from '../../../platform/errors';
import { command, query, type HandlerMap, type Tools } from '../../../platform/pipeline';
import { isoDateTime } from '../../../platform/serialize';
import {
  caseByRef,
  caseById,
  caseResource,
  gatePolicy,
  peopleOf,
  refuse,
  subjectOf,
  SYSTEM_PERSON,
  tenantIdSql,
  type CaseLite,
} from './lib/common';
import { gateAction, gateVisible, holdsAdmin, loadGateCtx, type GateCtx } from './lib/access';
import { evaluate } from './lib/facts';
import { applyInvalidations, moveCase, pinsForSnapshots, SYSTEM_GATE } from './lib/moves';
import { buildPackage, diffChanges, gateResource } from './lib/package';
import {
  contentOf,
  displayStatus,
  dissentOfCase,
  gateById,
  GATE_COLUMNS,
  snapshotById,
  toCondition,
  toGateRequest,
  toSnapshot,
  conditionRows,
  type GateRow,
} from './lib/serialize';
import { buildInput, freezeAndInsert } from './lib/snapshot';

const policy = createPolicyEngine();
const OPEN: GateRequestStatus[] = ['draft', 'awaiting_decision', 'stale', 'returned_for_revision'];

const humanActor = (userId: string): Actor => ({ kind: 'human', userId, interactive: true });
const waitMs = (from: Date | null, now: Date) =>
  from ? Math.max(0, now.getTime() - new Date(from).getTime()) : 0;

async function caseOr404(tx: Tx, ref: string): Promise<CaseLite> {
  const c = await caseByRef(tx, ref);
  if (!c) throw notFound();
  return c;
}

/** Display key for a new request: ME-104-G2, ME-104-G2-2, ME-104-X1, ME-104-X2. */
export async function nextGateKey(tx: Tx, caseRow: CaseLite, code: GateCode): Promise<string> {
  const rows = await tx
    .selectFrom('platform.gate_request')
    .select('display_key')
    .where('case_id', '=', caseRow.id)
    .where('gate_code', '=', code)
    .execute();
  const taken = new Set(rows.map((r) => r.display_key));
  for (let n = 1; n < 1000; n++) {
    const key =
      code === 'X'
        ? `${caseRow.key}-X${n}`
        : n === 1
          ? `${caseRow.key}-${code}`
          : `${caseRow.key}-${code}-${n}`;
    if (!taken.has(key)) return key;
  }
  throw new ApiError('INTERNAL', 'Unexpected error');
}

/** Mandate facts for the G0 mandate machine. */
async function mandateFacts(tx: Tx, mandateId: string) {
  const m = await tx
    .selectFrom('me.mandate as m')
    .leftJoin('me.mandate_version as v', (j) =>
      j.on((eb) => eb('v.id', '=', eb.fn.coalesce('m.draft_version_id', 'm.current_version_id'))),
    )
    .select([
      'm.status',
      'm.current_version_id',
      'v.owner_user_id',
      'v.sponsor_user_id',
      'v.currency',
      'v.objective',
      'v.horizon_years',
      'v.pilot_duration_days',
      'v.geography_codes',
      'v.product_id',
      'v.segment_ids',
    ])
    .where('m.id', '=', mandateId)
    .executeTakeFirst();
  if (!m) return null;
  return {
    status: m.status as MandateStatusValue,
    facts: {
      mandate: {
        ownerId: m.owner_user_id,
        sponsorId: m.sponsor_user_id,
        currency: m.currency,
        objective: m.objective,
        horizonYears: m.horizon_years,
        pilotDurationDays: m.pilot_duration_days,
        geographyCodes: m.geography_codes ?? [],
        productId: m.product_id,
        segmentIds: m.segment_ids ?? [],
      },
    },
  };
}

/** G0 submit/resubmit: the mandate goes (back) to awaiting decision through its machine. */
async function mandateToAwaiting(t: Tools, mandateId: string, actor: Actor): Promise<void> {
  const m = await mandateFacts(t.tx, mandateId);
  if (!m) return;
  let status = m.status;
  if (status === 'returned') {
    const r = mandateMachine.apply(status, 'revise', actor, m.facts);
    if (!r.ok) refuse(r);
    status = r.to;
  }
  if (status === 'draft') {
    const r = mandateMachine.apply(status, 'submit', actor, m.facts);
    if (!r.ok) refuse(r);
    status = r.to;
  }
  await t.tx.updateTable('me.mandate').set({ status }).where('id', '=', mandateId).execute();
}

/** Shared by submit, resubmit and refresh: freeze a snapshot from committed inputs and request a decision. */
export async function submitGate(
  ctx: { userId: string; now: Date },
  t: Tools,
  g: GateCtx,
  cmd: Extract<GateCommand, 'submit' | 'resubmit' | 'refresh'>,
) {
  const { gate, caseRow } = g;
  const code = gate.gate_code as GateCode;
  const ev = await evaluate(t.tx, { gateCode: code, caseRow, gate });
  if (!ev.allMet)
    throw new ApiError('PRECONDITIONS_UNMET', ev.summary ?? 'Preconditions unmet', { blockers: ev.blockers });
  const built = await buildInput(t.tx, gate, caseRow);
  const snap = await freezeAndInsert(t.tx, gate, built, ctx.userId, ctx.now);
  const actor = humanActor(ctx.userId);
  const r = gateRequestMachine.apply(gate.status as GateRequestStatus, cmd, actor, {
    caseOwnerId: g.ownerId,
    delegateIds: [],
    preconditions: ev.preconditions,
    snapshot: { id: snap.id, hash: snap.content_hash, status: 'current' },
  });
  if (!r.ok) refuse(r);
  // The previous snapshot is superseded by the new version (never edited, never deleted).
  if (gate.current_snapshot_id) {
    const prev = await snapshotById(t.tx, gate.current_snapshot_id);
    if (
      prev &&
      snapshotMachine.apply(prev.status as 'current' | 'stale' | 'superseded', 'supersede', SYSTEM_GATE, {
        newerSnapshotCreated: true,
      }).ok
    )
      await t.tx
        .updateTable('platform.decision_snapshot')
        .set({ status: 'superseded', superseded_by_snapshot_id: snap.id })
        .where('id', '=', prev.id)
        .execute();
  }
  await t.tx
    .updateTable('platform.gate_request')
    .set({
      status: r.to,
      current_snapshot_id: snap.id,
      submitted_by: ctx.userId,
      submitted_at: ctx.now,
      decided_at: null,
    })
    .where('id', '=', gate.id)
    .execute();
  await t.audit({
    action: r.auditAction,
    objectType: 'gate_request',
    objectId: gate.id,
    objectVersion: snap.version,
    caseId: gate.case_id,
    summary: `${gate.display_key} ${cmd === 'refresh' ? 'refreshed' : 'submitted'}: snapshot v${snap.version}`,
    details: { gate: code, snapshotId: snap.id, snapshotVersion: snap.version, hash: snap.content_hash },
  });
  await t.analytics(
    'gate_submitted',
    { objectType: 'gate_request', objectId: gate.id, objectVersion: snap.version, caseId: gate.case_id },
    { gate: code, snapshotVersion: snap.version },
  );
  const follow = followOnForGate(code, cmd);
  if (follow.case && gate.case_id)
    await moveCase(t, gate.case_id, follow.case, {
      props: { scale_requested: { preconditionsUnmet: 0 } },
      reason: `${code} ${cmd}`,
    });
  if (code === 'G0' && gate.subject_type === 'mandate') await mandateToAwaiting(t, gate.subject_id, actor);
  const fresh = (await gateById(t.tx, gate.id))!;
  const people = await peopleOf(t.tx, [snap.created_by]);
  return { gateRequest: await toGateRequest(t.tx, fresh), snapshot: toSnapshot(snap, people) };
}

const APPROVE = new Set(['approve', 'approve_with_conditions']);
const TRANSITIONS = new Set(['approve', 'approve_with_conditions', 'return_for_revision', 'not_approved']);
const EXPIRING: GateCode[] = ['G1', 'G2', 'X'];

function signOffPresent(
  content: ReturnType<typeof contentOf>,
  positions: { area: string; position: string }[],
  area: string,
) {
  const ok = (p: string) => p !== 'dissents' && p !== 'not_yet_reviewed' && p !== 'abstains';
  return (
    content.signOffs.some((s) => s.area === area && ok(s.position)) ||
    positions.some((p) => p.area === area && ok(p.position))
  );
}

/**
 * Conditions of an approval. A condition that repeats a proposed condition word for word IS that
 * condition (same key C1/C2, no duplicate); others get the next keys.
 */
async function writeConditions(
  t: Tools,
  gate: GateRow,
  proposed: readonly ConditionInput[],
  given: readonly ConditionInput[],
  approvalId: string,
  userId: string,
  now: Date,
): Promise<void> {
  const existing = new Map((await conditionRows(t.tx, [gate.id])).map((c) => [c.key, c]));
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
  let next = Math.max(proposed.length, existing.size) + 1;
  const used = new Set<string>();
  for (const c of given) {
    const i = proposed.findIndex((p) => norm(p.text) === norm(c.text) && p.flag === c.flag);
    const key = i >= 0 ? `C${i + 1}` : `C${next++}`;
    if (used.has(key)) continue;
    used.add(key);
    if (existing.has(key)) continue;
    await t.tx
      .insertInto('platform.condition')
      .values({
        tenant_id: tenantIdSql,
        gate_request_id: gate.id,
        approval_id: approvalId,
        key,
        text: c.text,
        owner_user_id: c.ownerId,
        due_on: c.dueOn,
        due_rule: c.dueRule,
        blocks_execution: c.flag === 'blocks_execution',
        added_by: userId,
        created_at: now,
      })
      .execute();
  }
}

/** G1 approval locks the experiment plans its snapshot pins (pre-registration). */
async function lockExperiments(t: Tools, gate: GateRow, snapshotId: string, now: Date) {
  const pinned = await t.tx
    .selectFrom('platform.snapshot_component as c')
    .innerJoin('me.experiment_plan_version as p', 'p.id', 'c.component_id')
    .innerJoin('me.experiment as e', 'e.id', 'p.experiment_id')
    .select(['e.id as experiment_id', 'e.lifecycle', 'p.id as plan_id', 'p.version', 'e.display_key'])
    .where('c.snapshot_id', '=', snapshotId)
    .where('c.component_type', '=', 'experiment_plan_version')
    .execute();
  for (const p of pinned) {
    const links = await t.tx
      .selectFrom('me.experiment_assumption')
      .select(sql<string>`count(*)`.as('n'))
      .where('experiment_id', '=', p.experiment_id)
      .executeTakeFirst();
    const r = experimentMachine.apply(p.lifecycle as 'draft', 'lock', SYSTEM_GATE, {
      plan: { complete: true, linkedAssumptionCount: Number(links?.n ?? 0) },
    });
    if (!r.ok) continue;
    // Mark the pre-registered original while the plan is still a draft (the DB freezes it after).
    await t.tx
      .updateTable('me.experiment_plan_version')
      .set({ is_original: true })
      .where('id', '=', p.plan_id)
      .execute();
    await t.tx
      .updateTable('me.experiment')
      .set({ lifecycle: r.to, locked_by_gate_request_id: gate.id, locked_at: now })
      .where('id', '=', p.experiment_id)
      .execute();
    // The validation task set for WS6: owned by the experiment, authorized by this G1, with the
    // validation-task destination. WS4b never sends tasks (WAVE3 §7).
    const mapping = await t.tx
      .selectFrom('platform.connector_mapping')
      .select(['id', 'connection_id'])
      .where('purpose', '=', 'validation_tasks')
      .executeTakeFirst();
    await t.tx
      .insertInto('platform.task_set')
      .values({
        tenant_id: tenantIdSql,
        case_id: gate.case_id!,
        owner_type: 'experiment',
        owner_id: p.experiment_id,
        authorizing_gate_request_id: gate.id,
        connection_id: mapping?.connection_id ?? null,
        mapping_id: mapping?.id ?? null,
        created_at: now,
      })
      .onConflict((oc) => oc.columns(['owner_type', 'owner_id']).doNothing())
      .execute();
    await t.audit({
      action: r.auditAction,
      objectType: 'experiment',
      objectId: p.experiment_id,
      objectVersion: p.version,
      caseId: gate.case_id,
      summary: `${p.display_key} plan v${p.version} locked by ${gate.display_key}`,
      details: { gateRequestId: gate.id, planVersion: p.version },
    });
  }
}

export const gateHandlers: HandlerMap = {
  [API.gates.rail.id]: query(API.gates.rail, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => caseVisible(ctx.identity.subject, c),
    handle: async (ctx, { tx }, c) => {
      const code = ctx.params.gateCode;
      const gate = (await tx
        .selectFrom('platform.gate_request')
        .select([...GATE_COLUMNS])
        .where('case_id', '=', c.id)
        .where('gate_code', '=', code)
        .where('status', '<>', 'withdrawn')
        .orderBy('created_at', 'desc')
        .executeTakeFirst()) as GateRow | undefined;
      const ev = await evaluate(tx, { gateCode: code, caseRow: c, gate: gate ?? null });
      const afterReview = ['review_due', 'scale_approval_pending', 'scaling', 'closed'].includes(c.stage);
      const status =
        gate && !['draft', 'withdrawn'].includes(gate.status)
          ? displayStatus(gate, ev)
          : displayStatus({ gate_code: code, status: 'draft' }, ev) === 'ready_to_submit'
            ? 'ready_to_submit'
            : code === 'G3' && afterReview
              ? 'blocked'
              : ev.metCount === 0
                ? 'not_started'
                : 'preconditions_open';
      return {
        gateCode: code,
        status,
        preconditions: ev.preconditions,
        blockers: ev.blockers,
        canSubmit: ev.allMet && (!gate || gate.status === 'draft' || gate.status === 'returned_for_revision'),
      };
    },
  }),

  [API.gates.createRequest.id]: command(API.gates.createRequest, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => {
      const v = caseVisible(ctx.identity.subject, c);
      if (!v.allow) return v;
      return roleAllows(ctx.identity.subject, 'gate.submit', {
        businessUnitId: c.businessUnitId,
        caseId: c.id,
      });
    },
    handle: async (ctx, t, c) => {
      const { gateCode: code, scope, parentGateRequestId, proposedConditions } = ctx.body;
      if (code === 'G0')
        throw new ApiError('VALIDATION_FAILED', 'G0 is requested from the mandate (Submit for G0).', {
          errors: [{ path: 'body.gateCode', code: 'invalid_enum_value', message: 'Use G1, G2, G3 or X' }],
        });
      const open = await t.tx
        .selectFrom('platform.gate_request')
        .select('display_key')
        .where('case_id', '=', c.id)
        .where('gate_code', '=', code)
        .where('status', 'in', OPEN)
        .executeTakeFirst();
      if (open && code !== 'X')
        throw new ApiError(
          'INVALID_TRANSITION',
          `${open.display_key} is still open. Withdraw or decide it first.`,
        );
      if (code === 'X') {
        if (!parentGateRequestId)
          throw new ApiError('VALIDATION_FAILED', 'An extension needs the gate it extends.', {
            errors: [{ path: 'body.parentGateRequestId', code: 'custom', message: 'Required for X' }],
          });
      }
      if (parentGateRequestId) {
        const parent = await gateById(t.tx, parentGateRequestId);
        if (!parent || parent.case_id !== c.id) throw notFound();
      }
      if (code === 'G3') {
        // Scale is never requested while its preconditions are unmet (PRD §4, D-039).
        const ev = await evaluate(t.tx, {
          gateCode: 'G3',
          caseRow: c,
          gate: null,
          scopeOverride: { ...scope },
        });
        if (!ev.allMet)
          throw new ApiError('PRECONDITIONS_UNMET', ev.summary ?? 'G3 preconditions unmet', {
            blockers: ev.blockers,
          });
      }
      const key = await nextGateKey(t.tx, c, code);
      const amount = scope.amount;
      const row = await t.tx
        .insertInto('platform.gate_request')
        .values({
          tenant_id: tenantIdSql,
          display_key: key,
          case_id: c.id,
          subject_type: 'case',
          subject_id: c.id,
          business_unit_id: c.businessUnitId,
          gate_code: code,
          status: 'draft',
          scope: JSON.stringify({ ...scope, proposedConditions }),
          requested_amount: amount,
          currency: amount ? scope.currency : null,
          duration_days: scope.durationDays,
          parent_gate_request_id: parentGateRequestId,
          created_by: ctx.userId,
          created_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'gate_request.created',
        objectType: 'gate_request',
        objectId: row.id,
        caseId: c.id,
        summary: `${key} drafted`,
        details: { gate: code, proposedConditions: proposedConditions.length },
      });
      return toGateRequest(t.tx, (await gateById(t.tx, row.id))!);
    },
  }),

  [API.gates.get.id]: query(API.gates.get, {
    load: (ctx, tx) => loadGateCtx(tx, ctx.params.id),
    authorize: (ctx, g) => gateVisible(ctx.identity.subject, g),
    handle: async (_ctx, { tx }, g) => {
      const ev =
        g.gate.status === 'draft'
          ? await evaluate(tx, { gateCode: g.gate.gate_code as GateCode, caseRow: g.caseRow, gate: g.gate })
          : undefined;
      return toGateRequest(tx, g.gate, ev);
    },
  }),

  [API.gates.submit.id]: command(API.gates.submit, {
    load: (ctx, tx) => loadGateCtx(tx, ctx.params.id),
    authorize: (ctx, g) =>
      gateAction(ctx.identity.subject, g, g.gate.gate_code === 'G0' ? 'mandate.submit' : 'gate.submit'),
    handle: async (ctx, t, g) => {
      const cmd =
        g.gate.status === 'draft' ? 'submit' : g.gate.status === 'returned_for_revision' ? 'resubmit' : null;
      if (!cmd)
        throw new ApiError(
          'INVALID_TRANSITION',
          `${g.gate.display_key} is ${g.gate.status.replace(/_/g, ' ')}.`,
        );
      return submitGate(ctx, t, g, cmd);
    },
  }),

  [API.gates.refresh.id]: command(API.gates.refresh, {
    load: (ctx, tx) => loadGateCtx(tx, ctx.params.id),
    authorize: (ctx, g) =>
      gateAction(ctx.identity.subject, g, g.gate.gate_code === 'G0' ? 'mandate.submit' : 'gate.submit'),
    handle: async (ctx, t, g) => {
      if (g.gate.status !== 'stale')
        throw new ApiError('INVALID_TRANSITION', 'Only a stale snapshot can be refreshed.');
      return submitGate(ctx, t, g, 'refresh');
    },
  }),

  [API.gates.withdraw.id]: command(API.gates.withdraw, {
    load: (ctx, tx) => loadGateCtx(tx, ctx.params.id),
    authorize: (ctx, g) =>
      gateAction(ctx.identity.subject, g, g.gate.gate_code === 'G0' ? 'mandate.submit' : 'gate.withdraw'),
    handle: async (ctx, t, g) => {
      const { gate } = g;
      const from = gate.status as GateRequestStatus;
      const r = gateRequestMachine.apply(from, 'withdraw', humanActor(ctx.userId), {
        packageAuthorId: gate.submitted_by ?? gate.created_by,
      });
      if (!r.ok) refuse(r);
      await t.tx
        .updateTable('platform.gate_request')
        .set({ status: r.to })
        .where('id', '=', gate.id)
        .execute();
      await t.audit({
        action: r.auditAction,
        objectType: 'gate_request',
        objectId: gate.id,
        caseId: gate.case_id,
        summary: `${gate.display_key} withdrawn by the package author`,
        details: { gate: gate.gate_code, from },
      });
      const follow = followOnForGate(gate.gate_code as GateCode, 'withdraw', from);
      if (follow.case && gate.case_id) await moveCase(t, gate.case_id, follow.case);
      return toGateRequest(t.tx, (await gateById(t.tx, gate.id))!);
    },
  }),

  [API.gates.package.id]: query(API.gates.package, {
    load: (ctx, tx) => loadGateCtx(tx, ctx.params.id),
    authorize: (ctx, g) => gateVisible(ctx.identity.subject, g, 'case.read_brief'),
    handle: async (ctx, { tx }, g) => {
      const view = await buildPackage(tx, {
        gate: g.gate,
        caseRow: g.caseRow,
        subject: subjectOf(ctx),
        viewerId: ctx.userId,
        version: ctx.query.version,
        compareTo: ctx.query.compareTo,
      });
      if (!view) throw notFound();
      return view;
    },
  }),

  [API.gates.diff.id]: query(API.gates.diff, {
    load: async (ctx, tx) => {
      const snap = await snapshotById(tx, ctx.params.id);
      if (!snap) throw notFound();
      return { snap, g: await loadGateCtx(tx, snap.gate_request_id) };
    },
    authorize: (ctx, f) => gateVisible(ctx.identity.subject, f.g),
    handle: async (ctx, { tx }, { snap, g }) => {
      const against = ctx.query.against;
      let from = contentOf(snap);
      let to;
      if (against === 'current_inputs') {
        const built = await buildInput(tx, { ...g.gate, current_snapshot_id: snap.id }, g.caseRow);
        const { components, ...rest } = built.input;
        to = {
          ...rest,
          schemaVersion: 1 as const,
          components: components.map(({ type, id, version }) => ({ type, id, version })),
        };
      } else {
        const other = await snapshotById(tx, against);
        if (!other || other.subject_id !== snap.subject_id) throw notFound();
        // Always "older → newer" so the change reads forward.
        if (other.version < snap.version) {
          to = from;
          from = contentOf(other);
        } else to = contentOf(other);
      }
      return { changes: diffChanges(from, to) };
    },
  }),

  [API.gates.decide.id]: command(API.gates.decide, {
    load: (ctx, tx) => loadGateCtx(tx, ctx.params.id),
    // Administrators pass visibility here only to be refused with FORBIDDEN by the policy below.
    authorize: (ctx, g) =>
      holdsAdmin(ctx.identity.subject)
        ? {
            allow: true,
            rule: 'gate.decide:admin_checked_in_policy',
            authorityGrantId: null,
            role: 'tenant_admin',
          }
        : gateVisible(ctx.identity.subject, g),
    handle: async (ctx, t, g) => {
      const { gate, caseRow } = g;
      const body = ctx.body;
      const code = gate.gate_code as GateCode;
      if (gate.status !== 'awaiting_decision' && gate.status !== 'stale')
        throw new ApiError('INVALID_TRANSITION', `${gate.display_key} is not awaiting a decision.`);
      // 1. snapshot current (the id the approver read must be the current one) → 2. hash equal.
      const snap = gate.current_snapshot_id ? await snapshotById(t.tx, gate.current_snapshot_id) : null;
      if (!snap || gate.status === 'stale' || snap.status !== 'current' || body.snapshotId !== snap.id) {
        const decidedOn = body.snapshotId === snap?.id ? snap : await snapshotById(t.tx, body.snapshotId);
        const reason = decidedOn?.stale_reason ?? snap?.stale_reason;
        throw new ApiError(
          'SNAPSHOT_STALE',
          reason ? staleBanner(reason).title : 'You decided on a snapshot that is no longer the current one.',
          {
            blockers: [
              { key: 'snapshot_current', message: `Refresh snapshot (creates v${(snap?.version ?? 0) + 1})` },
            ],
          },
        );
      }
      if (body.snapshotHash !== snap.content_hash)
        throw new ApiError(
          'SNAPSHOT_HASH_MISMATCH',
          'The package you read differs from the current snapshot. Reload before deciding.',
          {
            blockers: [{ key: 'hash_matches', message: 'Reload the package before deciding.' }],
          },
        );
      // 3. policy: admin → self → conflict → deciding role → authority (on the tenant-local date).
      const subject = subjectOf(ctx);
      const resource = gateResource(gate, caseRow, snap);
      if (APPROVE.has(body.disposition)) {
        const d = policy.check(subject, 'gate.decide', resource);
        if (!d.allow)
          throw new ApiError(
            d.code === 'NOT_FOUND' ? 'NOT_FOUND' : d.code,
            d.code === 'NOT_FOUND' ? 'Not found' : d.reason,
          );
      } else {
        const c = policy.gateDecisionChecks(subject, resource);
        if (!c.designatedApprover.ok)
          throw new ApiError(
            c.designatedApprover.code === 'NOT_FOUND'
              ? 'NOT_FOUND'
              : (c.designatedApprover.code ?? 'FORBIDDEN'),
            c.designatedApprover.reason ?? 'Your role does not decide gates.',
          );
        if (!c.notConflicted.ok)
          throw new ApiError('CONFLICT_OF_INTEREST', c.notConflicted.reason ?? 'Conflicted');
      }
      if (body.disposition !== 'approve_with_conditions' && body.conditions.length > 0)
        throw new ApiError('VALIDATION_FAILED', 'Conditions are added only with "Approve with conditions".', {
          errors: [{ path: 'body.conditions', code: 'custom', message: 'Only with approve_with_conditions' }],
        });
      if ((body.disposition === 'delegate') !== (body.delegateToUserId !== null))
        throw new ApiError('VALIDATION_FAILED', 'Delegation needs the person you delegate to.', {
          errors: [{ path: 'body.delegateToUserId', code: 'custom', message: 'Required with delegate only' }],
        });
      const already = await t.tx
        .selectFrom('platform.approval')
        .select('id')
        .where('snapshot_id', '=', snap.id)
        .where('approver_user_id', '=', ctx.userId)
        .executeTakeFirst();
      if (already)
        throw new ApiError('INVALID_TRANSITION', 'You have already recorded a decision on this snapshot.');

      // 4. the machine re-checks everything and adds required sign-offs and condition owners.
      const content = contentOf(snap);
      const gp = await gatePolicy(t.tx, code);
      const positions = await t.tx
        .selectFrom('platform.reviewer_position')
        .select(['area', 'position'])
        .where('snapshot_id', '=', snap.id)
        .execute();
      const checks = policy.gateDecisionChecks(subject, resource);
      let to: GateRequestStatus = gate.status as GateRequestStatus;
      let auditAction = `gate_request.${body.disposition}`;
      if (TRANSITIONS.has(body.disposition)) {
        const r = gateRequestMachine.apply(
          'awaiting_decision',
          body.disposition as GateCommand,
          ctx.identity.actor,
          {
            snapshot: { id: snap.id, hash: snap.content_hash, status: 'current' },
            decision: {
              snapshotId: body.snapshotId,
              snapshotHash: body.snapshotHash,
              conditions: body.conditions.map((c) => ({ ownerId: c.ownerId })),
            },
            decisionChecks: checks,
            requiredSignOffs: gp.requiredSignOffAreas.map((area) => ({
              area,
              present: signOffPresent(content, positions, area),
            })),
            rationale: body.rationale,
          },
        );
        if (!r.ok) refuse(r);
        to = r.to;
        auditAction = r.auditAction;
      }
      const role =
        matchingRole(subject, 'gate.decide', {
          businessUnitId: gate.business_unit_id,
          caseId: gate.case_id,
        }) ?? 'sponsor';
      const approval = await t.tx
        .insertInto('platform.approval')
        .values({
          tenant_id: tenantIdSql,
          gate_request_id: gate.id,
          snapshot_id: snap.id,
          snapshot_hash: snap.content_hash,
          approver_user_id: ctx.userId,
          approver_role: role,
          authority_grant_id: APPROVE.has(body.disposition) ? checks.authorityGrantId : null,
          session_id: ctx.identity.session.sessionId,
          disposition: body.disposition,
          rationale: body.rationale,
          note: body.note,
          delegated_to_user_id: body.delegateToUserId,
          idempotency_key: ctx.idempotencyKey ?? `${ctx.correlationId}`,
          decided_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const wait = waitMs(gate.submitted_at, ctx.now);
      if (TRANSITIONS.has(body.disposition)) {
        const expires =
          APPROVE.has(body.disposition) && EXPIRING.includes(code)
            ? new Date(ctx.now.getTime() + gp.approvalExpiryDays * 86_400_000)
            : null;
        await t.tx
          .updateTable('platform.gate_request')
          .set({ status: to, decided_at: ctx.now, expires_at: expires })
          .where('id', '=', gate.id)
          .execute();
      }
      if (body.disposition === 'approve_with_conditions')
        await writeConditions(
          t,
          gate,
          content.conditionsProposed,
          body.conditions,
          approval.id,
          ctx.userId,
          ctx.now,
        );
      await t.audit({
        action: auditAction,
        objectType: 'gate_request',
        objectId: gate.id,
        objectVersion: snap.version,
        caseId: gate.case_id,
        summary: `${gate.display_key} v${snap.version}: ${body.disposition.replace(/_/g, ' ')}`,
        details: {
          gate: code,
          approvalId: approval.id,
          snapshotId: snap.id,
          hash: snap.content_hash,
          conditions: body.conditions.length,
        },
      });
      const target = {
        objectType: 'gate_request',
        objectId: gate.id,
        objectVersion: snap.version,
        caseId: gate.case_id,
      };
      if (APPROVE.has(body.disposition))
        await t.analytics('gate_approved', target, {
          gate: code,
          withConditions: body.disposition === 'approve_with_conditions',
          waitMs: wait,
        });
      else if (body.disposition === 'return_for_revision' || body.disposition === 'not_approved')
        await t.analytics('gate_returned', target, {
          gate: code,
          disposition: body.disposition,
          waitMs: wait,
        });

      // 5. follow-ons: case stage, mandate, experiment locks (system actor).
      if (TRANSITIONS.has(body.disposition)) {
        const follow = followOnForGate(code, body.disposition as GateCommand, 'awaiting_decision');
        if (follow.case && gate.case_id)
          await moveCase(t, gate.case_id, follow.case, {
            props: { validation_authorized: { gate: 'G1' }, mandate_approved: { gate: 'G0', waitMs: wait } },
            reason: `${code} ${body.disposition}`,
          });
        if (follow.mandate && gate.subject_type === 'mandate') {
          const m = await mandateFacts(t.tx, gate.subject_id);
          if (m) {
            const r = mandateMachine.apply(m.status, follow.mandate, SYSTEM_GATE, m.facts);
            if (r.ok) {
              const pinned = content.components.find((c) => c.type === 'mandate_version');
              await t.tx
                .updateTable('me.mandate')
                .set({
                  status: r.to,
                  ...(r.to === 'approved'
                    ? { g0_gate_request_id: gate.id, ...(pinned ? { current_version_id: pinned.id } : {}) }
                    : {}),
                })
                .where('id', '=', gate.subject_id)
                .execute();
              if (r.to === 'approved')
                await t.analytics(
                  'mandate_approved',
                  { objectType: 'mandate', objectId: gate.subject_id },
                  { gate: 'G0', waitMs: wait },
                );
            }
          }
          // Cases created directly on this mandate (cases.createDirect) wait in Draft mandate:
          // the G0 approval moves them to Discovery (mandate_approved is emitted once, above).
          if (follow.case) {
            const waiting = await t.tx
              .selectFrom('platform.workflow_case')
              .select('id')
              .where('mandate_id', '=', gate.subject_id)
              .where('stage', '=', 'draft_mandate')
              .execute();
            for (const w of waiting)
              await moveCase(t, w.id, follow.case, { reason: `G0 approved for ${gate.display_key}` });
          }
        }
        if (follow.lockExperiments) await lockExperiments(t, gate, snap.id, ctx.now);
        if (code === 'G2' && APPROVE.has(body.disposition) && gate.case_id)
          await t.tx
            .updateTable('me.pilot_plan')
            .set({ gate_request_id: gate.id })
            .where('case_id', '=', gate.case_id)
            .execute();
      }
      const fresh = (await gateById(t.tx, gate.id))!;
      return (await buildPackage(t.tx, {
        gate: fresh,
        caseRow: caseRow ? await caseById(t.tx, caseRow.id) : null,
        subject,
        viewerId: ctx.userId,
      }))!;
    },
  }),

  [API.gates.recordPosition.id]: command(API.gates.recordPosition, {
    load: async (ctx, tx) => {
      const snap = await snapshotById(tx, ctx.params.id);
      if (!snap) throw notFound();
      return { snap, g: await loadGateCtx(tx, snap.gate_request_id) };
    },
    authorize: (ctx, f) => gateAction(ctx.identity.subject, f.g, 'gate.record_position'),
    handle: async (ctx, t, { snap, g }) => {
      if (snap.status !== 'current' || g.gate.current_snapshot_id !== snap.id)
        throw new ApiError('INVALID_TRANSITION', 'Positions are signed on the current snapshot only.');
      const row = await t.tx
        .insertInto('platform.reviewer_position')
        .values({
          tenant_id: tenantIdSql,
          snapshot_id: snap.id,
          reviewer_user_id: ctx.userId,
          area: ctx.body.area,
          position: ctx.body.position,
          scope_text: ctx.body.scopeText,
          signed_at: ctx.now,
        })
        .onConflict((oc) =>
          oc.columns(['snapshot_id', 'reviewer_user_id', 'area']).doUpdateSet({
            position: ctx.body.position,
            scope_text: ctx.body.scopeText,
            signed_at: ctx.now,
          }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'reviewer_position.recorded',
        objectType: 'reviewer_position',
        objectId: row.id,
        objectVersion: snap.version,
        caseId: g.gate.case_id,
        summary: `${ctx.body.area} position on ${g.gate.display_key} v${snap.version}: ${ctx.body.position.replace(/_/g, ' ')}`,
        details: { area: ctx.body.area, position: ctx.body.position, snapshotId: snap.id },
      });
      return (await buildPackage(t.tx, {
        gate: g.gate,
        caseRow: g.caseRow,
        subject: subjectOf(ctx),
        viewerId: ctx.userId,
        version: snap.version,
      }))!;
    },
  }),

  [API.gates.recordDissent.id]: command(API.gates.recordDissent, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => {
      const v = caseVisible(ctx.identity.subject, c);
      if (!v.allow) return v;
      return roleAllows(ctx.identity.subject, 'gate.record_position', {
        businessUnitId: c.businessUnitId,
        caseId: c.id,
      });
    },
    handle: async (ctx, t, c) => {
      const open = await t.tx
        .selectFrom('platform.gate_request')
        .select(['current_snapshot_id'])
        .where('case_id', '=', c.id)
        .where('status', 'in', ['awaiting_decision', 'stale'])
        .orderBy('submitted_at', 'desc')
        .executeTakeFirst();
      const row = await t.tx
        .insertInto('platform.dissent')
        .values({
          tenant_id: tenantIdSql,
          case_id: c.id,
          author_id: ctx.userId,
          statement: ctx.body.statement,
          scope_text: ctx.body.scopeText,
          signed_snapshot_id: open?.current_snapshot_id ?? null,
          signed_at: ctx.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'dissent.recorded',
        objectType: 'dissent',
        objectId: row.id,
        caseId: c.id,
        summary: `Signed dissent recorded on ${c.key}`,
        details: { snapshotId: open?.current_snapshot_id ?? null },
      });
      const all = await dissentOfCase(t.tx, c.id);
      return all.find((d) => d.id === row.id)!;
    },
  }),

  [API.gates.markConditionMet.id]: command(API.gates.markConditionMet, {
    load: async (ctx, tx) => {
      const c = await tx
        .selectFrom('platform.condition')
        .select(['id', 'gate_request_id', 'owner_user_id', 'status', 'key'])
        .where('id', '=', ctx.params.id)
        .executeTakeFirst();
      if (!c) throw notFound();
      return { c, g: await loadGateCtx(tx, c.gate_request_id) };
    },
    authorize: (ctx, { c, g }) => {
      const v = gateVisible(ctx.identity.subject, g);
      if (!v.allow) return v;
      return ctx.userId === c.owner_user_id || ctx.userId === g.ownerId
        ? { ...v, rule: 'condition.owner_or_case_owner' }
        : {
            allow: false,
            rule: 'condition.owner',
            code: 'FORBIDDEN',
            reason: 'Only the condition owner or the case owner can mark it met.',
          };
    },
    handle: async (ctx, t, { c, g }) => {
      if (c.status !== 'open') throw new ApiError('INVALID_TRANSITION', `${c.key} is already ${c.status}.`);
      await t.tx
        .updateTable('platform.condition')
        .set({ status: 'met', met_evidence: ctx.body.evidence, met_by: ctx.userId, met_at: ctx.now })
        .where('id', '=', c.id)
        .execute();
      await t.audit({
        action: 'condition.met',
        objectType: 'condition',
        objectId: c.id,
        caseId: g.gate.case_id,
        summary: `${c.key} on ${g.gate.display_key} marked met`,
        details: { gateRequestId: g.gate.id },
      });
      const rows = await conditionRows(t.tx, [g.gate.id]);
      const row = rows.find((r) => r.id === c.id)!;
      return toCondition(row, await peopleOf(t.tx, [row.owner_user_id, row.added_by]));
    },
  }),

  [API.gates.materialChanges.id]: query(API.gates.materialChanges, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => caseVisible(ctx.identity.subject, c),
    handle: async (_ctx, { tx }, c) => ({ items: await materialChangesOf(tx, c.id) }),
  }),

  [API.gates.resolveMateriality.id]: command(API.gates.resolveMateriality, {
    load: async (ctx, tx) => {
      const mc = await tx
        .selectFrom('platform.material_change')
        .selectAll()
        .where('id', '=', ctx.params.id)
        .executeTakeFirst();
      if (!mc) throw notFound();
      const c = await caseById(tx, mc.case_id);
      if (!c) throw notFound();
      return { mc, c };
    },
    authorize: (ctx, { c }) => {
      const v = caseVisible(ctx.identity.subject, c);
      if (!v.allow) return v;
      const d = policy.check(subjectOf(ctx), 'materiality.resolve', caseResource(c));
      return d.allow ? { allow: true, rule: d.rule, authorityGrantId: null, role: v.role } : d;
    },
    handle: async (ctx, t, { mc, c }) => {
      if (mc.classification !== 'uncertain' || mc.resolved_classification !== null)
        throw new ApiError('INVALID_TRANSITION', 'Only an unresolved uncertain change can be classified.');
      const impacts = await t.tx
        .selectFrom('platform.material_change_impact')
        .select('snapshot_id')
        .where('material_change_id', '=', mc.id)
        .execute();
      const pins = await pinsForSnapshots(t, [...new Set(impacts.map((i) => i.snapshot_id))]);
      const outcome = createMaterialityEvaluator().resolveEscalation(
        ctx.body.classification,
        {
          caseId: c.id,
          changeType: mc.change_type as never,
          objectType: mc.object_type,
          objectId: mc.object_id,
          fromVersion: mc.from_version,
          toVersion: mc.to_version,
          at: isoDateTime(mc.detected_at),
        },
        pins,
      );
      const applied = await applyInvalidations(t, {
        caseId: c.id,
        materialChangeId: mc.id,
        changeType: mc.change_type as never,
        outcome,
        pins,
        now: ctx.now,
      });
      await t.tx
        .updateTable('platform.material_change')
        .set({
          resolved_classification: ctx.body.classification,
          resolved_by: ctx.userId,
          resolved_at: ctx.now,
          resolution_rationale: ctx.body.rationale,
        })
        .where('id', '=', mc.id)
        .execute();
      await t.audit({
        action: 'material_change.resolved',
        objectType: 'material_change',
        objectId: mc.id,
        caseId: c.id,
        summary: `Uncertain change classified ${ctx.body.classification.replace('_', ' ')}`,
        details: { classification: ctx.body.classification, invalidatedApprovals: applied.invalidated },
      });
      return (await materialChangesOf(t.tx, c.id)).find((x) => x.id === mc.id)!;
    },
  }),
};

async function materialChangesOf(tx: Tx, caseId: string) {
  const rows = await tx
    .selectFrom('platform.material_change')
    .selectAll()
    .where('case_id', '=', caseId)
    .orderBy('detected_at', 'desc')
    .execute();
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const impacts = await tx
    .selectFrom('platform.material_change_impact')
    .select(['material_change_id', 'snapshot_id', 'effect'])
    .where('material_change_id', 'in', ids)
    .execute();
  const invalidations = await tx
    .selectFrom('platform.approval_invalidation')
    .select(['material_change_id', 'approval_id'])
    .where('material_change_id', 'in', ids)
    .execute();
  const escalatedSnaps = impacts.filter((i) => i.effect === 'escalated').map((i) => i.snapshot_id);
  const escalatedApprovals = escalatedSnaps.length
    ? await tx
        .selectFrom('platform.approval')
        .select(['id', 'snapshot_id'])
        .where('snapshot_id', 'in', escalatedSnaps)
        .where('disposition', 'in', ['approve', 'approve_with_conditions'])
        .execute()
    : [];
  const people = await peopleOf(
    tx,
    rows.flatMap((r) => [r.actor_user_id, r.resolved_by]),
  );
  return rows.map((r) => {
    const im = impacts.filter((i) => i.material_change_id === r.id);
    const approvals = new Set([
      ...invalidations.filter((i) => i.material_change_id === r.id).map((i) => i.approval_id),
      ...escalatedApprovals
        .filter((a) => im.some((i) => i.effect === 'escalated' && i.snapshot_id === a.snapshot_id))
        .map((a) => a.id),
    ]);
    return {
      id: r.id,
      caseId: r.case_id,
      changeType: r.change_type as never,
      objectType: r.object_type,
      objectId: r.object_id,
      fromVersion: r.from_version,
      toVersion: r.to_version,
      classification: r.classification as never,
      ruleKey: r.rule_key,
      detectedAt: isoDateTime(r.detected_at),
      actor: r.actor_user_id ? people(r.actor_user_id) : SYSTEM_PERSON,
      affectedSnapshotIds: [...new Set(im.map((i) => i.snapshot_id))],
      affectedApprovalIds: [...approvals],
      resolvedClassification: (r.resolved_classification ?? null) as never,
      resolvedBy: r.resolved_by ? people(r.resolved_by) : null,
    };
  });
}
