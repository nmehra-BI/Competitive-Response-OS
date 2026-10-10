/**
 * S05 Thesis MSW handlers: thesis versions, claims with kinds, alternatives (including No entry),
 * disagreements (signed disputes), blockers, reviewers and the analysis run strip. Copy follows the
 * approved prototype; numbers come from the fixture (PRD §6). Validated by `mock()`.
 */
import {
  API,
  RUN_STATUS_LABELS,
  type AnalysisRun,
  type Challenge,
  type Claim,
  type ReviewRequest,
  type RunStatus,
  type ThesisFields,
  type ThesisVersion,
  type ThesisView,
} from '@growth-os/contracts';
import { people } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { findCase, personRef } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { assumptionList } from '../economics/mock-builders';
import {
  ASM,
  assessment,
  CASE_ID,
  CASE_KEY,
  nowIso,
  openDisputeFor,
  PEOPLE,
  scenario,
  sourceChip,
  type ThesisFieldsState,
  wsId,
  assumptionDisputes,
} from '../sizing/mock-state';

const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');

export const RUN_ID = wsId(31, 1);
const RUN_STARTED = '2026-10-14T10:41:00+02:00';
const RUN_DONE = '2026-10-14T10:52:00+02:00';
const COMMITTED_AT = '2026-10-14T09:40:00+02:00';
/** A run requested from the screen completes after this long (mock clock). */
export const MOCK_RUN_MS = 3000;

// ---------------------------------------------------------------------------
// Analysis run
// ---------------------------------------------------------------------------

function runStatus(): { status: RunStatus; startedAt: string; finishedAt: string | null } {
  const o = assessment.thesis.runOverride;
  if (o) {
    const done = o.status === 'completed' || Date.now() - Date.parse(o.startedAt) >= MOCK_RUN_MS;
    return {
      status: done ? 'completed' : 'running',
      startedAt: o.startedAt,
      finishedAt: done ? nowIso() : null,
    };
  }
  const s = scenario().thesisRun ?? 'running';
  return { status: s, startedAt: RUN_STARTED, finishedAt: s === 'running' ? null : RUN_DONE };
}

const RUN_DETAIL: Partial<Record<RunStatus, string>> = {
  running: 'competitor scan · started 10:41 · your edits are saved',
  partial: 'competition section incomplete · your edits are saved',
  completed: '14 Oct, 10:52 · competition sources added',
};

export function analysisRun(): AnalysisRun {
  const r = runStatus();
  return {
    id: RUN_ID,
    caseId: CASE_ID,
    mandateId: null,
    skill: 'ability-to-win-assessment',
    skillVersion: '1.0.0',
    goal: 'Competitor scan for German food-processing plants',
    status: r.status,
    statusLabel: RUN_STATUS_LABELS[r.status],
    statusDetail: RUN_DETAIL[r.status] ?? null,
    requestedBy: PEOPLE.maya,
    provider: 'fixture',
    modelConfig: null,
    inputSnapshotHash: '3f'.repeat(32),
    budget: {
      wallTimeMs: 600_000,
      maxToolCalls: 40,
      maxInputTokens: 200_000,
      maxOutputTokens: 20_000,
      maxCostMicros: 2_000_000,
    },
    usage: { elapsedMs: 0, toolCalls: 3, inputTokens: 0, outputTokens: 0, costMicros: 0 },
    lastCheckpointSeq: 2,
    needsInput: null,
    error: null,
    createdAt: r.startedAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    correlationId: 'run-me104-competitor-scan',
  };
}

function runDone(): boolean {
  const s = runStatus().status;
  return s === 'completed';
}

// ---------------------------------------------------------------------------
// Thesis fields and versions
// ---------------------------------------------------------------------------

const prov = (f: ThesisFieldsState['proposition']) => ({
  value: f.value,
  origin: f.origin,
  agentRunId: f.origin === 'human' ? null : RUN_ID,
  editedBy: f.origin === 'ai_edited' ? people.maya.id : null,
});

const CLAIM_IDS = [1, 2, 3, 4, 5, 6].map((n) => wsId(30, n));

function fields(f: ThesisFieldsState): ThesisFields {
  return {
    proposition: prov(f.proposition),
    intendedCustomer: prov(f.intendedCustomer),
    whyNow: prov(f.whyNow),
    reasonsToWin: [
      {
        id: wsId(32, 1),
        text: {
          value: 'The existing product already monitors comparable process-water steps.',
          origin: 'human',
          agentRunId: null,
          editedBy: null,
        },
        linkedAssumptionId: ASM['product_fit']!.id,
        linkedFeasibilityDimension: 'product_fit',
        statusText: 'Pending · demo with Priya Shah',
      },
      {
        id: wsId(32, 2),
        text: {
          value: 'Partner coverage of food plants in Germany.',
          origin: 'human',
          agentRunId: null,
          editedBy: null,
        },
        linkedAssumptionId: ASM['reachable_pool']!.id,
        linkedFeasibilityDimension: null,
        statusText: null,
      },
      {
        id: wsId(32, 3),
        text: {
          value: 'Installation and support capacity sized for a bounded entry.',
          origin: 'human',
          agentRunId: null,
          editedBy: null,
        },
        linkedAssumptionId: ASM['capacity']!.id,
        linkedFeasibilityDimension: null,
        statusText: null,
      },
    ],
    alternatives: [
      {
        id: wsId(33, 1),
        name: 'No entry',
        meaning: 'Keep focus on current segments. No spend now; we forgo the learning.',
        status: 'considered_fallback',
        statusText: 'Considered · kept as fallback',
        isNoEntry: true,
      },
      {
        id: wsId(33, 2),
        name: 'Partner resale only',
        meaning: 'Partner sells; we do not run a pilot. Lower spend, weaker evidence on deployment effort.',
        status: 'considered_not_preferred',
        statusText: 'Considered · not preferred',
        isNoEntry: false,
      },
      {
        id: wsId(33, 3),
        name: 'Dutch food-processing plants first',
        meaning: 'Same segment, other market. Channel access unknown.',
        status: 'not_ranked',
        statusText: 'Not ranked · 1 input missing',
        isNoEntry: false,
      },
      {
        id: wsId(33, 4),
        name: 'Validate, then request a pilot',
        meaning: 'G1 validation €15k now; G2 pilot only if thresholds are met.',
        status: 'recommended',
        statusText: 'Recommended',
        isNoEntry: false,
      },
    ],
    recommendation: prov(f.recommendation),
    recommendationBy: people.maya.id,
    claimIds: CLAIM_IDS,
  };
}

function thesisVersion(
  version: number,
  state: 'draft' | 'committed',
  f: ThesisFieldsState,
  rowVersion: number,
): ThesisVersion {
  return {
    id: wsId(34, version),
    caseId: CASE_ID,
    version,
    state,
    fields: fields(f),
    rowVersion,
    committedAt: state === 'committed' ? COMMITTED_AT : null,
    reviewerAcceptedBy: null,
    createdAt: '2026-10-12T10:00:00+02:00',
  };
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

function claim(n: number, c: Partial<Claim> & Pick<Claim, 'statement' | 'kind'>): Claim {
  const id = CLAIM_IDS[n - 1]!;
  const challenged = assessment.thesis.challenges[id];
  return {
    id,
    caseId: CASE_ID,
    kindDetail: null,
    origin: 'human',
    agentRunId: null,
    status: challenged && challenged.status === 'open' ? 'challenged' : 'accepted',
    acceptedBy: people.maya.id,
    acceptedAt: '2026-10-12T10:00:00+02:00',
    sources: [],
    disputed: false,
    createdAt: '2026-10-12T10:00:00+02:00',
    createdBy: people.maya.id,
    ...c,
  };
}

export function claims(): Claim[] {
  const t = assessment.thesis;
  const done = runDone();
  const list: Claim[] = [
    claim(1, {
      statement: '5,000 food-processing sites in Germany operate a process-water treatment step.',
      kind: 'evidence',
      kindDetail: 'Site census 2026',
      sources: [sourceChip('SRC-014')],
    }),
    claim(2, {
      statement: 'Our partner channel reaches 500 of the eligible sites.',
      kind: 'assumption',
      kindDetail: 'Jonas Klein',
    }),
    claim(3, {
      statement: 'Sites spend about €20k per year on monitoring of this kind.',
      kind: 'assumption',
      kindDetail: 'Maya Rao',
      sources: [sourceChip('SRC-021')],
    }),
    claim(4, {
      statement:
        'Base scenario: 100 customers and €2.0m annual revenue at end of year 3, below the 120-customer capacity.',
      kind: 'scenario',
      kindDetail: 'Base · Year 3',
      disputed: openDisputeFor(ASM['adoption_rate.base']!.id) !== null,
    }),
    done
      ? claim(5, {
          statement: 'Established suppliers serve large plants; smaller plants are fragmented.',
          kind: 'evidence',
          kindDetail: 'Trade survey 2026',
          origin: 'ai_edited',
          agentRunId: RUN_ID,
          sources: [sourceChip('SRC-021')],
        })
      : claim(5, {
          statement: 'Who already serves these plants, and on what terms.',
          kind: 'unknown',
          kindDetail: 'competition section incomplete',
        }),
  ];
  if (t.aiClaim !== 'discarded') {
    const accepted = t.aiClaim === 'accepted';
    list.push(
      claim(6, {
        statement: 'Smaller plants may prefer a service contract over buying equipment.',
        kind: 'assumption',
        kindDetail: accepted
          ? `accepted by ${personRef(t.aiClaimAcceptedBy ?? people.maya.id).displayName}`
          : 'not yet accepted',
        origin: 'ai',
        agentRunId: RUN_ID,
        status: accepted ? 'accepted' : 'proposed',
        acceptedBy: accepted ? t.aiClaimAcceptedBy : null,
        acceptedAt: accepted ? '2026-10-14T11:00:00+02:00' : null,
        createdBy: people.analysisAgent.id,
      }),
    );
  }
  return list;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

const CRITICAL = ['ASM-01', 'ASM-04', 'ASM-05', 'ASM-06', 'ASM-08'];

export function thesisView(): ThesisView {
  const t = assessment.thesis;
  const register = assumptionList();
  const disagreements = assumptionDisputes().filter((c) => c.status === 'open');
  const danielDisagrees = disagreements.some((c) => c.raisedBy.id === people.daniel.id);
  return {
    current: thesisVersion(t.currentVersion, 'committed', t.committedFields, 0),
    draft: t.draft ? thesisVersion(t.draft.version, 'draft', t.draft.fields, t.draft.rowVersion) : null,
    claims: claims(),
    criticalAssumptions: CRITICAL.map((k) => register.find((a) => a.key === k)!),
    disagreements,
    blockers: [
      {
        id: wsId(35, 1),
        text: 'Specialist review not started. Blocks G2 (pilot), not G1.',
        owner: PEOPLE.lena,
        dueOn: '2026-11-20',
        gate: 'G2',
        status: 'blocker',
      },
      {
        id: wsId(35, 2),
        text: 'Product-fit demo pending.',
        owner: PEOPLE.priya,
        dueOn: '2026-10-21',
        gate: 'G1',
        status: 'pending',
      },
    ],
    reviewers: [
      { person: PEOPLE.daniel, area: 'Economics', status: danielDisagrees ? 'Disagreement' : 'In review' },
      { person: PEOPLE.priya, area: 'Product fit', status: 'Pending' },
      { person: PEOPLE.lena, area: 'Specialist', status: 'Pending' },
      { person: PEOPLE.jonas, area: 'Commercial access', status: 'In review' },
    ],
  };
}

function requireMe104(caseRef: string) {
  const c = findCase(caseRef);
  if (!c || c.key !== CASE_KEY) throw notFound();
}

function findClaim(id: string): Claim | null {
  return claims().find((c) => c.id === id) ?? null;
}

let reviewSeq = 0;

export const handlers: HttpHandler[] = [
  mock(API.thesis.get, ({ params }) => {
    requireMe104(params.caseRef);
    return thesisView();
  }),

  mock(API.thesis.saveDraft, ({ params, body, ifMatch }) => {
    requireMe104(params.caseRef);
    const t = assessment.thesis;
    if (t.draft && ifMatch !== t.draft.rowVersion) {
      throw new MockProblem('VERSION_CONFLICT', 'The thesis draft changed elsewhere.');
    }
    const d = t.draft ?? {
      version: t.currentVersion + 1,
      rowVersion: 0,
      fields: structuredClone(t.committedFields),
    };
    for (const k of ['proposition', 'intendedCustomer', 'whyNow'] as const) {
      const f = body.fields[k];
      if (f && f.value !== d.fields[k].value) {
        // Editing an AI-drafted field flips its origin to ai_edited (never back to human).
        d.fields[k] = { value: f.value, origin: d.fields[k].origin === 'human' ? 'human' : 'ai_edited' };
      }
    }
    const r = body.fields.recommendation;
    if (r && r.value !== d.fields.recommendation.value) {
      d.fields.recommendation = {
        value: r.value,
        origin: d.fields.recommendation.origin === 'human' ? 'human' : 'ai_edited',
      };
    }
    d.rowVersion += 1;
    t.draft = d;
    return thesisView();
  }),

  mock(API.thesis.commit, ({ params }) => {
    requireMe104(params.caseRef);
    const t = assessment.thesis;
    if (!t.draft) throw new MockProblem('INVALID_TRANSITION', 'There is no thesis draft to commit.');
    t.currentVersion = t.draft.version;
    t.committedFields = t.draft.fields;
    t.draft = null;
    return thesisView();
  }),

  mock(API.thesis.acceptClaim, ({ params, viewerId }) => {
    const c = findClaim(params.id);
    if (!c) throw notFound();
    if (c.status !== 'proposed') throw new MockProblem('INVALID_TRANSITION', 'This claim is not a proposal.');
    assessment.thesis.aiClaim = 'accepted';
    assessment.thesis.aiClaimAcceptedBy = viewerId;
    return findClaim(params.id)!;
  }),

  mock(API.thesis.discardClaim, ({ params }) => {
    const c = findClaim(params.id);
    if (!c) throw notFound();
    if (c.status !== 'proposed')
      throw new MockProblem('INVALID_TRANSITION', 'Only proposals can be discarded.');
    assessment.thesis.aiClaim = 'discarded';
    return { ...c, status: 'discarded' as const };
  }),

  mock(API.thesis.challengeClaim, ({ params, body, viewerId }) => {
    const c = findClaim(params.id);
    if (!c) throw notFound();
    const ch: Challenge = {
      id: wsId(36, Object.keys(assessment.thesis.challenges).length + 1),
      kind: 'challenge',
      targetType: 'claim',
      targetId: c.id,
      caseId: CASE_ID,
      raisedBy: personRef(viewerId!),
      statement: body.statement,
      proposedValue: null,
      status: 'open',
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: nowIso(),
      replies: [],
    };
    assessment.thesis.challenges[c.id] = ch;
    return ch;
  }),

  mock(API.analysis.latestForCase, ({ params }) => {
    requireMe104(params.caseRef);
    return { items: [analysisRun()], nextCursor: null };
  }),

  mock(API.analysis.get, ({ params }) => {
    if (params.id !== RUN_ID) throw notFound();
    return { run: analysisRun(), steps: [] };
  }),

  mock(API.analysis.start, ({ params }) => {
    requireMe104(params.caseRef);
    assessment.thesis.runOverride = { status: 'running', startedAt: nowIso() };
    return analysisRun();
  }),

  mock(API.cases.requestReview, ({ params, body, viewerId }) => {
    const c = findCase(params.caseRef);
    if (!c) throw notFound();
    reviewSeq += 1;
    const r: ReviewRequest = {
      id: wsId(37, reviewSeq),
      caseId: c.id,
      caseKey: c.key,
      area: body.area,
      targetType: body.targetType,
      targetId: body.targetId,
      question: body.question,
      whatToCheck: body.whatToCheck,
      requestedBy: personRef(viewerId!),
      reviewer: personRef(body.reviewerId),
      dueOn: body.dueOn,
      status: 'open',
      response: null,
      responseReason: null,
      respondedAt: null,
    };
    if (body.targetType === 'feasibility' && body.targetId) {
      assessment.feasibility.requested[body.targetId] = nowIso();
    }
    return r;
  }),
];
