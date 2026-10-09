/**
 * Shared helpers for the WS4b modules (experiments, gates, pilot, budget, outcomes, reviews, work):
 * tenant-local decision dates, people, gate policies, approval effectiveness, display formatting and
 * exact decimal comparison. Money is never summed here except the budget meter (integer cents, see
 * the WS4b notes), and recurring and one-time money never meet.
 */
import { GatePolicyBody, type GateCode, type PersonRef } from '@growth-os/contracts';
import { sql, type Tx } from '@growth-os/db';
import {
  ME_GATES,
  type ApprovalEffectiveness,
  type PolicySubject,
  type ResourceRef,
} from '@growth-os/domain';
import type { EndpointDef } from '@growth-os/contracts';
import type { Ctx } from '../../../../platform/pipeline';
import { tenantLocalIso } from '../../../../platform/materiality';
import { ApiError } from '../../../../platform/errors';
import { personRef } from '../../../../platform/serialize';

/** Tenant-local decision date (Europe/Berlin until a tenant time-zone setting exists), D-045. */
export const asOfDate = (now: Date): string => tenantLocalIso(now);

/** The caller as a PolicySubject with the decision date set (authority needs `asOf`). */
export function subjectOf(ctx: Ctx<EndpointDef>): PolicySubject {
  return { ...ctx.identity.subject, asOf: asOfDate(ctx.now) };
}

/** PersonRef for system-made records (the contract requires a person). */
export const SYSTEM_PERSON: PersonRef = {
  id: '00000000-0000-0000-0000-000000000000',
  displayName: 'System',
  title: null,
  initials: 'SY',
};

export type People = (id: string | null | undefined) => PersonRef;

/** Load PersonRefs for a set of user ids (one query). Unknown ids map to SYSTEM_PERSON. */
export async function peopleOf(tx: Tx, ids: readonly (string | null | undefined)[]): Promise<People> {
  const wanted = [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
  const rows = wanted.length
    ? await tx
        .selectFrom('platform.app_user')
        .select(['id', 'display_name', 'title', 'initials'])
        .where('id', 'in', wanted)
        .execute()
    : [];
  const map = new Map(rows.map((r) => [r.id, personRef(r)]));
  return (id) => (id ? (map.get(id) ?? SYSTEM_PERSON) : SYSTEM_PERSON);
}

/** The tenant's active gate policy (falls back to the frozen defaults). */
export async function gatePolicy(tx: Tx, gateCode: GateCode): Promise<GatePolicyBody> {
  const row = await tx
    .selectFrom('platform.policy')
    .select('body')
    .where('kind', '=', 'gate')
    .where('key', '=', gateCode)
    .where('status', '=', 'active')
    .orderBy('version', 'desc')
    .executeTakeFirst();
  return GatePolicyBody.parse(
    row?.body ?? { gateCode, preconditionKeys: [...ME_GATES[gateCode].preconditionKeys] },
  );
}

/** Whether a gate's approval still authorizes execution (approval_invalidation is an event). */
export async function approvalEffectiveness(
  tx: Tx,
  gateRequestId: string | null,
): Promise<ApprovalEffectiveness> {
  if (!gateRequestId) return 'missing';
  const gate = await tx
    .selectFrom('platform.gate_request')
    .select(['status', 'current_snapshot_id'])
    .where('id', '=', gateRequestId)
    .executeTakeFirst();
  if (!gate) return 'missing';
  if (gate.status === 'invalidated') return 'invalidated';
  if (gate.status === 'expired') return 'expired';
  if (gate.status !== 'approved' && gate.status !== 'approved_with_conditions') return 'missing';
  const approvals = await tx
    .selectFrom('platform.approval as a')
    .leftJoin('platform.approval_invalidation as i', 'i.approval_id', 'a.id')
    .select(['a.id', 'i.kind'])
    .where('a.gate_request_id', '=', gateRequestId)
    .where('a.snapshot_id', '=', gate.current_snapshot_id ?? '')
    .where('a.disposition', 'in', ['approve', 'approve_with_conditions'])
    .execute();
  if (approvals.length === 0) return 'missing';
  if (approvals.some((a) => a.kind === null)) return 'effective';
  return approvals.some((a) => a.kind === 'expired') ? 'expired' : 'invalidated';
}

/** "€120k", "€15k", "€1,250": a display label only (button labels, never arithmetic). */
export function fmtMoneyShort(amount: string, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : `${currency} `;
  const [intPart = '0', frac = ''] = amount.replace(/^-/, '').split('.');
  const neg = amount.startsWith('-') ? '−' : '';
  const n = BigInt(intPart);
  const cents = frac.replace(/0+$/, '');
  if (cents === '' && n >= 1000n && n % 1000n === 0n) return `${neg}${symbol}${(n / 1000n).toString()}k`;
  const grouped = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg}${symbol}${grouped}${cents ? `.${frac.padEnd(2, '0').slice(0, 2)}` : ''}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27 Nov" in the tenant's calendar. */
export function shortDate(at: Date | string): string {
  const iso = typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : tenantLocalIso(new Date(at));
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** Exact decimal string → scaled integer (8 fraction digits) for comparisons of thresholds. */
export function scaled(v: string): bigint {
  const neg = v.trim().startsWith('-');
  const [i = '0', f = ''] = v.trim().replace(/^-/, '').split('.');
  const n = BigInt(i) * 100_000_000n + BigInt((f + '00000000').slice(0, 8) || '0');
  return neg ? -n : n;
}

export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const x = scaled(a);
  const y = scaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isDecimal(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^-?\d{1,18}(\.\d{1,8})?$/.test(v.trim());
}

/** Integer cents of a money string (budget meter only; one-time pilot money of one gate). */
export const cents = (v: string): bigint => scaled(v) / 1_000_000n;
export const fromCents = (c: bigint): string => {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${(a / 100n).toString()}.${(a % 100n).toString().padStart(2, '0')}`;
};

/** Case facts used for scope checks and policy resources. */
export interface CaseLite {
  id: string;
  key: string;
  title: string;
  stage: string;
  heldFromStage: string | null;
  businessUnitId: string;
  ownerUserId: string;
  sponsorUserId: string;
  mandateId: string | null;
}

export async function caseById(tx: Tx, id: string): Promise<CaseLite | null> {
  const r = await tx
    .selectFrom('platform.workflow_case')
    .select([
      'id',
      'display_key',
      'title',
      'stage',
      'held_from_stage',
      'business_unit_id',
      'owner_user_id',
      'sponsor_user_id',
      'mandate_id',
    ])
    .where('id', '=', id)
    .executeTakeFirst();
  return r ? toCaseLite(r) : null;
}

export function toCaseLite(r: {
  id: string;
  display_key: string;
  title: string;
  stage: string;
  held_from_stage: string | null;
  business_unit_id: string;
  owner_user_id: string;
  sponsor_user_id: string;
  mandate_id: string | null;
}): CaseLite {
  return {
    id: r.id,
    key: r.display_key,
    title: r.title,
    stage: r.stage,
    heldFromStage: r.held_from_stage,
    businessUnitId: r.business_unit_id,
    ownerUserId: r.owner_user_id,
    sponsorUserId: r.sponsor_user_id,
    mandateId: r.mandate_id,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function caseByRef(tx: Tx, ref: string): Promise<CaseLite | null> {
  const r = await tx
    .selectFrom('platform.workflow_case')
    .select([
      'id',
      'display_key',
      'title',
      'stage',
      'held_from_stage',
      'business_unit_id',
      'owner_user_id',
      'sponsor_user_id',
      'mandate_id',
    ])
    .where(UUID.test(ref) ? 'id' : 'display_key', '=', ref)
    .executeTakeFirst();
  return r ? toCaseLite(r) : null;
}

/** Policy resource for a case. */
export function caseResource(c: CaseLite): ResourceRef {
  return {
    type: 'case',
    id: c.id,
    businessUnitId: c.businessUnitId,
    caseId: c.id,
    facts: { caseOwnerId: c.ownerUserId, sponsorId: c.sponsorUserId },
  };
}

/** Throw a machine refusal as problem+json with every failed guard as a blocker. */
export function refuse(
  r: { code: string; failed: { key: string; message?: string }[]; reasons: string[] },
  title?: string,
): never {
  throw new ApiError(r.code as never, title ?? r.reasons[0] ?? 'This action is not possible now.', {
    blockers: r.failed.map((f) => ({ key: f.key, message: f.message ?? f.key })),
  });
}

/** Current timestamp of the database transaction is not used: handlers write `ctx.now`. */
export const tenantIdSql = sql<string>`platform.current_tenant_id()`;
