/**
 * S12 Outcomes mocks (WS8d). Acceptance steps 25–28: Jonas records actuals with period and source
 * (Not met · Not met · Inconclusive); Maya drafts the recommendation "Revise and extend
 * validation" (not a decision); Elena records the decision; Maya requests an extension with its
 * own cap; scale stays blocked by unmet G3 preconditions.
 */
import { API, type Blocker, type GateRequest, type OutcomeReviewView } from '@growth-os/contracts';
import {
  cases,
  fid,
  gates,
  journeyMoments as J,
  outcomeObservations,
  outcomeReview,
  outcomeTargets,
  people,
} from '@growth-os/fixtures-aster';
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { z } from 'zod';
import { G2_SNAPSHOT_ID, mockId, P, personRef } from '../../mocks/data';
import { mock, MockProblem, mswPath, problem } from '../../mocks/define';
import { session } from '../../mocks/state';
import { at, audit, save, ws8d, type ObservationState } from '../history/journey';

type In<S extends z.ZodTypeAny> = z.input<S>;

const ME104 = cases[0];
export const OUTCOME_REVIEW_ID = mockId(2001);
const SPEND_TARGET_ID = fid('outcomeTarget', 9);
const DECISION_ID = fid('decision', 1);

const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');
function requireCase(ref: string) {
  if (ref !== ME104.key && ref !== ME104.id) throw notFound();
}

function target(t: (typeof outcomeTargets)[number]) {
  return {
    id: t.id,
    metricKey: t.metricKey,
    name: t.name,
    thresholdText: t.thresholdText,
    operator: t.operator,
    thresholdValue: t.thresholdValue,
    unit: t.unit,
    windowText: t.windowText,
    snapshotId: G2_SNAPSHOT_ID,
  };
}

function observation(o: ObservationState) {
  return {
    id: o.id,
    targetId: outcomeTargets.find((t) => t.metricKey === o.targetKey)?.id ?? null,
    version: o.version,
    valueText: o.valueText,
    value: o.value,
    unit: o.unit,
    periodStart: o.periodStart,
    periodEnd: o.periodEnd,
    sourceText: o.sourceText,
    sourceId: null,
    result: o.result,
    recordedBy: personRef(o.recordedBy),
    recordedAt: o.recordedAt,
    supersedesId: o.supersedesId,
  };
}

/** Deterministic threshold check (the engine's job on the real API). */
function resultFor(targetKey: string, valueText: string, value: string | null) {
  const t = outcomeTargets.find((x) => x.metricKey === targetKey)!;
  if (t.operator === 'gte' && value !== null && t.thresholdValue !== null) {
    return Number(value) >= Number(t.thresholdValue) ? ('met' as const) : ('not_met' as const);
  }
  const fx = outcomeObservations.find((o) => o.targetKey === targetKey);
  if (fx && fx.valueText.toLowerCase() === valueText.toLowerCase()) return fx.result;
  if (/^above/i.test(valueText)) return 'not_met' as const;
  if (/^within/i.test(valueText)) return 'met' as const;
  return 'inconclusive' as const;
}

const allRecorded = () =>
  outcomeTargets.every((t) => ws8d().observations.some((o) => o.targetKey === t.metricKey));

function scaleBlockers(): Blocker[] {
  const paid = latest('paid_use_continuation');
  return [
    {
      key: 'pilot_actuals_vs_thresholds',
      message: paid
        ? `demand threshold ${paid.valueText} (4 of 4 required)`
        : 'demand threshold not recorded yet (4 of 4 required)',
      gate: 'G3',
      href: `/me/cases/${ME104.key}/outcomes?metric=paid_use_continuation`,
    },
    {
      key: 'readiness_reassessment',
      message: 'specialist scale-readiness review incomplete',
      gate: 'G3',
      ownerId: people.lena.id,
      href: `/me/cases/${ME104.key}/feasibility`,
    },
  ];
}

function latest(key: string): ObservationState | undefined {
  return [...ws8d().observations].reverse().find((o) => o.targetKey === key);
}

export function outcomeView(): In<typeof OutcomeReviewView> {
  const s = ws8d();
  const missing = outcomeTargets.filter((t) => !latest(t.metricKey));
  const rec = s.recommendation;
  return {
    id: OUTCOME_REVIEW_ID,
    caseId: ME104.id,
    version: 1,
    status: s.decision ? 'decided' : missing.length ? 'incomplete' : 'ready',
    incompleteReasons: missing.length
      ? [`${missing.length} of ${outcomeTargets.length} metrics have no actuals for 1 Dec 2026 – 28 Feb 2027`]
      : [],
    rows: [
      ...outcomeTargets.map((t) => {
        const l = latest(t.metricKey);
        return {
          target: target(t),
          label: t.name,
          latest: l ? observation(l) : null,
          history: s.observations.filter((o) => o.targetKey === t.metricKey).map(observation),
          notAThreshold: false,
        };
      }),
      {
        target: {
          id: SPEND_TARGET_ID,
          metricKey: 'spend',
          name: 'Spend',
          thresholdText: 'Within €120k approved',
          operator: 'lte' as const,
          thresholdValue: gates.g2.amount,
          unit: 'EUR',
          windowText: '1 Dec 2026 – 28 Feb 2027',
          snapshotId: G2_SNAPSHOT_ID,
        },
        label: 'Spend',
        latest: null,
        history: [],
        notAThreshold: true,
      },
    ],
    whatWeLearned: [...outcomeReview.whatWeLearned],
    whatChangesNext: [...outcomeReview.whatChangesNext],
    causalLimitations: [...outcomeReview.causalLimitations],
    readiness: [
      {
        text: 'Specialist scale-readiness review · incomplete',
        owner: P('lena'),
        status: 'Pending',
      },
    ],
    recommendation: rec
      ? {
          outcome: rec.outcome,
          label: rec.outcome === 'extend' ? outcomeReview.recommendation.label : labelFor(rec.outcome),
          text: rec.text,
          by: P('maya'),
          accepted: s.decision !== null,
        }
      : null,
    decision: s.decision
      ? {
          id: DECISION_ID,
          caseId: ME104.id,
          outcome: s.decision.outcome,
          label: s.decision.label,
          rationale: s.decision.rationale,
          decidedBy: personRef(s.decision.by),
          decidedAt: s.decision.at,
          onRecommendationOf: rec ? P('maya') : null,
          outcomeReviewId: OUTCOME_REVIEW_ID,
        }
      : null,
    scaleGate: { blocked: true, unmet: scaleBlockers() },
  };
}

function labelFor(o: string) {
  return { proceed: 'Proceed', revise: 'Revise', extend: 'Extend', stop: 'Stop', scale: 'Scale' }[o] ?? o;
}

export function extensionRequest(): In<typeof GateRequest> | null {
  const x = ws8d().extension;
  if (!x) return null;
  return {
    id: gates.x1.id,
    key: gates.x1.key,
    caseId: ME104.id,
    mandateId: null,
    gateCode: 'X',
    status: 'awaiting_decision',
    displayStatus: 'awaiting_decision',
    scope: {
      amount: x.spendCap,
      currency: x.currency,
      durationDays: x.durationDays,
      windowStart: null,
      windowEnd: null,
      countryCodes: ['DE'],
      segmentLabel: 'Food processing',
      maxSites: 4,
      milestones: [],
      ownerId: x.ownerId,
      authorizes: [...gates.x1.authorizes],
      doesNotAuthorize: [...gates.x1.doesNotAuthorize],
    },
    buttonLabel: 'Approve extension',
    parentGateRequestId: gates.g2.id,
    submittedBy: personRef(x.by),
    submittedAt: x.at,
    decidedAt: null,
    expiresAt: null,
    currentSnapshotId: null,
    conditions: [],
    rowVersion: 1,
  };
}

export function xPreconditions() {
  const x = extensionRequest();
  const decided = ws8d().decision;
  return {
    gateCode: 'X' as const,
    status: x ? ('awaiting_decision' as const) : ('not_started' as const),
    preconditions: [
      {
        key: 'parent_gate_reviewed',
        label: 'Pilot outcome reviewed',
        met: decided !== null,
        detail: null,
        href: null,
      },
      {
        key: 'extension_cap_set',
        label: 'Extension cap set',
        met: x !== null,
        detail: x ? null : '€[cap] · placeholder',
        href: null,
      },
      { key: 'accountable_owner', label: 'Accountable owner', met: x !== null, detail: null, href: null },
    ],
    blockers: [],
    canSubmit: x === null && decided?.outcome === 'extend',
  };
}

const roleOf = (id: string | null) =>
  id === people.jonas.id
    ? ('pilot_owner' as const)
    : id === people.maya.id
      ? ('case_owner' as const)
      : id === people.elena.id
        ? ('sponsor' as const)
        : null;

export const handlers: HttpHandler[] = [
  mock(API.outcomes.get, ({ params }) => {
    requireCase(params.caseRef);
    return outcomeView();
  }),

  mock(API.outcomes.recordObservation, ({ params, body, viewerId }) => {
    requireCase(params.caseRef);
    if (viewerId !== people.jonas.id && viewerId !== people.maya.id)
      throw new MockProblem('FORBIDDEN', 'Only the pilot owner or case owner records actuals.');
    const t = outcomeTargets.find((x) => x.id === body.targetId);
    if (!t) throw new MockProblem('VALIDATION_FAILED', 'Choose a pre-registered metric.');
    const s = ws8d();
    const prev = latest(t.metricKey);
    const n = s.observations.length + 1;
    const o: ObservationState = {
      id: mockId(2100 + n),
      targetKey: t.metricKey,
      version: (prev?.version ?? 0) + 1,
      valueText: body.valueText,
      value: body.value,
      unit: body.unit || t.unit,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      sourceText: /^source:/i.test(body.sourceText) ? body.sourceText : `Source: ${body.sourceText}`,
      result: resultFor(t.metricKey, body.valueText, body.value),
      recordedBy: viewerId,
      recordedAt: at(J.actualsRecorded, 1),
      supersedesId: body.supersedesId ?? prev?.id ?? null,
    };
    s.observations.push(o);
    audit({
      at: o.recordedAt,
      actorId: viewerId,
      actorKind: 'human',
      actorRole: roleOf(viewerId),
      action: 'outcome.recorded',
      objectType: 'outcome_observation',
      objectId: o.id,
      objectVersion: o.version,
      summary: `Recorded ${t.name}: ${o.valueText} · ${o.sourceText.replace(/^Source: /, '')}`,
      rule: 'outcome.record',
    });
    save();
    return observation(o);
  }),

  mock(API.outcomes.saveReviewDraft, ({ params, body, viewerId, ifMatch }) => {
    requireCase(params.caseRef);
    if (viewerId !== people.maya.id)
      throw new MockProblem('FORBIDDEN', 'Only the case owner, Maya Rao, drafts the outcome review.');
    const s = ws8d();
    // OutcomeReviewView has no row version in the frozen contract (WS8d change request): the
    // client sends the review version; only its presence is enforced here.
    if (ifMatch === null) throw new MockProblem('PRECONDITION_REQUIRED', 'If-Match header is required.');
    if (s.decision)
      throw new MockProblem('INVALID_TRANSITION', 'The decision is recorded; the review is closed.');
    if (body.recommendation !== undefined) {
      s.recommendation = body.recommendation;
      if (body.recommendation) {
        audit({
          at: at(J.actualsRecorded, 30),
          actorId: viewerId,
          actorKind: 'human',
          actorRole: 'case_owner',
          action: 'outcome_review.recommendation_set',
          objectType: 'outcome_review',
          objectId: OUTCOME_REVIEW_ID,
          objectVersion: 1,
          summary: `Recommended “${body.recommendation.outcome === 'extend' ? outcomeReview.recommendation.label : labelFor(body.recommendation.outcome)}” · not a decision`,
          rule: 'outcome_review.edit',
        });
      }
    }
    s.reviewRowVersion += 1;
    save();
    return outcomeView();
  }),

  mock(API.outcomes.decide, ({ params, body, viewerId }) => {
    requireCase(params.caseRef);
    if (viewerId === people.admin.id)
      throw new MockProblem('FORBIDDEN', 'Administrators configure settings and never record decisions.');
    if (viewerId !== people.elena.id)
      throw new MockProblem(
        'AUTHORITY_INSUFFICIENT',
        'Only the sponsor, Elena Fischer, records this decision.',
      );
    const s = ws8d();
    if (s.decision) throw new MockProblem('INVALID_TRANSITION', 'A decision is already recorded.');
    if (!allRecorded())
      throw new MockProblem('PRECONDITIONS_UNMET', 'Review incomplete — record the actuals first.', {
        blockers: [{ key: 'actuals_missing', message: 'Every pre-registered metric needs an actual.' }],
      });
    s.decision = {
      outcome: body.outcome,
      label: body.label,
      rationale: body.rationale,
      by: viewerId,
      at: J.decisionRecorded,
    };
    audit({
      at: J.decisionRecorded,
      actorId: viewerId,
      actorKind: 'human',
      actorRole: 'sponsor',
      action: 'outcome.decided',
      objectType: 'decision_record',
      objectId: DECISION_ID,
      objectVersion: 1,
      summary: `Decision recorded: ${body.label} · stage Validation`,
      rule: 'outcome.decide · sponsor',
    });
    save();
    const view = outcomeView();
    return { decision: view.decision!, review: view };
  }),

  mock(API.outcomes.requestExtension, ({ params, body, viewerId }) => {
    requireCase(params.caseRef);
    if (viewerId !== people.maya.id)
      throw new MockProblem('FORBIDDEN', 'Only the case owner, Maya Rao, requests an extension.');
    const s = ws8d();
    if (!s.decision || s.decision.outcome !== 'extend')
      throw new MockProblem('PRECONDITIONS_UNMET', 'An extension follows a recorded “extend” decision.', {
        blockers: [{ key: 'decision_extend', message: 'Record the outcome decision first.' }],
      });
    if (body.parentGateRequestId !== gates.g2.id)
      throw new MockProblem('VALIDATION_FAILED', 'Unknown parent gate.');
    if (!s.extension) {
      s.extension = { ...body, by: viewerId, at: J.extensionSubmitted };
      audit({
        at: J.extensionSubmitted,
        actorId: viewerId,
        actorKind: 'human',
        actorRole: 'case_owner',
        action: 'gate_request.submitted',
        objectType: 'gate_request',
        objectId: gates.x1.id,
        objectVersion: 1,
        summary: `Requested extension ${gates.x1.key} · own cap · awaiting Elena Fischer`,
        rule: 'extension.request',
      });
      save();
    }
    return extensionRequest()!;
  }),

  // X1 status for S12 after a reload. Only the X gate is answered here; G1/G2/G3 fall through to
  // the WS7 base handler (an MSW resolver that returns nothing passes the request on).
  http.get(mswPath(API.gates.rail), ({ params }) => {
    if (params.gateCode !== 'X') return undefined;
    if (!session.viewerId) return problem('UNAUTHENTICATED', 'Sign in to continue.');
    if (params.caseRef !== ME104.key && params.caseRef !== ME104.id)
      return problem('NOT_FOUND', 'Not found.');
    return HttpResponse.json(API.gates.rail.response.parse(xPreconditions()));
  }),
];
