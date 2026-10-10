/**
 * S07 Feasibility MSW handlers: readiness rows with named human reviewers, scoped sign-offs,
 * blockers and signed disagreements. No readiness score. The specialist review stays
 * "Pending — human review required" until Lena Hoffmann signs it herself. Validated by `mock()`.
 */
import {
  API,
  type FeasibilityAssessment,
  type FeasibilityDimension,
  type FeasibilityView,
} from '@growth-os/contracts';
import { feasibility, people, specialistQuestion } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { findCase, personRef } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { assessment, CASE_ID, CASE_KEY, nowIso, sourceChip, wsId } from '../sizing/mock-state';

const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');

/** Sign-offs recorded before the assessment moment (fixture scope texts). */
const PRIOR_SIGNED: Partial<Record<FeasibilityDimension, { version: number; at: string }>> = {
  differentiation: { version: 2, at: '2026-10-12T15:00:00+02:00' },
  commercial_access: { version: 1, at: '2026-10-12T16:10:00+02:00' },
};

function row(f: (typeof feasibility)[number]): FeasibilityAssessment {
  const signed = assessment.feasibility.signed[f.dimension];
  const prior = PRIOR_SIGNED[f.dimension];
  const blockerFx = 'blocker' in f ? f.blocker : null;
  const blockerResolved =
    !!signed && signed.position !== 'dissents' && signed.coversGate === blockerFx?.blocksGate;
  const resolution = assessment.feasibility.blockerResolutions[f.dimension];
  return {
    id: f.id,
    caseId: CASE_ID,
    dimension: f.dimension,
    question: f.question,
    questionDetail: f.dimension === 'specialist_review' ? specialistQuestion : null,
    evidenceText: f.evidenceText,
    reviewer: personRef(f.reviewerId),
    status: signed ? 'signed' : f.status,
    scopeText: signed ? signed.scopeText : f.scopeText,
    dueOn: f.dueOn,
    humanOnly: f.humanOnly,
    currentReview: signed
      ? {
          id: wsId(28, 1),
          assessmentId: f.id,
          version: 1,
          position: signed.position as 'supports',
          scope: {
            text: signed.scopeText,
            coversGate: signed.coversGate,
            maxSites: signed.maxSites,
            maxDays: signed.maxDays,
          },
          statement: signed.statement,
          evidenceSourceIds: [],
          signedBy: personRef(signed.signedById),
          signedAt: signed.signedAt,
        }
      : prior && f.status === 'signed'
        ? {
            id: wsId(28, prior.version + 10),
            assessmentId: f.id,
            version: prior.version,
            position: 'supports',
            scope: { text: f.scopeText, coversGate: 'G1', maxSites: null, maxDays: null },
            statement: null,
            evidenceSourceIds: [],
            signedBy: personRef(f.reviewerId),
            signedAt: prior.at,
          }
        : null,
    blockers: blockerFx
      ? [
          {
            id: wsId(27, 1),
            assessmentId: f.id,
            text: blockerFx.text,
            blocksGate: blockerFx.blocksGate,
            status: blockerResolved || resolution ? 'resolved' : 'open',
            resolution: resolution?.text ?? (blockerResolved ? signed!.scopeText : null),
            resolvedBy: resolution
              ? personRef(resolution.byId)
              : blockerResolved
                ? personRef(signed!.signedById)
                : null,
            scopeRestrictionGateRequestId: null,
          },
        ]
      : [],
    disagreements: (assessment.feasibility.disagreements[f.dimension] ?? []).map((d) => ({
      id: d.id,
      author: personRef(d.authorId),
      statement: d.statement,
      createdAt: d.createdAt,
    })),
  };
}

export function feasibilityView(): FeasibilityView {
  const rows = feasibility.map(row);
  return {
    rows,
    counts: {
      signed: rows.filter((r) => r.status === 'signed').length,
      inReview: rows.filter((r) => r.status === 'in_review').length,
      pending: rows.filter((r) => r.status === 'pending').length,
      blockers: rows.flatMap((r) => r.blockers).filter((b) => b.status === 'open').length,
    },
    competitors: [
      {
        id: wsId(29, 1),
        text: 'Established suppliers at large plants',
        source: sourceChip('SRC-021'),
        unknown: false,
      },
      { id: wsId(29, 2), text: 'Fragmented service providers at small plants', source: null, unknown: true },
    ],
  };
}

function requireMe104(caseRef: string) {
  const c = findCase(caseRef);
  if (!c || c.key !== CASE_KEY) throw notFound();
}

export const handlers: HttpHandler[] = [
  mock(API.feasibility.get, ({ params }) => {
    requireMe104(params.caseRef);
    return feasibilityView();
  }),

  mock(API.feasibility.sign, ({ params, body, viewerId }) => {
    requireMe104(params.caseRef);
    const f = feasibility.find((x) => x.dimension === params.dimension);
    if (!f) throw notFound();
    if (viewerId !== f.reviewerId) {
      throw new MockProblem(
        'FORBIDDEN',
        `Only ${personRef(f.reviewerId).displayName} can record this review. Request a review instead.`,
      );
    }
    assessment.feasibility.signed[f.dimension] = {
      dimension: f.dimension,
      position: body.position,
      scopeText: body.scopeText,
      coversGate: body.coversGate,
      maxSites: body.maxSites,
      maxDays: body.maxDays,
      statement: body.statement,
      signedById: viewerId,
      signedAt: nowIso(),
    };
    return feasibilityView();
  }),

  mock(API.feasibility.recordDisagreement, ({ params, body, viewerId }) => {
    requireMe104(params.caseRef);
    const list = (assessment.feasibility.disagreements[params.dimension] ??= []);
    list.push({
      id: wsId(21, 10 + list.length),
      authorId: viewerId!,
      statement: body.statement,
      createdAt: nowIso(),
    });
    return feasibilityView();
  }),

  mock(API.feasibility.resolveBlocker, ({ params, body, viewerId }) => {
    const f = feasibility.find((x) => 'blocker' in x && wsId(27, 1) === params.id);
    if (!f) throw notFound();
    if (body.kind === 'scope_restricted' && !body.scopeRestrictionGateRequestId) {
      throw new MockProblem(
        'PRECONDITIONS_UNMET',
        'Restricting scope needs an approved gate scope restriction.',
        {
          blockers: [{ key: 'scope_restriction', message: 'No approved gate scope restriction.' }],
        },
      );
    }
    if (!assessment.feasibility.signed[f.dimension]) {
      throw new MockProblem('PRECONDITIONS_UNMET', 'The reviewer has not recorded a position yet.', {
        blockers: [
          { key: 'review_pending', message: `${personRef(f.reviewerId).displayName} has not signed.` },
        ],
      });
    }
    assessment.feasibility.blockerResolutions[f.dimension] = { text: body.resolution, byId: viewerId! };
    return feasibilityView();
  }),
];

export const SPECIALIST_REVIEWER_ID = people.lena.id;
