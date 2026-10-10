/**
 * S14 › Investment committee (D-109 §3, D-124). Administrators name who holds the chair, finance and
 * operations seats of each business unit, from the Finance-signed delegation-of-authority document.
 * Membership is NOT authority: a member decides a gate only with a valid grant for it.
 *
 * Invariants (never-rules 1 and 6): only people hold a seat; an administrator never seats themselves and
 * never seats another tenant administrator; one live holder per seat per business unit; a revocation
 * keeps the row (audit and past seat decisions stay readable).
 */
import { API, COMMITTEE_SEAT_LABELS, type CommitteeMember, type CommitteeSeat } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { roleAllows } from '../../../platform/authz';
import { ApiError, forbidden } from '../../../platform/errors';
import { command, query, type HandlerMap } from '../../../platform/pipeline';
import { isoDate, isoDateTimeOrNull, personRef } from '../../../platform/serialize';

const SEATS: readonly CommitteeSeat[] = ['chair', 'finance', 'operations'];

const invalid = (path: string, message: string) =>
  new ApiError('VALIDATION_FAILED', 'Request validation failed', {
    errors: [{ path, code: 'invalid', message }],
  });

type MemberRow = {
  id: string;
  user_id: string;
  business_unit_id: string;
  seat: string;
  valid_from: Date | string;
  valid_to: Date | string | null;
  doa_reference: string | null;
  entered_by: string;
  revoked_at: Date | null;
};

async function toMembers(tx: Tx, rows: readonly MemberRow[]): Promise<CommitteeMember[]> {
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const users = ids.length
    ? await tx
        .selectFrom('platform.app_user')
        .select(['id', 'display_name', 'title', 'initials'])
        .where('id', 'in', ids)
        .execute()
    : [];
  const people = new Map(users.map((u) => [u.id, personRef(u)]));
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    person: people.get(r.user_id) ?? {
      id: r.user_id,
      displayName: 'Unknown person',
      title: null,
      initials: '?',
    },
    businessUnitId: r.business_unit_id,
    seat: r.seat as CommitteeSeat,
    validFrom: isoDate(r.valid_from),
    validTo: r.valid_to === null ? null : isoDate(r.valid_to),
    doaReference: r.doa_reference,
    enteredBy: r.entered_by,
    revokedAt: isoDateTimeOrNull(r.revoked_at),
  }));
}

/** Live on `today`: not revoked and inside its validity. */
const live = (m: CommitteeMember, today: string) =>
  m.revokedAt === null && m.validFrom <= today && (m.validTo === null || m.validTo >= today);

export const committeeHandlers: HandlerMap = {
  [API.admin.committee.id]: query(API.admin.committee, {
    authorize: (ctx) => roleAllows(ctx.identity.subject, 'admin.configure'),
    handle: async (ctx, { tx }) => {
      const rows = (await tx
        .selectFrom('platform.committee_member')
        .selectAll()
        .orderBy('created_at')
        .orderBy('id')
        .execute()) as MemberRow[];
      const items = await toMembers(tx, rows);
      const bus = await tx
        .selectFrom('platform.business_unit')
        .select(['id', 'name'])
        .orderBy('key')
        .execute();
      const today = ctx.now.toISOString().slice(0, 10);
      const g3 = await tx
        .selectFrom('platform.authority_grant')
        .select(['user_id', 'business_unit_id', 'valid_from', 'valid_to'])
        .where('gate_code', '=', 'G3')
        .where('revoked_at', 'is', null)
        .execute();
      const gaps: { businessUnitId: string; seat: CommitteeSeat | null; message: string }[] = [];
      for (const bu of bus) {
        const seated = items.filter((m) => m.businessUnitId === bu.id && live(m, today));
        if (seated.length === 0) continue; // no committee named for this BU (the authority matrix shows it)
        for (const seat of SEATS)
          if (!seated.some((m) => m.seat === seat))
            gaps.push({
              businessUnitId: bu.id,
              seat,
              message: `No ${COMMITTEE_SEAT_LABELS[seat].toLowerCase()} named in ${bu.name}`,
            });
        // D-109 §5: the committee is named, but nobody on it holds G3 authority (the authority gap stays).
        const granted = seated.some((m) =>
          g3.some(
            (g) =>
              g.user_id === m.userId &&
              g.business_unit_id === bu.id &&
              isoDate(g.valid_from) <= today &&
              (g.valid_to === null || isoDate(g.valid_to) >= today),
          ),
        );
        if (!granted)
          gaps.push({
            businessUnitId: bu.id,
            seat: null,
            message: 'Committee named · G3 authority not granted',
          });
      }
      return { items, gaps };
    },
  }),

  [API.admin.setCommitteeMember.id]: command(API.admin.setCommitteeMember, {
    authorize: (ctx) => roleAllows(ctx.identity.subject, 'admin.configure'),
    handle: async (ctx, t) => {
      const b = ctx.body;
      if (b.userId === ctx.userId) throw forbidden('Administrators cannot seat themselves on the committee.');
      const u = await t.tx
        .selectFrom('platform.app_user')
        .select(['kind'])
        .where('id', '=', b.userId)
        .executeTakeFirst();
      if (!u) throw invalid('body.userId', 'Unknown user');
      if (u.kind !== 'human')
        throw new ApiError('AGENT_IDENTITY_FORBIDDEN', 'Only people hold a committee seat.');
      const bu = await t.tx
        .selectFrom('platform.business_unit')
        .select(['id', 'name'])
        .where('id', '=', b.businessUnitId)
        .executeTakeFirst();
      if (!bu) throw invalid('body.businessUnitId', 'Unknown business unit');
      if (b.validTo !== null && b.validTo < b.validFrom)
        throw invalid('body.validTo', 'Valid to must be on or after valid from');
      const existing = (await t.tx
        .selectFrom('platform.committee_member')
        .selectAll()
        .where('id', '=', ctx.params.id)
        .executeTakeFirst()) as MemberRow | undefined;
      if (existing && existing.user_id !== b.userId)
        throw invalid(
          'body.userId',
          'A seat cannot move to another person; revoke it and name the new holder',
        );
      if (existing?.revoked_at && !b.revoked)
        throw new ApiError('INVALID_TRANSITION', 'A revoked seat stays revoked. Name the holder again.');
      if (!b.revoked) {
        const admin = await t.tx
          .selectFrom('platform.role_assignment')
          .select('id')
          .where('user_id', '=', b.userId)
          .where('role', '=', 'tenant_admin')
          .where('revoked_at', 'is', null)
          .executeTakeFirst();
        if (admin)
          throw forbidden(
            'Tenant administrators configure but never approve: they cannot hold a committee seat.',
          );
        if (!b.doaReference?.trim() && !existing?.doa_reference)
          throw invalid(
            'body.doaReference',
            'Enter the delegation-of-authority reference the seat comes from',
          );
        let q = t.tx
          .selectFrom('platform.committee_member')
          .select('id')
          .where('business_unit_id', '=', b.businessUnitId)
          .where('seat', '=', b.seat)
          .where('revoked_at', 'is', null);
        if (existing) q = q.where('id', '<>', existing.id);
        if (await q.executeTakeFirst())
          throw new ApiError(
            'INVALID_TRANSITION',
            `The ${COMMITTEE_SEAT_LABELS[b.seat].toLowerCase()} in ${bu.name} already has a holder. Revoke it first.`,
          );
      }
      const values = {
        business_unit_id: b.businessUnitId,
        seat: b.seat,
        valid_from: b.validFrom,
        valid_to: b.validTo,
        doa_reference: b.doaReference?.trim() || existing?.doa_reference || null,
        revoked_at: b.revoked ? (existing?.revoked_at ?? ctx.now) : null,
      };
      const row = (
        existing
          ? await t.tx
              .updateTable('platform.committee_member')
              .set(values)
              .where('id', '=', ctx.params.id)
              .returningAll()
              .executeTakeFirstOrThrow()
          : await t.tx
              .insertInto('platform.committee_member')
              .values({
                id: ctx.params.id,
                tenant_id: ctx.tenantId,
                user_id: b.userId,
                entered_by: ctx.userId,
                created_at: ctx.now,
                ...values,
              })
              .returningAll()
              .executeTakeFirstOrThrow()
      ) as MemberRow;
      const [before] = existing ? await toMembers(t.tx, [existing]) : [];
      const [after] = await toMembers(t.tx, [row]);
      await t.audit({
        action: b.revoked
          ? 'admin.committee_member_revoked'
          : existing
            ? 'admin.committee_member_changed'
            : 'admin.committee_member_named',
        objectType: 'committee_member',
        objectId: row.id,
        summary: `${b.revoked ? 'Revoked' : 'Named'} ${COMMITTEE_SEAT_LABELS[b.seat].toLowerCase()} · ${bu.name}`,
        details: {
          userId: b.userId,
          seat: b.seat,
          businessUnitId: b.businessUnitId,
          doaReference: values.doa_reference,
        },
        before,
        after,
      });
      return after!;
    },
  }),
};
