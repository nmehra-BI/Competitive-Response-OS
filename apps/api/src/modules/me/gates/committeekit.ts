/**
 * Test support for the committee suites (imported only by *.db.test.ts files): a G3 request awaiting
 * a decision on ME-104 (aster-demo), test grants for the committee members, and a Base adoption change
 * that makes the current snapshot stale. Aster seeds NO G3 grant (D-109 §5); the tests grant one.
 */
import { randomUUID } from 'node:crypto';
import { API, SnapshotContent } from '@growth-os/contracts';
import { gates, outcomeReview } from '@growth-os/fixtures-aster';
import { sql } from '@growth-os/db';
import { freezeSnapshot, nextSnapshotVersion } from '@growth-os/domain';
import { applyMateriality } from '../../../platform/materiality';
import { systemTools } from '../../../platform/pipeline';
import { call, login, type SeededTenant, type TestApp } from '../../../platform/testing';
import { activatePilot, currentPackage, ids, inTenant, setStage } from './testkit';

export type Persona =
  'maya' | 'elena' | 'daniel' | 'jonas' | 'priya' | 'lena' | 'admin' | 'opsLead' | 'katrin' | 'thomas';

export async function cookiesFor(t: TestApp, s: SeededTenant, who: readonly Persona[]) {
  const out = {} as Record<Persona, string>;
  for (const p of who) out[p] = await login(t.app, s.user(p));
  return out;
}

/** A test grant (the fixture has none for G3): gate × BU Water × ceiling, entered by the admin. */
export async function grant(
  t: TestApp,
  s: SeededTenant,
  who: Persona,
  gateCode: 'G1' | 'G2' | 'G3' | 'X',
  ceiling: string,
) {
  await inTenant(t, s, async (tx) => {
    const bu = await tx
      .selectFrom('platform.gate_request')
      .select('business_unit_id')
      .where('id', '=', ids(s).g2)
      .executeTakeFirstOrThrow();
    await tx
      .insertInto('platform.authority_grant')
      .values({
        tenant_id: s.tenantId,
        user_id: s.user(who),
        gate_code: gateCode,
        business_unit_id: bu.business_unit_id,
        ceiling_amount: ceiling,
        currency: 'EUR',
        valid_from: '2026-01-01',
        granted_by: s.user('admin'),
        doa_reference: 'DoA-TEST · committee test grant',
      })
      .execute();
  });
}

/**
 * ME-104-G3 awaiting a decision for €400k one-time, with a hashed snapshot authored by Maya. G3 cannot be
 * requested through the API while its preconditions are unmet (D-039), so the test writes the request
 * the way `gates.submit` would after they are met.
 */
export async function g3Awaiting(t: TestApp, s: SeededTenant): Promise<string> {
  const elena = await login(t.app, s.user('elena'));
  const g2 = await currentPackage(t, elena, ids(s).g2);
  const maya = s.user('maya');
  return inTenant(t, s, async (tx) => {
    const g = await tx
      .selectFrom('platform.gate_request')
      .select('business_unit_id')
      .where('id', '=', ids(s).g2)
      .executeTakeFirstOrThrow();
    const scope = {
      ...g2.snapshot.content.scope,
      amount: '400000.00',
      currency: 'EUR',
      durationDays: null,
      authorizes: ['Scale entry in BU Water up to €400k one-time'],
      doesNotAuthorize: ['Not other business units'],
    };
    const gateId = randomUUID();
    await tx
      .insertInto('platform.gate_request')
      .values({
        id: gateId,
        tenant_id: s.tenantId,
        display_key: 'ME-104-G3',
        case_id: ids(s).case,
        subject_type: 'case',
        subject_id: ids(s).case,
        business_unit_id: g.business_unit_id,
        gate_code: 'G3',
        status: 'awaiting_decision',
        scope: JSON.stringify({ ...scope, proposedConditions: [] }),
        requested_amount: '400000.00',
        currency: 'EUR',
        submitted_by: maya,
        submitted_at: new Date(),
        created_by: maya,
      })
      .execute();
    const { stopRules: _rules, ...rest } = g2.snapshot.content;
    const content = SnapshotContent.parse({
      ...rest,
      gateCode: 'G3',
      ask: 'Authorize scale entry in BU Water up to €400k one-time.',
      scope,
      conditionsProposed: [],
    });
    const versions = await tx
      .selectFrom('platform.decision_snapshot')
      .select('version')
      .where('subject_id', '=', ids(s).case)
      .execute();
    const frozen = await freezeSnapshot(content, nextSnapshotVersion(versions.map((v) => v.version)));
    const snapId = randomUUID();
    await tx
      .insertInto('platform.decision_snapshot')
      .values({
        id: snapId,
        tenant_id: s.tenantId,
        gate_request_id: gateId,
        case_id: ids(s).case,
        version: frozen.version,
        subject_id: ids(s).case,
        content_canonical: frozen.canonical,
        content_hash: frozen.hash,
        created_by: maya,
      })
      .execute();
    await tx
      .updateTable('platform.gate_request')
      .set({ current_snapshot_id: snapId })
      .where('id', '=', gateId)
      .execute();
    await tx
      .updateTable('platform.workflow_case')
      .set({ stage: 'scale_approval_pending' })
      .where('id', '=', ids(s).case)
      .execute();
    return gateId;
  });
}

/** Simulates WS4a `assumptions.update`: a new Base adoption version + materiality in one transaction. */
export async function changeBaseAdoption(t: TestApp, s: SeededTenant, value: string) {
  return inTenant(t, s, async (tx) => {
    const asm = await tx
      .selectFrom('platform.assumption as x')
      .innerJoin('platform.assumption_version as v', 'v.id', 'x.current_version_id')
      .select(['x.id', 'x.current_version_id', 'v.version', 'v.unit', 'v.basis', 'x.owner_user_id'])
      .where('x.display_key', '=', 'ASM-01')
      .executeTakeFirstOrThrow();
    const nv = await tx
      .insertInto('platform.assumption_version')
      .values({
        tenant_id: s.tenantId,
        assumption_id: asm.id,
        version: asm.version + 1,
        value,
        unit: asm.unit,
        basis: asm.basis,
        evidence_quality: 'some',
        origin: 'human',
        change_reason: 'Re-estimated after interviews',
        created_by: asm.owner_user_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx
      .updateTable('platform.assumption')
      .set({ current_version_id: nv.id })
      .where('id', '=', asm.id)
      .execute();
    const now = new Date();
    return applyMateriality(
      systemTools(tx, { tenantId: s.tenantId, correlationId: 'test-assumption', now, rule: 'test' }),
      {
        changeType: 'decision_critical_assumption_changed',
        objectType: 'assumption',
        objectId: asm.current_version_id!,
        componentType: 'assumption_version',
        fromVersion: asm.version,
        toVersion: asm.version + 1,
        decisionCritical: true,
        label: 'adoption assumption',
      },
      { now, actorUserId: asm.owner_user_id },
    );
  });
}

/** Status and expiry of a gate request, read as the database holds them. */
export async function gateRow(t: TestApp, s: SeededTenant, id: string) {
  return inTenant(t, s, async (tx) => {
    const r = await sql<{ status: string; expires_at: Date | null; decided_at: Date | null }>`
      SELECT status, expires_at, decided_at FROM platform.gate_request WHERE id = ${id}`.execute(tx);
    return r.rows[0]!;
  });
}

/**
 * aster-demo up to step 27: G2 approved, pilot activated, review due, Maya's "Revise and extend"
 * recommendation with causal limitations, Elena's decision. An X request is then allowed.
 */
export async function extendDecided(t: TestApp, s: SeededTenant): Promise<void> {
  await activatePilot(t, s);
  const maya = await login(t.app, s.user('maya'));
  const elena = await login(t.app, s.user('elena'));
  const r = API.outcomes.get.response.parse(
    (await call(t.app, API.outcomes.get, { params: { caseRef: 'ME-104' }, cookie: maya })).json(),
  );
  const saved = await call(t.app, API.outcomes.saveReviewDraft, {
    params: { caseRef: 'ME-104' },
    body: {
      causalLimitations: [...outcomeReview.causalLimitations],
      recommendation: { outcome: 'extend', text: outcomeReview.recommendation.text },
    },
    cookie: maya,
    ifMatch: r.rowVersion,
  });
  if (saved.statusCode !== 200) throw new Error(`review ${saved.statusCode} ${saved.body}`);
  await setStage(t, s, 'ME-104', 'review_due');
  const d = await call(t.app, API.outcomes.decide, {
    params: { caseRef: 'ME-104' },
    body: {
      outcome: 'extend',
      label: outcomeReview.decision.label,
      rationale: outcomeReview.decision.rationale,
    },
    cookie: elena,
    idempotencyKey: true,
  });
  if (d.statusCode !== 201) throw new Error(`decide ${d.statusCode} ${d.body}`);
}

/** The X1 request body at the decided €30k · 45 days (D-110 §2), with overrides. */
export function x1Body(s: SeededTenant, over: Record<string, unknown> = {}) {
  return {
    parentGateRequestId: ids(s).g2,
    spendCap: gates.x1.amount,
    currency: 'EUR',
    durationDays: gates.x1.durationDays,
    ownerId: s.user('jonas'),
    scopeItems: [...gates.x1.authorizes],
    windowStart: gates.x1.windowStart,
    windowEnd: gates.x1.windowEnd,
    maxSites: gates.x1.maxSites,
    ...over,
  };
}
