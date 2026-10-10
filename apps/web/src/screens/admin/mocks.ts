/**
 * S14 Administration mocks (WS8d). Admin-only reads and actions (others get FORBIDDEN), except the
 * connections list, which S03 and S11 also read. Authority grants come from the fixture: there is
 * deliberately no G3 grant, so the matrix reports an authority gap. Diagnostics return structured
 * outputs and tool events only.
 */
import { API, type PolicyKind } from '@growth-os/contracts';
import {
  authorityGrants,
  businessUnits,
  cases,
  connections,
  connectorMappings,
  fid,
  gatePolicies,
  licenses,
  materialityRules,
  people,
  roleAssignments,
  sourceEntitlements,
} from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { hashFor, mockId, P } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { at, audit, save, ws8d } from '../history/journey';

const ADMIN = people.admin.id;
const BU = businessUnits[0].id;
const GRANTED_AT = '2026-01-05T09:00:00+01:00';
const CHECKED_AT = '2026-10-09T08:00:00+02:00';
const ADMIN_MOMENT = '2026-10-09T09:00:00+02:00';
export const DIAGNOSTICS_RUN_ID = mockId(3001);

function requireAdmin(viewerId: string | null) {
  if (viewerId !== ADMIN)
    throw new MockProblem('FORBIDDEN', 'Administration is available to tenant administrators only.');
}

export function connectionRows() {
  const st = ws8d().admin;
  return connections.map((c) => {
    const fixed = st.reconnected.includes(c.id);
    const tested = st.tested.includes(c.id);
    return {
      ...c,
      status: fixed ? ('connected' as const) : c.status,
      lastSuccessAt: fixed || tested ? '2026-10-09T09:05:00+02:00' : c.lastSuccessAt,
      lastCheckedAt: fixed || tested ? '2026-10-09T09:05:00+02:00' : CHECKED_AT,
    };
  });
}

const POLICY_AT = '2026-01-05T09:00:00+01:00';
function policies() {
  let n = 0;
  const p = (kind: PolicyKind, key: string, body: unknown) => ({
    id: fid('policy', ++n),
    kind,
    key,
    version: 1,
    status: 'active' as const,
    body,
    createdBy: ADMIN,
    createdAt: POLICY_AT,
  });
  return [
    ...gatePolicies.map((g) => p('gate', `gate.${g.gateCode}`, { ...g, selfApprovalAllowed: false })),
    p('materiality', 'materiality.default', {
      rules: materialityRules.map((r) => ({ ...r })),
      escalateTo: 'sponsor',
    }),
    p('approval_expiry', 'approval_expiry.default', { days: 14 }),
    p('retention', 'retention.default', {
      approvalHistoryYears: null,
      note: 'Approval history kept for [retention period]',
    }),
    p('self_approval', 'self_approval.default', { allowed: false }),
    p('run_budget', 'run_budget.default', {
      perRunWallTimeMs: 300_000,
      perRunMaxToolCalls: 40,
      perRunMaxInputTokens: 200_000,
      perRunMaxOutputTokens: 16_000,
      perCaseMonthlyCostMicros: 50_000_000,
      tenantConcurrentRuns: 4,
    }),
  ];
}

const OTHERS: Record<string, 'excerpt' | 'aggregate_only' | 'none'> = {
  'site-census': 'aggregate_only',
  'vendor-estimate': 'none',
  'authorized-upload': 'none',
};

function entitlements() {
  const names = (licenseId: string) => {
    const users = sourceEntitlements
      .filter((e) => e.licenseId === licenseId && e.access === 'excerpt')
      .map((e) =>
        e.principalType === 'user'
          ? (Object.values(people).find((p) => p.id === e.principal)?.displayName ?? e.principal)
          : e.principal === 'case_member'
            ? 'Case members'
            : e.principal,
      );
    return users.length ? users : ['Nobody'];
  };
  return licenses.map((l) => ({
    licenseId: l.id,
    sourceLabel: l.name,
    licenseText: l.boundaryText,
    excerptVisibleTo: names(l.id),
    othersSee: OTHERS[l.key] ?? 'none',
  }));
}

function diagnostics() {
  const runAt = '2026-10-14T10:41:00+02:00';
  const tool = (
    n: number,
    toolName: 'intelligence.search' | 'evidence.get' | 'sizing.calculate',
    version: string,
    args: Record<string, unknown>,
    scope: { tenant: boolean; entitlement: boolean | null; schema: boolean; budget: boolean },
    outcome: 'ok' | 'denied',
    resultSummary: string,
    time: string,
  ) => ({
    id: mockId(3100 + n),
    runId: DIAGNOSTICS_RUN_ID,
    tool: toolName,
    toolVersion: version,
    argsHash: hashFor('9A1F·00C3', n),
    argsRedacted: args,
    scopeCheck: scope,
    outcome,
    resultSummary,
    latencyMs: 320 + n * 40,
    createdAt: time,
  });
  return {
    run: {
      id: DIAGNOSTICS_RUN_ID,
      caseId: cases[0].id,
      mandateId: null,
      skill: 'bottom-up-sizing' as const,
      skillVersion: '1.2.0',
      goal: 'Draft bottom-up sizing for ME-104',
      status: 'completed' as const,
      statusLabel: 'Done',
      statusDetail: 'sizing draft proposed · accepted by Maya Rao',
      requestedBy: P('maya'),
      provider: 'fixture',
      modelConfig: null,
      inputSnapshotHash: hashFor('4E2D·91AA'),
      budget: {
        wallTimeMs: 300_000,
        maxToolCalls: 40,
        maxInputTokens: 200_000,
        maxOutputTokens: 16_000,
        maxCostMicros: 2_000_000,
      },
      usage: { elapsedMs: 232_000, toolCalls: 3, inputTokens: 18_400, outputTokens: 2_100, costMicros: 0 },
      lastCheckpointSeq: 4,
      needsInput: null,
      error: null,
      createdAt: runAt,
      startedAt: runAt,
      finishedAt: '2026-10-14T10:44:52+02:00',
      correlationId: 'run-2610-14-0441',
    },
    steps: [
      { seq: 1, kind: 'tool_call' as const, summary: 'Searched permitted sources · 3 documents' },
      { seq: 2, kind: 'tool_call' as const, summary: 'Source request refused by licence · not summarised' },
      { seq: 3, kind: 'validation' as const, summary: 'Proposed inputs validated against the sizing schema' },
      { seq: 4, kind: 'proposal_write' as const, summary: 'Sizing draft proposal written for human review' },
    ].map((s) => ({
      id: mockId(3200 + s.seq),
      runId: DIAGNOSTICS_RUN_ID,
      seq: s.seq,
      kind: s.kind,
      status: 'succeeded' as const,
      summary: s.summary,
      startedAt: runAt,
      finishedAt: '2026-10-14T10:44:52+02:00',
    })),
    toolCalls: [
      tool(
        1,
        'intelligence.search',
        '1.0',
        { query: '[redacted]' },
        { tenant: true, entitlement: true, schema: true, budget: true },
        'ok',
        '3 documents',
        '2026-10-14T10:41:03+02:00',
      ),
      tool(
        2,
        'evidence.get',
        '1.0',
        { source: 'SRC-030' },
        { tenant: true, entitlement: false, schema: true, budget: true },
        'denied',
        'denied · not summarised',
        '2026-10-14T10:42:19+02:00',
      ),
      tool(
        3,
        'sizing.calculate',
        '1.2',
        { model: 'sizing v1.2' },
        { tenant: true, entitlement: null, schema: true, budget: true },
        'ok',
        'SAM 40,000,000 · reproducible',
        '2026-10-14T10:44:40+02:00',
      ),
    ],
  };
}

export const handlers: HttpHandler[] = [
  mock(API.admin.roles, ({ viewerId }) => {
    requireAdmin(viewerId);
    return {
      items: roleAssignments.map((r) => ({
        id: r.id,
        userId: r.userId,
        role: r.role,
        businessUnitId: r.businessUnitId,
        caseId: null,
        grantedBy: ADMIN,
        grantedAt: GRANTED_AT,
        revokedAt: null,
      })),
    };
  }),

  mock(API.admin.authority, ({ viewerId }) => {
    requireAdmin(viewerId);
    return {
      items: authorityGrants.map((a) => ({ ...a, validTo: null, grantedBy: ADMIN, revokedAt: null })),
      gaps: [
        {
          gateCode: 'G3' as const,
          businessUnitId: BU,
          message:
            'No G3 approver for BU Water above €[limit]. Authority gap · assign the investment committee.',
        },
      ],
    };
  }),

  mock(API.admin.policies, ({ viewerId }) => {
    requireAdmin(viewerId);
    return { items: policies() };
  }),

  mock(API.admin.entitlements, ({ viewerId }) => {
    requireAdmin(viewerId);
    return { items: entitlements() };
  }),

  // Read by S03 and S11 too, so no admin check on the list itself.
  mock(API.admin.connections, () => ({
    items: connectionRows(),
    mappings: connectorMappings.map((m, i) => ({
      id: fid('connection', 20 + i),
      connectionId: m.connectionId,
      purpose: m.purpose,
      destinationProject: m.destinationProject,
      issueType: m.issueType,
      assigneeMap: {},
    })),
  })),

  mock(API.admin.testConnection, ({ params, viewerId }) => {
    requireAdmin(viewerId);
    const st = ws8d().admin;
    if (!connections.some((c) => c.id === params.id)) throw new MockProblem('NOT_FOUND', 'Not found.');
    if (!st.tested.includes(params.id)) st.tested.push(params.id);
    save();
    return connectionRows().find((c) => c.id === params.id)!;
  }),

  mock(API.admin.reconnect, ({ params, viewerId }) => {
    requireAdmin(viewerId);
    const c = connections.find((x) => x.id === params.id);
    if (!c) throw new MockProblem('NOT_FOUND', 'Not found.');
    if (c.status !== 'expired')
      throw new MockProblem('INVALID_TRANSITION', 'Only an expired connection can be reconnected.');
    const st = ws8d().admin;
    if (!st.reconnected.includes(c.id)) {
      st.reconnected.push(c.id);
      audit({
        at: at(ADMIN_MOMENT),
        actorId: viewerId,
        actorKind: 'human',
        actorRole: 'tenant_admin',
        action: 'connection.reconnected',
        objectType: 'connection',
        objectId: c.id,
        objectVersion: null,
        summary: `Reconnected ${c.name}`,
        rule: 'admin.configure',
      });
    }
    save();
    return connectionRows().find((x) => x.id === c.id)!;
  }),

  mock(API.admin.runDiagnostics, ({ params, viewerId }) => {
    requireAdmin(viewerId);
    if (params.id !== DIAGNOSTICS_RUN_ID) throw new MockProblem('NOT_FOUND', 'Not found.');
    return diagnostics();
  }),
];
