/**
 * History tab mocks (WS8d): audit events for ME-104 in insertion order (`seq`). The fixture
 * journey up to the G2 package forms the base; every command the WS8d mocks accept (pilot,
 * sync, outcomes, evidence, admin) appends exactly one event with actor, role and version.
 */
import { API, type AuditEvent } from '@growth-os/contracts';
import { cases, exp03, fid, gates, journeyMoments as J, people } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import type { z } from 'zod';
import { G2_SNAPSHOT_ID, hashFor, mockId, personRef } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { state } from '../../mocks/state';
import { ws8d, type JourneyAudit } from './journey';

type In<S extends z.ZodTypeAny> = z.input<S>;
const ME104 = cases[0];

const base = (
  at: string,
  actor: keyof typeof people,
  role: JourneyAudit['actorRole'],
  action: string,
  objectType: string,
  objectId: string,
  objectVersion: number | null,
  summary: string,
  rule: string,
): JourneyAudit => ({
  at,
  actorId: people[actor].id,
  actorKind: 'human',
  actorRole: role,
  action,
  objectType,
  objectId,
  objectVersion,
  summary,
  rule,
});

function baseline(): JourneyAudit[] {
  const out: JourneyAudit[] = [
    base(
      J.mandateApproved,
      'elena',
      'sponsor',
      'gate.decided',
      'gate_request',
      gates.g0.id,
      2,
      'Approved mandate MD-21 (G0) · scope v2',
      'gate.decide · sponsor',
    ),
    base(
      J.compared,
      'maya',
      'case_owner',
      'case.created',
      'case',
      ME104.id,
      null,
      `Converted OPP-07 into ${ME104.key} · stage Discovery`,
      'case.create',
    ),
    base(
      J.sizingCommitted,
      'maya',
      'case_owner',
      'sizing.committed',
      'sizing_version',
      fid('sizingVersion', 2),
      2,
      'Committed sizing v2 · SAM €40m/year',
      'model.commit',
    ),
    base(
      J.adoptionDisputed,
      'daniel',
      'finance_reviewer',
      'assumption.disputed',
      'assumption',
      fid('assumption', 1),
      1,
      'Disputed 20% adoption · proposed 10%',
      'assumption.dispute',
    ),
    base(
      J.g1Approved,
      'elena',
      'sponsor',
      'gate.decided',
      'gate_request',
      gates.g1.id,
      1,
      'Approved validation €15k (G1)',
      'gate.decide · sponsor',
    ),
    base(
      exp03.amendment1.at,
      'maya',
      'case_owner',
      'experiment.amended',
      'experiment',
      exp03.id,
      2,
      'Amended EXP-03 window · amendment 1 · original kept',
      'experiment.amend',
    ),
    base(
      J.validationResults,
      'maya',
      'case_owner',
      'experiment.result_recorded',
      'experiment_result',
      exp03.id,
      1,
      'Recorded EXP-03 results: Met · 9 of 8, Met · 4 of 4',
      'experiment.record',
    ),
    base(
      J.specialistSigned,
      'lena',
      'specialist_reviewer',
      'review.signed',
      'feasibility_review',
      fid('feasibility', 1),
      1,
      'Signed specialist review · pilot only: up to 4 sites, 90 days',
      'review.sign',
    ),
    base(
      J.g2Submitted,
      'maya',
      'case_owner',
      'gate.submitted',
      'gate_snapshot',
      G2_SNAPSHOT_ID,
      3,
      'Submitted G2 package · snapshot v3',
      'gate.submit',
    ),
  ];
  const s = ws8d();
  const d = state.g2Decision;
  if (d) {
    out.push({
      at: d.at,
      actorId: d.by,
      actorKind: 'human',
      actorRole: 'sponsor',
      action: 'gate.decided',
      objectType: 'gate_snapshot',
      objectId: G2_SNAPSHOT_ID,
      objectVersion: 3,
      summary: `Decided G2 on snapshot v3 · ${d.disposition.replace(/_/g, ' ')}`,
      rule: 'gate.decide · sponsor',
    });
  } else if (s.audit.some((e) => !e.objectType.startsWith('source') && e.objectType !== 'connection')) {
    // The pilot and outcome journey start after the fixture's G2 decision (27 Nov).
    out.push(
      base(
        J.g2Approved,
        'elena',
        'sponsor',
        'gate.decided',
        'gate_snapshot',
        G2_SNAPSHOT_ID,
        3,
        'Approved pilot €120k · 90 days (G2) with conditions C1, C2',
        'gate.decide · sponsor',
      ),
    );
  }
  return out;
}

export function historyEvents(): In<typeof AuditEvent>[] {
  const all = [...baseline(), ...ws8d().audit];
  return all.map((e, i) => ({
    id: mockId(5000 + i + 1),
    seq: i + 1,
    occurredAt: e.at,
    actor: e.actorId ? personRef(e.actorId) : null,
    actorKind: e.actorKind,
    actorRole: e.actorRole,
    action: e.action,
    objectType: e.objectType,
    objectId: e.objectId,
    objectVersion: e.objectVersion,
    caseId: e.objectType === 'connection' ? null : ME104.id,
    beforeHash: null,
    afterHash: hashFor('A0D1·7C55', i + 1),
    summary: e.summary,
    authzContext: { decision: 'allow' as const, rule: e.rule, authorityGrantId: null },
    correlationId: `corr-${String(i + 1).padStart(4, '0')}`,
  }));
}

export const handlers: HttpHandler[] = [
  mock(API.cases.history, ({ params, query, viewerId }) => {
    if (params.caseRef !== ME104.key && params.caseRef !== ME104.id) {
      if (cases.some((c) => c.key === params.caseRef)) return { items: [], nextCursor: null };
      throw new MockProblem('NOT_FOUND', 'Not found.');
    }
    if (viewerId === people.admin.id) throw new MockProblem('NOT_FOUND', 'Not found.');
    const items = historyEvents()
      .filter((e) => e.caseId === ME104.id)
      .filter((e) => !query.objectType || e.objectType === query.objectType)
      .filter((e) => !query.objectId || e.objectId === query.objectId);
    const start = query.cursor ? Number(query.cursor) : 0;
    const page = items.slice(start, start + query.limit);
    const next = start + query.limit < items.length ? String(start + query.limit) : null;
    return { items: page, nextCursor: next };
  }),
];
