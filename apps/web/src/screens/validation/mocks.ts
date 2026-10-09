/**
 * MSW handlers for S09 Validation (WS8c): assumption register and dispute thread, EXP-03 create /
 * amend / results / decision, and validation tasks (preview → create → honest "Sending…" then
 * "Confirmed · VAL-n"). A change to the decision-critical adoption assumption marks an awaiting
 * G2 snapshot stale, or invalidates an effective approval (WS3 materiality rules).
 */
import { API } from '@growth-os/contracts';
import { assumptions, cases, people } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { findCase } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { state } from '../../mocks/state';
import { G2_ID } from '../decisions/mock-data';
import { hasResults, persisting, setStale, ws } from '../decisions/mock-state';
import {
  assumptionList,
  dispute,
  EXP_ID,
  exampleExperiment,
  experiment,
  PREVIEW_HASH,
  PREVIEW_ID,
  TASK_SET_ID,
  taskPreview,
  taskSet,
} from './mock-data';

const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');
const ME104 = cases[0];
const ADOPTION_ID = assumptions[0].id;
const now = () => new Date().toISOString();

function requireMe104(ref: string) {
  const c = findCase(ref);
  if (!c) throw notFound();
  return c;
}

/** EXP-03 is run by its owner (Maya Rao) and fieldwork owner (Jonas Klein). */
function assertExperimentEditor(viewerId: string | null) {
  if (viewerId !== people.maya.id && viewerId !== people.jonas.id) {
    throw new MockProblem('FORBIDDEN', 'Only the experiment owner or fieldwork owner can change it.');
  }
}

function requireExperiment(id: string) {
  const e = experiment();
  if (!e || (id !== EXP_ID && id !== e.key)) throw notFound();
  return e;
}

export const handlers: HttpHandler[] = [
  // ----- Assumption register and dispute -----
  mock(API.assumptions.list, ({ params }) => {
    const c = requireMe104(params.caseRef);
    return { items: c.key === ME104.key ? assumptionList() : [] };
  }),

  mock(
    API.assumptions.update,
    persisting(({ params, body, viewerId, ifMatch }) => {
      const a = assumptionList().find((x) => x.id === params.id || x.key === params.id);
      if (!a) throw notFound();
      if (viewerId !== a.owner.id && viewerId !== people.maya.id)
        throw new MockProblem('FORBIDDEN', 'Only the assumption owner or case owner can change it.');
      if (ifMatch !== a.rowVersion)
        throw new MockProblem('VERSION_CONFLICT', 'Someone saved a newer version.');
      const w = ws();
      const staleSnapshotIds: string[] = [];
      const invalidatedApprovalIds: string[] = [];
      const valueChanged = body.value !== undefined || body.valueText !== undefined;
      if (a.id === ADOPTION_ID && valueChanged) {
        w.adoptionVersion += 1;
        if (w.g2 === 'submitted' && !state.g2Decision) {
          setStale(true);
          staleSnapshotIds.push(G2_ID);
        } else if (state.g2Decision && !w.g2Invalidated) {
          w.g2Invalidated = true;
          invalidatedApprovalIds.push(G2_ID);
        }
      }
      const after = assumptionList().find((x) => x.id === a.id)!;
      return { assumption: after, staleSnapshotIds, invalidatedApprovalIds };
    }),
  ),

  mock(
    API.assumptions.replyToChallenge,
    persisting(({ params, body, viewerId }) => {
      const w = ws();
      if (params.id !== dispute(w).id) throw notFound();
      w.disputeReplies.push({ authorId: viewerId!, body: body.body, at: now() });
      return dispute(w);
    }),
  ),

  mock(
    API.assumptions.resolveChallenge,
    persisting(({ params, body, viewerId }) => {
      const w = ws();
      if (params.id !== dispute(w).id) throw notFound();
      if (viewerId !== people.daniel.id && viewerId !== people.elena.id)
        throw new MockProblem(
          'FORBIDDEN',
          'Only the reviewer who raised this challenge, or the sponsor, can resolve it.',
        );
      if (w.disputeResolved) throw new MockProblem('INVALID_TRANSITION', 'This dispute is already resolved.');
      w.disputeResolved = { by: viewerId, text: body.resolution, at: now() };
      return dispute(w);
    }),
  ),

  // ----- Experiments -----
  mock(API.experiments.list, ({ params }) => {
    const c = requireMe104(params.caseRef);
    if (c.key !== ME104.key) return { items: [], examples: [] };
    const e = experiment();
    return { items: e ? [e] : [], examples: e ? [] : [exampleExperiment()] };
  }),

  mock(
    API.experiments.create,
    persisting(({ params, body, viewerId }) => {
      const c = requireMe104(params.caseRef);
      if (c.key !== ME104.key) throw notFound();
      if (viewerId !== people.maya.id)
        throw new MockProblem('FORBIDDEN', 'Only the case owner creates validation experiments.');
      const w = ws();
      if (w.exp !== 'none')
        throw new MockProblem('INVALID_TRANSITION', 'EXP-03 already exists for this case.');
      w.exp = 'draft';
      w.expDraft = {
        title: body.title,
        plan: body.plan,
        assumptionIds: body.assumptionIds,
        fieldworkOwnerId: body.fieldworkOwnerId,
      };
      return experiment()!;
    }),
  ),

  mock(API.experiments.start, ({ params, viewerId }) => {
    assertExperimentEditor(viewerId);
    return requireExperiment(params.id);
  }),

  mock(
    API.experiments.amend,
    persisting(({ params, body, viewerId }) => {
      const e = requireExperiment(params.id);
      assertExperimentEditor(viewerId);
      if (e.lifecycle === 'draft')
        throw new MockProblem(
          'INVALID_TRANSITION',
          'Edit the draft directly; amendments apply to locked plans.',
        );
      const w = ws();
      w.amendments.push({
        reason: body.reason,
        plan: body.plan,
        at: now(),
        by: viewerId!,
        afterResultsSeen: hasResults(w),
      });
      return experiment()!;
    }),
  ),

  mock(
    API.experiments.recordResult,
    persisting(({ params, body, viewerId }) => {
      const e = requireExperiment(params.id);
      assertExperimentEditor(viewerId);
      if (e.lifecycle === 'draft')
        throw new MockProblem('INVALID_TRANSITION', 'Results are recorded after G1 locks the plan.');
      const w = ws();
      w.resultVersions.push({
        observations: body.observations.map((o) => ({ metricKey: o.metricKey, observed: o.observed })),
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        sourceText: body.sourceText,
        interpretation: body.interpretation,
        limitations: body.limitations,
        by: viewerId!,
        at: now(),
      });
      return experiment()!;
    }),
  ),

  mock(
    API.experiments.recordDecision,
    persisting(({ params, body, viewerId }) => {
      const e = requireExperiment(params.id);
      assertExperimentEditor(viewerId);
      if (!e.results.length)
        throw new MockProblem('INVALID_TRANSITION', 'Record results before the decision taken.');
      ws().decisionTaken = { text: body.decisionText, by: viewerId!, at: now() };
      return experiment()!;
    }),
  ),

  // ----- Validation tasks (honest sync) -----
  mock(
    API.taskSync.get,
    persisting(({ params }) => {
      const w = ws();
      if (params.id !== TASK_SET_ID || w.exp !== 'locked') throw notFound();
      const out = taskSet();
      // The simulated tool answers on the next poll: "Sending…" first, then "Confirmed · VAL-n".
      if (w.tasks === 'sending') w.tasks = 'sent';
      return out;
    }),
  ),

  mock(
    API.taskSync.preview,
    persisting(({ params, viewerId }) => {
      const w = ws();
      if (params.id !== TASK_SET_ID || w.exp !== 'locked') throw notFound();
      if (viewerId !== people.maya.id)
        throw new MockProblem('FORBIDDEN', 'Only the experiment owner creates validation tasks.');
      if (w.tasks === 'sent' || w.tasks === 'sending')
        throw new MockProblem('INVALID_TRANSITION', 'These tasks were already created.');
      // A preview is a dry run: it writes nothing and leaves every task "Not sent".
      w.previewId = PREVIEW_ID;
      return taskPreview();
    }),
  ),

  mock(
    API.taskSync.send,
    persisting(({ params, body, viewerId }) => {
      const w = ws();
      if (params.id !== TASK_SET_ID || w.exp !== 'locked') throw notFound();
      if (viewerId !== people.maya.id)
        throw new MockProblem('FORBIDDEN', 'Only the experiment owner creates validation tasks.');
      if (w.tasks === 'sent' || w.tasks === 'sending') return taskSet();
      if (body.previewId !== w.previewId || body.previewHash !== PREVIEW_HASH)
        throw new MockProblem(
          'PRECONDITIONS_UNMET',
          'The plan changed or the preview expired. Preview again.',
          {
            blockers: [
              { key: 'preview_current', message: 'The plan changed or the preview expired. Preview again.' },
            ],
          },
        );
      w.tasks = 'sending';
      return taskSet();
    }),
  ),
];
