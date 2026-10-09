/**
 * Budget entries (S11 budget meter, ME-14): manual committed/spent entries against an approved gate
 * budget. Entries are append-only. Spend or commitments above the approved amount are refused: a
 * bigger budget needs a scope change and a new authorization. Only the gate's own currency is accepted
 * (no conversion), and pilot budget money never mixes with recurring money.
 */
import { API } from '@growth-os/contracts';
import { caseVisible, roleAllows } from '../../../platform/authz';
import { ApiError, notFound } from '../../../platform/errors';
import { command, type HandlerMap } from '../../../platform/pipeline';
import { isoDate } from '../../../platform/serialize';
import {
  approvalEffectiveness,
  caseByRef,
  cents,
  fmtMoneyShort,
  peopleOf,
  tenantIdSql,
} from '../gates/lib/common';

export const budgetHandlers: HandlerMap = {
  [API.budget.recordEntry.id]: command(API.budget.recordEntry, {
    load: async (ctx, tx) => {
      const c = await caseByRef(tx, ctx.params.caseRef);
      if (!c) throw notFound();
      return c;
    },
    authorize: (ctx, c) => {
      const v = caseVisible(ctx.identity.subject, c);
      if (!v.allow) return v;
      return roleAllows(ctx.identity.subject, 'budget.record', {
        businessUnitId: c.businessUnitId,
        caseId: c.id,
      });
    },
    handle: async (ctx, t, c) => {
      const b = ctx.body;
      const gate = await t.tx
        .selectFrom('platform.gate_request')
        .select(['id', 'display_key', 'requested_amount', 'currency', 'gate_code'])
        .where('id', '=', b.gateRequestId)
        .where('case_id', '=', c.id)
        .executeTakeFirst();
      if (!gate) throw notFound();
      if (b.amount.startsWith('-'))
        throw new ApiError('VALIDATION_FAILED', 'Amounts are positive; record a correction as a new entry.', {
          errors: [{ path: 'body.amount', code: 'custom', message: 'Must not be negative' }],
        });
      const effective = await approvalEffectiveness(t.tx, gate.id);
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
      const entries = await t.tx
        .selectFrom('me.budget_entry')
        .select(['amount'])
        .where('gate_request_id', '=', gate.id)
        .where('kind', '=', b.kind)
        .execute();
      const total = entries.reduce((a, e) => a + cents(e.amount), 0n) + cents(b.amount);
      if (total > cents(gate.requested_amount))
        throw new ApiError(
          'PRECONDITIONS_UNMET',
          `This would exceed the approved ${fmtMoneyShort(gate.requested_amount, gate.currency)}. Request a scope change.`,
          {
            blockers: [
              {
                key: 'budget_ceiling',
                message: `${b.kind === 'spent' ? 'Spend' : 'Commitments'} above the approved budget need a scope-change request`,
                gate: gate.gate_code as 'G2',
              },
            ],
          },
        );
      const row = await t.tx
        .insertInto('me.budget_entry')
        .values({
          tenant_id: tenantIdSql,
          case_id: c.id,
          gate_request_id: gate.id,
          kind: b.kind,
          amount: b.amount,
          currency: b.currency,
          as_of: b.asOf,
          source_text: b.sourceText,
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
        summary: `${b.kind === 'spent' ? 'Spend' : 'Commitment'} recorded against ${gate.display_key}`,
        details: { kind: b.kind, gateRequestId: gate.id },
      });
      const people = await peopleOf(t.tx, [ctx.userId]);
      return {
        id: row.id,
        gateRequestId: gate.id,
        kind: b.kind,
        amount: row.amount,
        currency: row.currency,
        asOf: isoDate(row.as_of as unknown as string),
        sourceText: row.source_text,
        recordedBy: people(ctx.userId),
      };
    },
  }),
};
