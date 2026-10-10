/**
 * Loading a gate request with its subject (case or standalone mandate) and deciding visibility.
 * Hidden subjects are 404 (never 403). Tenant administrators may reach a gate decision only to be
 * refused with FORBIDDEN by the policy engine (they never approve; S14 "Admin cannot approve").
 */
import type { Tx } from '@growth-os/db';
import type { PolicySubject } from '@growth-os/domain';
import type { Authorization } from '../../../../platform/context';
import { canReadCase, matchingRole, roleAllows, type Scope } from '../../../../platform/authz';
import { notFound } from '../../../../platform/errors';
import type { Action } from '@growth-os/domain';
import { caseById, type CaseLite } from './common';
import { gateById, type GateRow } from './serialize';

export interface GateCtx {
  gate: GateRow;
  caseRow: CaseLite | null;
  /** Owner and sponsor of the subject (case, or the mandate's current version for G0). */
  ownerId: string | null;
  sponsorId: string | null;
}

export async function loadGateCtx(tx: Tx, gateId: string): Promise<GateCtx> {
  const gate = await gateById(tx, gateId);
  if (!gate) throw notFound();
  if (gate.case_id) {
    const caseRow = await caseById(tx, gate.case_id);
    if (!caseRow) throw notFound();
    return { gate, caseRow, ownerId: caseRow.ownerUserId, sponsorId: caseRow.sponsorUserId };
  }
  const m = await tx
    .selectFrom('me.mandate as m')
    .leftJoin('me.mandate_version as v', (j) =>
      j.on((eb) => eb('v.id', '=', eb.fn.coalesce('m.current_version_id', 'm.draft_version_id'))),
    )
    .select(['v.owner_user_id', 'v.sponsor_user_id', 'm.created_by'])
    .where('m.id', '=', gate.subject_id)
    .executeTakeFirst();
  return {
    gate,
    caseRow: null,
    ownerId: m?.owner_user_id ?? m?.created_by ?? null,
    sponsorId: m?.sponsor_user_id ?? null,
  };
}

export function scopeOfGate(g: GateCtx): Scope {
  return { businessUnitId: g.gate.business_unit_id, caseId: g.gate.case_id };
}

export function canSee(subject: PolicySubject, g: GateCtx): boolean {
  return canReadCase(subject, {
    id: g.gate.case_id ?? g.gate.subject_id,
    businessUnitId: g.gate.business_unit_id,
    ownerUserId: g.ownerId ?? '',
    sponsorUserId: g.sponsorId ?? '',
  });
}

const HIDDEN: Authorization = { allow: false, rule: 'case.read', code: 'NOT_FOUND', reason: 'Not found' };

export function gateVisible(subject: PolicySubject, g: GateCtx, rule = 'case.read'): Authorization {
  if (!canSee(subject, g)) return HIDDEN;
  return {
    allow: true,
    rule,
    authorityGrantId: null,
    role: matchingRole(subject, 'case.read', scopeOfGate(g)),
  };
}

export function holdsAdmin(subject: PolicySubject): boolean {
  return subject.roles.some((r) => r.role === 'tenant_admin' && r.revokedAt === null);
}

/** Visible + role action, with hidden subjects as 404. */
export function gateAction(subject: PolicySubject, g: GateCtx, action: Action): Authorization {
  if (!canSee(subject, g)) return HIDDEN;
  return roleAllows(subject, action, scopeOfGate(g));
}
