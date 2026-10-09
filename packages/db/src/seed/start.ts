/**
 * Profile `aster-start` — the PRD §15 journey start (BUILD_PLAN §7): tenant (illustrative), business
 * units, products, segments, people, roles, authority, policies, licences, entitlements, sources,
 * connections and mappings, approved mandate MD-21 with its G0 history, detected opportunities and
 * the other BU Water cases shown on S01. ME-104 does not exist yet: the journey creates it (step 5).
 */
import {
  GatePolicyBody,
  MaterialityPolicyBody,
  RunBudgetPolicyBody,
  type SnapshotContent,
} from '@growth-os/contracts';
import {
  authorityGrants,
  businessUnits,
  fid,
  cases,
  connections,
  connectorMappings,
  gatePolicies,
  gates,
  journeyMoments,
  licenses,
  mandate,
  materialityRules,
  opportunities,
  people,
  products,
  roleAssignments,
  segments,
  sourceEntitlements,
  sources,
  tenant,
} from '@growth-os/fixtures-aster';
import { at, seedAudit, sha256, type SeedCtx } from './context';
import { decide, insertSnapshot, setGateStatus, setSnapshotStatus } from './gates';

export const ORG_SINCE = '2026-01-01T08:00:00+01:00';

const U = people;
const BU_WATER = businessUnits[0].id;

export function sourceId(s: SeedCtx, key: string): string {
  const src = sources.find((x) => x.key === key);
  if (!src) throw new Error(`seed: unknown source ${key}`);
  return s.R.id(src.id);
}

export function opportunityId(s: SeedCtx, key: string): string {
  const o = opportunities.find((x) => x.key === key);
  if (!o) throw new Error(`seed: unknown opportunity ${key}`);
  return s.R.id(o.id);
}

async function seedOrg(s: SeedCtx): Promise<void> {
  const { tx, R, tenantId } = s;
  await tx
    .insertInto('platform.tenant')
    .values({
      id: tenantId,
      slug: R.tag ? `${tenant.slug}-${R.tag}` : tenant.slug,
      name: tenant.name,
      data_residency: tenant.dataResidency,
      illustrative: true,
      created_at: at(ORG_SINCE),
    })
    .execute();
  for (const bu of businessUnits)
    await tx
      .insertInto('platform.business_unit')
      .values({ id: R.id(bu.id), tenant_id: tenantId, key: bu.key, name: bu.name })
      .execute();
  for (const p of products)
    await tx
      .insertInto('platform.product')
      .values({ id: R.id(p.id), tenant_id: tenantId, key: p.key, name: p.name, description: p.description })
      .execute();
  for (const g of segments)
    await tx
      .insertInto('platform.segment')
      .values({ id: R.id(g.id), tenant_id: tenantId, key: g.key, name: g.name })
      .execute();

  // Users in fixture order; created_at ascending keeps the persona picker order (Elena … Lena, admin).
  const base = at(ORG_SINCE).getTime();
  for (const [i, p] of Object.values(people).entries())
    await tx
      .insertInto('platform.app_user')
      .values({
        id: R.id(p.id),
        tenant_id: tenantId,
        email: p.email,
        display_name: p.displayName,
        title: p.title,
        initials: p.initials,
        kind: p.kind,
        created_at: new Date(base + i * 60_000),
      })
      .execute();

  const admin = R.id(U.admin.id);
  for (const r of roleAssignments)
    await tx
      .insertInto('platform.role_assignment')
      .values({
        id: R.id(r.id),
        tenant_id: tenantId,
        user_id: R.id(r.userId),
        role: r.role,
        business_unit_id: r.businessUnitId ? R.id(r.businessUnitId) : null,
        granted_by: admin,
        granted_at: at(ORG_SINCE),
      })
      .execute();
  for (const g of authorityGrants)
    await tx
      .insertInto('platform.authority_grant')
      .values({
        id: R.id(g.id),
        tenant_id: tenantId,
        user_id: R.id(g.userId),
        gate_code: g.gateCode,
        business_unit_id: R.id(g.businessUnitId),
        ceiling_amount: g.ceilingAmount,
        currency: g.currency,
        valid_from: g.validFrom,
        granted_by: admin,
        created_at: at(ORG_SINCE),
      })
      .execute();

  // Policies (S14). Bodies are validated with the frozen kind-specific schemas.
  const policies: { kind: string; key: string; body: unknown }[] = [
    ...gatePolicies.map((g) => ({ kind: 'gate', key: g.gateCode, body: GatePolicyBody.parse(g) })),
    {
      kind: 'materiality',
      key: 'default',
      body: MaterialityPolicyBody.parse({ rules: materialityRules, escalateTo: 'sponsor' }),
    },
    { kind: 'approval_expiry', key: 'default', body: { days: 14 } },
    {
      kind: 'retention',
      key: 'default',
      body: {
        approvalHistoryYears: null,
        note: 'Customer policy placeholder: the PRD sets no retention period.',
      },
    },
    {
      kind: 'run_budget',
      key: 'default',
      // Token and cost caps are placeholders (tenant policy); wall time and tool calls follow PRD §13.
      body: RunBudgetPolicyBody.parse({
        perRunWallTimeMs: 300_000,
        perRunMaxToolCalls: 40,
        perRunMaxInputTokens: 200_000,
        perRunMaxOutputTokens: 20_000,
        perCaseMonthlyCostMicros: 50_000_000,
        tenantConcurrentRuns: 4,
      }),
    },
    { kind: 'self_approval', key: 'default', body: { allowed: false } },
  ];
  for (const p of policies)
    await tx
      .insertInto('platform.policy')
      .values({
        tenant_id: tenantId,
        kind: p.kind,
        key: p.key,
        version: 1,
        status: 'active',
        body: JSON.stringify(p.body),
        created_by: admin,
        created_at: at(ORG_SINCE),
      })
      .execute();

  for (const l of licenses)
    await tx
      .insertInto('platform.license')
      .values({
        id: R.id(l.id),
        tenant_id: tenantId,
        key: l.key,
        name: l.name,
        boundary_text: l.boundaryText,
        max_excerpt_sentences: l.maxExcerptSentences,
        allow_model_context: l.allowModelContext,
        allow_embeddings: l.allowEmbeddings,
        allow_export: l.allowExport,
      })
      .execute();
  for (const e of sourceEntitlements)
    await tx
      .insertInto('platform.source_entitlement')
      .values({
        tenant_id: tenantId,
        license_id: R.id(e.licenseId),
        principal_type: e.principalType,
        principal: e.principalType === 'user' ? R.id(e.principal) : e.principal,
        access: e.access,
      })
      .execute();

  for (const c of connections)
    await tx
      .insertInto('platform.connection')
      .values({
        id: R.id(c.id),
        tenant_id: tenantId,
        kind: c.kind,
        provider: c.provider,
        name: c.name,
        scope_text: c.scopeText,
        used_for: c.usedFor,
        status: c.status,
        last_success_at: c.lastSuccessAt ? at(c.lastSuccessAt) : null,
        last_checked_at: c.lastSuccessAt ? at(c.lastSuccessAt) : null,
        created_by: admin,
        created_at: at(ORG_SINCE),
      })
      .execute();
  // Assignee map: directory email for each human the pilot and validation tasks name.
  const assignees = Object.fromEntries(
    [U.maya, U.jonas, U.priya, U.opsLead, U.daniel].map((p) => [R.id(p.id), p.email]),
  );
  for (const m of connectorMappings)
    await tx
      .insertInto('platform.connector_mapping')
      .values({
        tenant_id: tenantId,
        connection_id: R.id(m.connectionId),
        purpose: m.purpose,
        destination_project: m.destinationProject,
        issue_type: m.issueType,
        assignee_map: JSON.stringify(assignees),
      })
      .execute();

  await seedAudit(s, {
    action: 'seed.workspace_loaded',
    objectType: 'tenant',
    objectId: tenantId,
    summary: 'Illustrative Aster workspace loaded: people, roles, authority, policies, licences, connections',
    occurredAt: ORG_SINCE,
  });
}

async function seedSources(s: SeedCtx): Promise<void> {
  const { tx, R, tenantId } = s;
  // SRC-014 before SRC-009 (SRC-009 is superseded by it).
  const ordered = [...sources].sort((a, b) => (a.key === 'SRC-014' ? -1 : b.key === 'SRC-014' ? 1 : 0));
  for (const src of ordered) {
    const extra = src as Partial<{ supersededBy: string; deletedAt: string }>;
    await tx
      .insertInto('platform.source')
      .values({
        id: R.id(src.id),
        tenant_id: tenantId,
        display_key: src.key,
        title: src.title,
        publisher: src.publisher,
        origin_kind: src.originKind,
        origin_text: src.originText,
        published_on: src.publishedOn,
        retrieved_at: src.retrievedAt ? at(src.retrievedAt) : null,
        license_id: R.id(src.licenseId),
        ingestion_status: src.availability === 'deleted_by_provider' ? 'ingested' : 'ingested',
        availability: src.availability,
        freshness: src.freshness,
        superseded_by_source_id: extra.supersededBy ? sourceId(s, extra.supersededBy) : null,
        deleted_at: extra.deletedAt ? at(extra.deletedAt) : null,
        created_by: R.id(U.maya.id),
        created_at: at(src.retrievedAt ?? journeyMoments.opportunitiesDetected),
      })
      .execute();
    for (const p of src.passages)
      await tx
        .insertInto('platform.evidence_passage')
        .values({
          id: R.id(p.id),
          tenant_id: tenantId,
          source_id: R.id(src.id),
          locator: p.locator,
          excerpt: p.excerpt,
          excerpt_sha256: sha256(p.excerpt),
        })
        .execute();
  }
  await seedAudit(s, {
    action: 'seed.sources_loaded',
    objectType: 'tenant',
    objectId: tenantId,
    summary: `Illustrative sources loaded: ${sources.map((x) => x.key).join(', ')}`,
    occurredAt: journeyMoments.opportunitiesDetected,
  });
}

function mandateVersionFields(s: SeedCtx, withOutreachExclusion: boolean) {
  const v2 = mandate.versions[1];
  return {
    objective: v2.objective,
    product_id: s.R.id(v2.productId),
    segment_ids: v2.segmentIds.map((x) => s.R.id(x)),
    geography_codes: [...v2.geographyCodes],
    exclusions: withOutreachExclusion
      ? [...v2.exclusions]
      : v2.exclusions.filter((e) => e !== 'No prospect outreach before G1'),
    horizon_years: v2.horizonYears,
    pilot_duration_days: v2.pilotDurationDays,
    investment_ceiling: v2.investmentCeiling,
    currency: v2.currency,
    evidence_source_kinds: [...v2.evidenceSourceKinds],
    owner_user_id: s.R.id(v2.ownerId),
    sponsor_user_id: s.R.id(v2.sponsorId),
    success_definition: v2.successDefinition,
  };
}

function g0Content(s: SeedCtx, versionId: string, version: number): SnapshotContent {
  const v2 = mandate.versions[1];
  return {
    schemaVersion: 1,
    // A standalone G0 has no case yet: the mandate is the subject (gate_request.subject_type = 'mandate').
    caseId: s.R.id(mandate.id),
    caseKey: mandate.key,
    subject: { type: 'mandate', id: s.R.id(mandate.id), key: mandate.key }, // D-036
    gateCode: 'G0',
    ask: `Approve the mandate scope: ${v2.objective}`,
    scope: {
      amount: null,
      currency: v2.currency,
      durationDays: null,
      windowStart: null,
      windowEnd: null,
      countryCodes: [...v2.geographyCodes],
      segmentLabel: 'Food processing',
      maxSites: null,
      milestones: [],
      ownerId: s.R.id(v2.ownerId),
      authorizes: [...gates.g0.authorizes],
      doesNotAuthorize: [...gates.g0.doesNotAuthorize],
    },
    recommendation: 'Approve the bounded mandate scope.',
    alternatives: [{ name: 'No entry.', meaning: 'Do not search this segment.', isNoEntry: true }],
    evidenceSummary: [],
    assumptions: [],
    validationResults: [],
    economics: null,
    sizing: null,
    signOffs: [],
    budgetAndStopRules: ['No spend: validation (G1) and pilot (G2) are separate gates'],
    conditionsProposed: [],
    dissent: [],
    knownLimitations: [],
    blockers: [],
    outcomeTargets: [],
    components: [{ type: 'mandate_version', id: versionId, version }],
  };
}

async function seedMandate(s: SeedCtx): Promise<void> {
  const { tx, R, tenantId } = s;
  const maya = R.id(U.maya.id);
  const elena = R.id(U.elena.id);
  const mandateId = R.id(mandate.id);
  const [v1, v2] = mandate.versions;
  const v1Id = R.id(v1.id);
  const v2Id = R.id(v2.id);
  const g0Id = R.id(gates.g0.id);

  await tx
    .insertInto('me.mandate')
    .values({
      id: mandateId,
      tenant_id: tenantId,
      display_key: mandate.key,
      business_unit_id: R.id(mandate.businessUnitId),
      title: mandate.title,
      status: 'draft',
      created_by: maya,
      created_at: at(journeyMoments.mandateDrafted),
    })
    .execute();
  // v1 was returned for revision. A committed mandate version must carry every required field
  // (0001 CHECK), so v1 holds the v2 values without the outreach exclusion Elena asked for.
  for (const [v, withExclusion, committedAt] of [
    [v1, false, '2026-10-02T16:00:00+02:00'],
    [v2, true, v2.submittedAt],
  ] as const)
    await tx
      .insertInto('me.mandate_version')
      .values({
        id: R.id(v.id),
        tenant_id: tenantId,
        mandate_id: mandateId,
        version: v.version,
        state: 'committed',
        ...mandateVersionFields(s, withExclusion),
        committed_at: at(committedAt),
        created_by: maya,
        created_at: at(journeyMoments.mandateDrafted),
      })
      .execute();

  await tx
    .insertInto('platform.gate_request')
    .values({
      id: g0Id,
      tenant_id: tenantId,
      display_key: gates.g0.key,
      subject_type: 'mandate',
      subject_id: mandateId,
      business_unit_id: R.id(BU_WATER),
      gate_code: 'G0',
      status: 'awaiting_decision',
      scope: JSON.stringify(g0Content(s, v2Id, 2).scope),
      submitted_by: maya,
      submitted_at: at('2026-10-02T16:00:00+02:00'),
      created_by: maya,
      created_at: at('2026-10-02T16:00:00+02:00'),
    })
    .execute();

  const snap1 = R.id(fid('snapshot', 1));
  const snap2 = R.id(fid('snapshot', 2));
  const [h1, h2] = gates.g0.history;
  const hash1 = await insertSnapshot(s, {
    id: snap1,
    gateRequestId: g0Id,
    caseId: null,
    subjectId: mandateId,
    version: 1,
    content: g0Content(s, v1Id, 1),
    createdBy: maya,
    createdAt: '2026-10-02T16:00:00+02:00',
  });
  await setGateStatus(s, g0Id, 'awaiting_decision', { currentSnapshotId: snap1 });
  await decide(s, {
    gateRequestId: g0Id,
    snapshotId: snap1,
    snapshotHash: hash1,
    approverId: elena,
    approverRole: 'sponsor',
    authorityGrantId: null,
    disposition: h1.disposition,
    rationale: h1.rationale,
    decidedAt: h1.at,
  });
  await setGateStatus(s, g0Id, 'returned_for_revision', { decidedAt: h1.at });

  const hash2 = await insertSnapshot(s, {
    id: snap2,
    gateRequestId: g0Id,
    caseId: null,
    subjectId: mandateId,
    version: 2,
    content: g0Content(s, v2Id, 2),
    createdBy: maya,
    createdAt: v2.submittedAt,
  });
  await setSnapshotStatus(s, snap1, 'superseded', snap2);
  await setGateStatus(s, g0Id, 'awaiting_decision', {
    currentSnapshotId: snap2,
    submittedAt: v2.submittedAt,
  });
  await decide(s, {
    gateRequestId: g0Id,
    snapshotId: snap2,
    snapshotHash: hash2,
    approverId: elena,
    approverRole: 'sponsor',
    authorityGrantId: R.id(authorityGrants[0].id),
    disposition: h2.disposition,
    rationale: h2.rationale,
    decidedAt: h2.at,
  });
  await setGateStatus(s, g0Id, 'approved', { decidedAt: h2.at });
  await tx
    .updateTable('me.mandate')
    .set({ status: 'approved', current_version_id: v2Id, g0_gate_request_id: g0Id })
    .where('id', '=', mandateId)
    .execute();

  await seedAudit(s, {
    action: 'seed.mandate_history',
    objectType: 'mandate',
    objectId: mandateId,
    objectVersion: 2,
    summary: 'MD-21 v1 returned for revision on 3 Oct; v2 approved (G0) by Elena Fischer on 5 Oct',
    occurredAt: h2.at,
  });
}

async function seedOpportunities(s: SeedCtx): Promise<void> {
  const { tx, R, tenantId } = s;
  const mandateId = R.id(mandate.id);
  const productId = R.id(products[0].id);
  const segmentId = R.id(segments[0].id);
  for (const o of opportunities) {
    const extra = o as Partial<{ dismissReason: string }>;
    await tx
      .insertInto('me.opportunity')
      .values({
        id: R.id(o.id),
        tenant_id: tenantId,
        mandate_id: mandateId,
        display_key: o.key,
        name: o.name,
        trigger_text: o.trigger,
        fit_rationale: o.fitRationale,
        origin: o.origin,
        status: o.status,
        dismiss_reason: extra.dismissReason ?? null,
        product_id: productId,
        segment_id: segmentId,
        country_code: o.countryCode,
        evidence_quality: o.evidenceQuality,
        last_checked_at: at(o.lastCheckedAt),
        // AI-detected candidates are created by the analysis agent principal; they stay "Proposed · AI".
        created_by: R.id(o.origin === 'ai' ? U.analysisAgent.id : U.jonas.id),
        created_at: at(o.lastCheckedAt),
      })
      .execute();
    for (const text of o.unknowns)
      await tx
        .insertInto('me.opportunity_unknown')
        .values({ tenant_id: tenantId, opportunity_id: R.id(o.id), text })
        .execute();
    for (const key of o.sourceKeys)
      await tx
        .insertInto('me.opportunity_source')
        .values({ tenant_id: tenantId, opportunity_id: R.id(o.id), source_id: sourceId(s, key) })
        .execute();
  }
  for (const o of opportunities) {
    const dup = (o as Partial<{ likelyDuplicateOf: string }>).likelyDuplicateOf;
    if (dup)
      await tx
        .updateTable('me.opportunity')
        .set({ likely_duplicate_of_id: opportunityId(s, dup) })
        .where('id', '=', R.id(o.id))
        .execute();
  }
  await seedAudit(s, {
    action: 'seed.opportunities_detected',
    objectType: 'mandate',
    objectId: mandateId,
    summary: `Illustrative candidates for MD-21: ${opportunities.map((o) => o.key).join(', ')}`,
    occurredAt: journeyMoments.opportunitiesDetected,
  });
}

/** The other BU Water cases on S01 (ME-102, ME-105, ME-097). ME-104 is created by the journey. */
export async function seedOtherCases(s: SeedCtx): Promise<void> {
  const { tx, R, tenantId } = s;
  for (const c of cases) {
    const stage = (c as Partial<{ stage: string }>).stage;
    if (!stage) continue;
    await tx
      .insertInto('platform.workflow_case')
      .values({
        id: R.id(c.id),
        tenant_id: tenantId,
        app_type: 'market_expansion',
        display_key: c.key,
        title: c.title,
        business_unit_id: R.id(BU_WATER),
        owner_user_id: R.id(c.ownerId),
        sponsor_user_id: R.id(c.sponsorId),
        stage,
        origin_type: 'direct',
        created_by: R.id(c.ownerId),
        created_at: at('2026-09-01T09:00:00+02:00'),
      })
      .execute();
    await seedAudit(s, {
      action: 'seed.case_loaded',
      objectType: 'case',
      objectId: R.id(c.id),
      caseId: R.id(c.id),
      summary: `Illustrative case ${c.key} loaded at stage ${stage}`,
      occurredAt: '2026-09-01T09:00:00+02:00',
    });
  }
}

export async function setCounters(s: SeedCtx, counters: Record<string, number>): Promise<void> {
  for (const [prefix, next] of Object.entries(counters))
    await s.tx
      .insertInto('platform.display_key_counter')
      .values({ tenant_id: s.tenantId, prefix, next_value: next })
      .onConflict((oc) => oc.columns(['tenant_id', 'prefix']).doUpdateSet({ next_value: next }))
      .execute();
}

export async function seedStart(s: SeedCtx): Promise<void> {
  await seedOrg(s);
  await seedSources(s);
  await seedMandate(s);
  await seedOpportunities(s);
  await seedOtherCases(s);
  // Journey: converting OPP-07 creates ME-104 (taken keys are skipped by allocateDisplayKey),
  // Maya creates EXP-03; new sources continue after SRC-040.
  await setCounters(s, { ME: 104, MD: 22, OPP: 17, SRC: 41, EXP: 3, ASM: 1, CMP: 1 });
}
