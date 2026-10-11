/**
 * MSW handlers for S09 Validation (WS8c): assumption register and dispute thread, EXP-03 create /
 * amend / results / decision, and validation tasks (preview → create → honest "Sending…" then
 * "Confirmed · VAL-n"). A change to the decision-critical adoption assumption marks an awaiting
 * G2 snapshot stale, or invalidates an effective approval (WS3 materiality rules).
 */
import { API } from '@growth-os/contracts';
import { assumptions, cases, people } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { adminConnections, findCase, personRef } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { state } from '../../mocks/state';
import { g2Package } from '../decisions/mock-data';
import { scoped } from '../mandate/mock-kit';
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
  taskDrafts,
  taskPreview,
  taskSet,
} from './mock-data';

const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');
/** taskSync.* is shared with the pilot mocks (PIL task set); these claim the VAL task set only. */
const ownsValidationTaskSet = (p: Record<string, string>) => p.id === TASK_SET_ID;
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
        // The contract names snapshot and approval ids (D-068), not the gate request id.
        if (w.g2 === 'submitted' && !state.g2Decision) {
          staleSnapshotIds.push(g2Package(null)!.snapshot.id);
          setStale(true);
        } else if (state.g2Decision && !w.g2Invalidated) {
          invalidatedApprovalIds.push(...g2Package(null)!.approvals.map((x) => x.id));
          w.g2Invalidated = true;
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
  scoped(
    API.taskSync.get,
    ownsValidationTaskSet,
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
  ),

  scoped(
    API.taskSync.preview,
    ownsValidationTaskSet,
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
  ),

  scoped(
    API.taskSync.send,
    ownsValidationTaskSet,
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
                {
                  key: 'preview_current',
                  message: 'The plan changed or the preview expired. Preview again.',
                },
              ],
            },
          );
        w.tasks = 'sending';
        return taskSet();
      }),
    ),
  ),

  // ----- S09 "Validation tasks · Draft" (D-113): edit, add or remove unsent tasks -----
  mock(API.taskSync.addDraftTask, ({ params, body, viewerId }) => {
    const set = requireDraftSet(params.id, viewerId);
    const d = taskDrafts();
    const ordinal = Math.max(0, ...set.tasks.map((t) => t.ordinal), ...d.added.map((t) => t.ordinal)) + 1;
    const base = set.tasks[0]!;
    d.added.push({
      ...base,
      id: `a57eb840-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
      ordinal,
      title: body.title,
      owner: personRef(body.ownerId),
      dueOn: body.dueOn,
      deliverable: body.deliverable,
      function: body.function ?? 'strategy',
      status: 'not_started',
      sync: { ...base.sync, status: 'not_sent', externalKey: null, attempts: 0, confirmedAt: null },
      rowVersion: 1,
    });
    return taskSet(viewerId);
  }),
  mock(API.taskSync.editDraftTask, ({ params, body, ifMatch, viewerId }) => {
    const set = requireDraftSet(TASK_SET_ID, viewerId);
    const t = requireUnsent(set.tasks.find((x) => x.id === params.id));
    if (ifMatch !== null && ifMatch !== t.rowVersion)
      throw new MockProblem('VERSION_CONFLICT', 'This draft changed since you opened it.');
    const d = taskDrafts();
    const next = {
      title: body.title ?? t.title,
      ownerId: body.ownerId ?? t.owner!.id,
      dueOn: body.dueOn !== undefined ? body.dueOn : t.dueOn,
      deliverable: body.deliverable ?? t.deliverable,
    };
    const added = d.added.find((x) => x.id === t.id);
    if (added)
      Object.assign(added, { ...next, owner: personRef(next.ownerId), rowVersion: t.rowVersion + 1 });
    else {
      d.edits.set(t.id, next);
      d.rowVersions.set(t.id, t.rowVersion + 1);
    }
    return taskSet(viewerId).tasks.find((x) => x.id === t.id)!;
  }),
  mock(API.taskSync.removeDraftTask, ({ params, ifMatch, viewerId }) => {
    const set = requireDraftSet(TASK_SET_ID, viewerId);
    const t = requireUnsent(set.tasks.find((x) => x.id === params.id));
    if (ifMatch !== null && ifMatch !== t.rowVersion)
      throw new MockProblem('VERSION_CONFLICT', 'This draft changed since you opened it.');
    const d = taskDrafts();
    d.added = d.added.filter((x) => x.id !== t.id);
    d.removed.add(t.id);
    return taskSet(viewerId);
  }),
];

// ----- S14 task mapping editor (D-114 §1; E4). Collected with every screen's handlers. -----
const MAPPED_PEOPLE = [people.maya, people.jonas, people.opsLead];
const NOT_IN_PROJECT = new Set<string>([people.opsLead.email]);

function mappingCheck(
  id: string,
  body: {
    destinationProject: string;
    issueType: string;
    purpose: string;
    assigneeMap: Record<string, string>;
  },
) {
  const m = adminConnections().mappings.find((x) => x.id === id);
  if (!m) throw notFound();
  const moved = body.destinationProject !== m.destinationProject || body.issueType !== m.issueType;
  return {
    mappingId: id,
    project: { key: body.destinationProject, name: null, found: true },
    issueType: { name: body.issueType, found: true },
    assignees: MAPPED_PEOPLE.map((p) => {
      const account = body.assigneeMap[p.id] ?? null;
      const notFoundHere = !!account && NOT_IN_PROJECT.has(account);
      return {
        userId: p.id,
        person: personRef(p.id),
        roleText:
          p.id === people.maya.id ? 'Case owner' : p.id === people.jonas.id ? 'Pilot owner' : 'Operations',
        externalAccount: account,
        status: !account
          ? ('unmapped' as const)
          : notFoundHere
            ? ('not_found' as const)
            : ('mapped' as const),
        message: !account
          ? 'No account in the task tool'
          : notFoundHere
            ? `assignee ${account} is not a member of project ${body.destinationProject}`
            : null,
      };
    }),
    impact:
      moved && body.purpose === 'pilot_tasks'
        ? {
            material: true,
            changeType: 'plan_destination_changed' as const,
            lines: ['Approval G2 · Snapshot v3 needs re-approval', '6 unsent tasks pause'],
            affectedGateRequestIds: [],
          }
        : null,
    connectionStatus: 'connected' as const,
    checkedAt: now(),
  };
}

export const mappingHandlers: HttpHandler[] = [
  mock(API.admin.checkMapping, ({ params, body }) => mappingCheck(params.id, body)),
  mock(API.admin.setMapping, ({ params, body }) => {
    const c = mappingCheck(params.id, body);
    if (c.impact && !body.acknowledgeMaterialImpact)
      throw new MockProblem('PRECONDITIONS_UNMET', 'Review the impact and confirm it.', {
        blockers: c.impact.lines.map((message, i) => ({ key: `impact-${i + 1}`, message })),
      });
    const { acknowledgeMaterialImpact: _ack, ...rest } = body;
    return { id: params.id, ...rest };
  }),
];
handlers.push(...mappingHandlers);

function requireDraftSet(id: string, viewerId: string | null) {
  const w = ws();
  if (id !== TASK_SET_ID || w.exp !== 'locked') throw notFound();
  const set = taskSet(viewerId);
  if (!set.draftEditable)
    throw new MockProblem('FORBIDDEN', 'Only the experiment owner or the case owner edits draft tasks.');
  return set;
}

function requireUnsent<T extends { sync: { status: string } }>(t: T | undefined): T {
  if (!t) throw notFound();
  if (t.sync.status !== 'not_sent' && t.sync.status !== 'in_preview')
    throw new MockProblem('INVALID_TRANSITION', 'This task was sent to the task tool and is read-only here.');
  return t;
}
