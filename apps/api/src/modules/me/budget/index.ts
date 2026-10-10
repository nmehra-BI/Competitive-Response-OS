/**
 * Budget entries (S11 "Record spend", ME-14, D-114 §2, D-133): manual committed/spent entries against an
 * approved gate budget, with a PO or invoice reference and an optional task. Entries are append-only; a
 * correction is a reversing entry with a reason (same gate, kind, amount and currency; the database
 * guard double-checks), and the meter subtracts it. Spend or commitments above the remaining approved
 * amount are refused with "Request scope change": a bigger budget needs a new authorization. Only the
 * gate's own currency is accepted (no conversion). Pilot budget money is one-time money: it never
 * mixes with recurring (/year) money.
 */
import { API } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { caseVisible, roleAllows } from '../../../platform/authz';
import type { Authorization } from '../../../platform/context';
import { ApiError, notFound } from '../../../platform/errors';
import { command, query, type HandlerMap } from '../../../platform/pipeline';
import {
  approvalEffectiveness,
  asOfDate,
  caseById,
  caseByRef,
  cents,
  fmtMoneyShort,
  fromCents,
  tenantIdSql,
  type CaseLite,
} from '../gates/lib/common';
import { budgetEntryRows, budgetMeter, netByKind, pilotPlanOf, toBudgetEntries } from '../pilot/view';

async function caseOr404(tx: Tx, ref: string): Promise<CaseLite> {
  const c = await caseByRef(tx, ref);
  if (!c) throw notFound();
  return c;
}

function canRecord(subject: Parameters<typeof roleAllows>[0], c: CaseLite): Authorization {
  const v = caseVisible(subject, c);
  if (!v.allow) return v;
  return roleAllows(subject, 'budget.record', { businessUnitId: c.businessUnitId, caseId: c.id });
}

async function gateOfCase(tx: Tx, caseId: string, gateRequestId: string) {
  const gate = await tx
    .selectFrom('platform.gate_request')
    .select(['id', 'display_key', 'requested_amount', 'currency', 'gate_code', 'status'])
    .where('id', '=', gateRequestId)
    .where('case_id', '=', caseId)
    .executeTakeFirst();
  if (!gate) throw notFound();
  return gate;
}

const KIND_TEXT = { spent: 'Spend', committed: 'Commitment' } as const;
const DECIDED = ['approved', 'approved_with_conditions', 'invalidated', 'expired'];

export const budgetHandlers: HandlerMap = {
  [API.budget.recordEntry.id]: command(API.budget.recordEntry, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => canRecord(ctx.identity.subject, c),
    handle: async (ctx, t, c) => {
      const b = ctx.body;
      const { tx } = t;
      const gate = await gateOfCase(tx, c.id, b.gateRequestId);
      if (b.amount.startsWith('-'))
        throw new ApiError('VALIDATION_FAILED', 'Amounts are positive; correct an entry by reversing it.', {
          errors: [{ path: 'body.amount', code: 'custom', message: 'Must not be negative' }],
        });
      if (cents(b.amount) === 0n)
        throw new ApiError('VALIDATION_FAILED', 'Enter the amount spent or committed.', {
          errors: [{ path: 'body.amount', code: 'custom', message: 'Must be more than zero' }],
        });
      const effective = await approvalEffectiveness(tx, gate.id, ctx.now);
      if (effective !== 'effective' || !gate.requested_amount || !gate.currency)
        throw new ApiError(
          effective === 'invalidated'
            ? 'APPROVAL_INVALIDATED'
            : effective === 'expired'
              ? 'APPROVAL_EXPIRED'
              : 'PRECONDITIONS_UNMET',
          `${gate.display_key} has no effective approved budget.`,
          {
            blockers: [
              {
                key: 'approval_effective',
                message: `${gate.display_key} is not an effective approval with an amount`,
              },
            ],
          },
        );
      if (b.currency !== gate.currency)
        throw new ApiError(
          'VALIDATION_FAILED',
          `Record entries in ${gate.currency}, the currency of the approved budget.`,
          {
            errors: [{ path: 'body.currency', code: 'custom', message: `Use ${gate.currency}` }],
          },
        );
      if (b.taskId) {
        const task = await tx
          .selectFrom('platform.task')
          .select(['id', 'case_id', 'removed_at'])
          .where('id', '=', b.taskId)
          .executeTakeFirst();
        if (!task || task.case_id !== c.id || task.removed_at)
          throw new ApiError('VALIDATION_FAILED', 'Link a task of this pilot.', {
            errors: [{ path: 'body.taskId', code: 'custom', message: 'Not a task of this case' }],
          });
      }
      const rows = await budgetEntryRows(tx, gate.id);
      // The remaining approved amount: entries net of their reversals (D-133).
      const remaining = cents(gate.requested_amount) - netByKind(rows, b.kind);
      if (cents(b.amount) > remaining)
        throw new ApiError(
          'PRECONDITIONS_UNMET',
          `This would exceed the approved ${fmtMoneyShort(gate.requested_amount, gate.currency)}. Request a scope change.`,
          {
            blockers: [
              {
                key: 'budget_ceiling',
                message: `${KIND_TEXT[b.kind]} above the remaining ${fmtMoneyShort(fromCents(remaining < 0n ? 0n : remaining), gate.currency)} needs a scope-change request`,
                gate: gate.gate_code as 'G2',
                // The way forward: pilot.requestScopeChange (S11 "Request scope change").
                href: `/me/cases/${c.key}/pilot?view=scope`,
              },
            ],
          },
        );
      const row = await tx
        .insertInto('me.budget_entry')
        .values({
          tenant_id: tenantIdSql,
          case_id: c.id,
          gate_request_id: gate.id,
          kind: b.kind,
          amount: b.amount,
          currency: b.currency,
          as_of: b.asOf,
          source_text: b.sourceText.trim(),
          reference: b.reference?.trim() || null,
          task_id: b.taskId ?? null,
          recorded_by: ctx.userId,
          recorded_at: ctx.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'budget.entry_recorded',
        objectType: 'budget_entry',
        objectId: row.id,
        caseId: c.id,
        summary: `${KIND_TEXT[b.kind]} recorded against ${gate.display_key}`,
        details: {
          kind: b.kind,
          gateRequestId: gate.id,
          reference: row.reference !== null,
          taskId: row.task_id,
        },
      });
      return (await toBudgetEntries(tx, [row]))[0]!;
    },
  }),

  [API.budget.listEntries.id]: query(API.budget.listEntries, {
    load: (ctx, tx) => caseOr404(tx, ctx.params.caseRef),
    authorize: (ctx, c) => caseVisible(ctx.identity.subject, c),
    handle: async (ctx, { tx }, c) => {
      // Default: the gate that authorizes the pilot plan (G2).
      const gateId = ctx.query.gateRequestId ?? (await pilotPlanOf(tx, c.id))?.gate_request_id ?? null;
      if (!gateId) return { items: [], meter: null };
      const gate = await gateOfCase(tx, c.id, gateId);
      const items = await toBudgetEntries(tx, await budgetEntryRows(tx, gate.id));
      // A meter exists once the gate was decided (as on S11); before that there is no approved budget.
      const meter = DECIDED.includes(gate.status)
        ? await budgetMeter(tx, gate.id, asOfDate(ctx.now, ctx.identity.tenant.timeZone))
        : null;
      return { items, meter };
    },
  }),

  [API.budget.reverseEntry.id]: command(API.budget.reverseEntry, {
    load: async (ctx, tx) => {
      const e = await tx
        .selectFrom('me.budget_entry')
        .selectAll()
        .where('id', '=', ctx.params.id)
        .executeTakeFirst();
      if (!e) throw notFound();
      const c = await caseById(tx, e.case_id);
      if (!c) throw notFound();
      return { e, c };
    },
    authorize: (ctx, { c }) => canRecord(ctx.identity.subject, c),
    handle: async (ctx, t, { e, c }) => {
      const { tx } = t;
      if (e.reverses_entry_id)
        throw new ApiError(
          'INVALID_TRANSITION',
          'A reversal cannot be reversed. Record a new entry instead.',
        );
      const already = await tx
        .selectFrom('me.budget_entry')
        .select('id')
        .where('reverses_entry_id', '=', e.id)
        .executeTakeFirst();
      if (already) throw new ApiError('INVALID_TRANSITION', 'This entry is already reversed.');
      const reason = ctx.body.reason.trim();
      if (!reason)
        throw new ApiError('VALIDATION_FAILED', 'Give a reason for the correction.', {
          errors: [{ path: 'body.reason', code: 'custom', message: 'Reason required' }],
        });
      const gate = await gateOfCase(tx, c.id, e.gate_request_id);
      // Same gate, kind, amount and currency as the entry it reverses (the database guard double-checks).
      const row = await tx
        .insertInto('me.budget_entry')
        .values({
          tenant_id: tenantIdSql,
          case_id: c.id,
          gate_request_id: e.gate_request_id,
          kind: e.kind,
          amount: e.amount,
          currency: e.currency,
          as_of: asOfDate(ctx.now, ctx.identity.tenant.timeZone),
          source_text: `Reversal of ${e.source_text}`.slice(0, 500),
          reference: e.reference,
          task_id: e.task_id,
          reverses_entry_id: e.id,
          reversal_reason: reason,
          recorded_by: ctx.userId,
          recorded_at: ctx.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await t.audit({
        action: 'budget.entry_reversed',
        objectType: 'budget_entry',
        objectId: row.id,
        caseId: c.id,
        summary: `${KIND_TEXT[e.kind as 'spent']} entry reversed against ${gate.display_key} with a reason`,
        details: { kind: e.kind, gateRequestId: gate.id, reversesEntryId: e.id },
      });
      const all = await budgetEntryRows(tx, gate.id);
      return (await toBudgetEntries(tx, all)).find((x) => x.id === row.id)!;
    },
  }),
};
