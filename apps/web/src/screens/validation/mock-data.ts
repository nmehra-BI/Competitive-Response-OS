/**
 * View-model builders for the S09 Validation mocks (WS8c): assumption register, EXP-03 with its
 * pre-registered plan, amendments and append-only results, and the validation task set.
 * Values come from fixtures/aster (PRD §6); journey moments from `../decisions/mock-state`.
 */
import type {
  Assumption,
  Challenge,
  Experiment,
  ExperimentPlan,
  ExperimentPlanVersion,
  ExperimentResultVersion,
  MetricObservation,
  RegisterGroup,
  Task,
  TaskSet,
  TaskSyncPreview,
  ThresholdResult,
} from '@growth-os/contracts';
import {
  adoptionDispute,
  assumptions,
  cases,
  connections,
  exp03,
  fid,
  gates,
  journeyMoments as J,
  people,
  sources,
  validationTasks,
} from '@growth-os/fixtures-aster';
import { hashFor, personRef, P } from '../../mocks/data';
import { hasResults, ws, type Ws8cState } from '../decisions/mock-state';
import { assumptionDisputes, scenario as assessmentScenario } from '../sizing/mock-state';

const ME104 = cases[0];
export const EXP_ID = exp03.id;
export const TASK_SET_ID = fid('taskSet', 1);
export const PREVIEW_ID = fid('taskSet', 51);
export const PREVIEW_HASH = hashFor('A11C·0005');
const JIRA = connections.find((c) => c.kind === 'task_tool')!;
const SENT_AT = '2026-10-16T14:20:00+02:00';

// ---------------------------------------------------------------------------
// Assumption register
// ---------------------------------------------------------------------------

/** Register group from sensitivity, then evidence quality (no combined score). */
export function registerGroupOf(sensitivity: string, quality: string): RegisterGroup {
  const weak = quality === 'weak' || quality === 'none' || quality === 'conflicting';
  if (sensitivity === 'high') return weak ? 'test_first' : 'test_next';
  return weak ? 'watch' : 'monitor';
}

type AsmFx = (typeof assumptions)[number];

function statusFor(a: AsmFx, w: Ws8cState): { status: Assumption['status']; detail: string | null } {
  const res = hasResults(w);
  const sent = w.tasks === 'sent';
  switch (a.key) {
    case 'ASM-01':
      return res
        ? { status: 'testing', detail: 'pilot next' }
        : { status: sent ? 'testing' : 'untested', detail: null };
    case 'ASM-04':
      return res
        ? { status: 'supported', detail: '4 paid commitments' }
        : { status: sent ? 'testing' : 'untested', detail: null };
    case 'ASM-06':
      return { status: 'testing', detail: 'review due 20 Nov' };
    case 'ASM-07':
      return res ? { status: 'supported', detail: 'demo 21 Oct' } : { status: 'testing', detail: null };
    case 'ASM-05':
      return res ? { status: 'supported', detail: 'partner list' } : { status: 'testing', detail: null };
    default:
      return { status: a.status, detail: null };
  }
}

const USED_BY: Record<string, { label: string; href: string }[]> = {
  'ASM-01': [
    { label: 'SOM', href: `/me/cases/${ME104.key}/sizing?input=adoption-rate` },
    { label: 'Economics', href: `/me/cases/${ME104.key}/economics?input=adoption-rate` },
    { label: 'G2 package', href: `/me/cases/${ME104.key}/decisions?gate=G2` },
  ],
};

export function dispute(w: Ws8cState): Challenge {
  return {
    id: adoptionDispute.id,
    kind: 'dispute',
    targetType: 'assumption',
    targetId: assumptions[0].id,
    caseId: ME104.id,
    raisedBy: personRef(adoptionDispute.raisedBy),
    statement: adoptionDispute.statement,
    proposedValue: adoptionDispute.proposedValue,
    status: w.disputeResolved ? 'resolved' : 'open',
    resolution: w.disputeResolved?.text ?? null,
    resolvedBy: w.disputeResolved ? personRef(w.disputeResolved.by) : null,
    resolvedAt: w.disputeResolved?.at ?? null,
    createdAt: adoptionDispute.raisedAt,
    replies: [
      ...adoptionDispute.replies.map((r, i) => ({
        id: fid('challenge', 100 + i),
        author: personRef(r.authorId),
        body: r.body,
        createdAt: r.at,
      })),
      ...w.disputeReplies.map((r, i) => ({
        id: fid('challenge', 200 + i),
        author: personRef(r.authorId),
        body: r.body,
        createdAt: r.at,
      })),
    ],
  };
}

/**
 * The open dispute shown on an assumption row. The fixture dispute (Daniel on 20% adoption) is
 * WS8c journey state (replies, resolution); the assessment mocks (WS8b) can switch it off for the
 * moment before step 9 (`adoptionDisputed: false`) and add disputes raised on S08.
 */
function openDisputeFor(a: (typeof assumptions)[number], w: Ws8cState): Challenge | null {
  const fixtureOn = a.key === 'ASM-01' && a.disputed && assessmentScenario().adoptionDisputed !== false;
  if (fixtureOn) return dispute(w);
  return (
    assumptionDisputes().find(
      (c) => c.id !== adoptionDispute.id && c.targetId === a.id && c.status === 'open',
    ) ?? null
  );
}

/**
 * The one assumption register for ME-104 (S08, S09, S10 read it). Shared by the WS8b and WS8c
 * mocks so a dispute raised on S08 shows on S09 and a reply on S09 shows on S08.
 */
export function assumptionList(): Assumption[] {
  const w = ws();
  const linked = w.exp === 'none' ? [] : experimentLinks(w);
  return assumptions.map((a) => {
    const st = statusFor(a, w);
    const n = Number(a.key.slice(4));
    const version = a.key === 'ASM-01' ? w.adoptionVersion : 1;
    const fx = a as AsmFx & { valueText?: string; currency?: string; priceYear?: number };
    return {
      id: a.id,
      key: a.key,
      caseId: ME104.id,
      inputKey: a.inputKey,
      name: a.name,
      scenario: a.scenario,
      owner: personRef(a.ownerId),
      sensitivity: a.sensitivity,
      decisionCritical: a.decisionCritical,
      consequenceIfFalse: a.consequenceIfFalse,
      validationMethod: a.validationMethod,
      linkedExperimentIds: linked.includes(a.id) ? [EXP_ID] : [],
      dueOn: a.dueOn,
      status: st.status,
      statusDetail: st.detail,
      retiredReason: null,
      current: {
        id: version > 1 ? fid('assumptionVersion', 100 + version - 1) : fid('assumptionVersion', n),
        assumptionId: a.id,
        version,
        value: a.value,
        valueText: fx.valueText ?? null,
        unit: a.unit,
        currency: (fx.currency as 'EUR' | undefined) ?? null,
        priceYear: fx.priceYear ?? null,
        basis: a.basis,
        evidenceQuality: a.evidenceQuality,
        sources:
          a.key === 'ASM-05'
            ? sources
                .filter((s) => s.key === 'SRC-040')
                .map((s) => ({
                  sourceId: s.id,
                  key: s.key,
                  label: s.chipLabel,
                  quality: s.quality,
                  restricted: false,
                }))
            : [],
        origin: 'human',
        agentRunId: null,
        changeReason: version > 1 ? 'Base adoption updated after review' : null,
        createdBy: personRef(a.ownerId),
        createdAt: version > 1 ? gates.g2.staleVariant.changedAt : J.sizingCommitted,
      },
      registerGroup: registerGroupOf(a.sensitivity, a.evidenceQuality),
      openDispute: openDisputeFor(a, w),
      usedBy: USED_BY[a.key] ?? [],
      rowVersion: version,
    };
  });
}

// ---------------------------------------------------------------------------
// EXP-03
// ---------------------------------------------------------------------------

function experimentLinks(w: Ws8cState): string[] {
  if (w.expDraft) return w.expDraft.assumptionIds;
  return exp03.linkedAssumptionKeys.map((k) => assumptions.find((a) => a.key === k)!.id);
}

function originalPlan(w: Ws8cState): ExperimentPlan {
  if (w.expDraft) return w.expDraft.plan;
  const p = exp03.originalPlan;
  return {
    hypothesis: p.hypothesis,
    method: p.method,
    sampleText: p.sampleText,
    sampleSize: p.sampleSize,
    selectionText: p.selectionText,
    nonresponseNote: p.nonresponseNote,
    windowStart: p.windowStart,
    windowEnd: p.windowEnd,
    budgetAmount: p.budgetAmount,
    currency: p.currency,
    budgetNote: p.budgetNote,
    metrics: p.metrics.map((m) => ({ ...m })),
    decisionRules: p.decisionRules.map((r) => ({ ...r })),
  };
}

function lockedAt(w: Ws8cState): string | null {
  if (w.exp !== 'locked') return null;
  return w.g1Decision?.at ?? exp03.lockedAt;
}

function compare(observed: string, operator: string, threshold: string): ThresholdResult {
  // Mock-only comparison on small counts; the real engine compares decimals.
  const o = Number(observed);
  const t = Number(threshold);
  const ok =
    operator === 'gte'
      ? o >= t
      : operator === 'gt'
        ? o > t
        : operator === 'lte'
          ? o <= t
          : operator === 'lt'
            ? o < t
            : operator === 'eq'
              ? o === t
              : null;
  return ok === null ? 'inconclusive' : ok ? 'met' : 'not_met';
}

export function experiment(): Experiment | null {
  const w = ws();
  if (w.exp === 'none') return null;
  const locked = w.exp === 'locked';
  const plan = originalPlan(w);
  const createdAt = '2026-10-14T15:00:00+02:00';
  const v1: ExperimentPlanVersion = {
    id: fid('experiment', 201),
    experimentId: EXP_ID,
    version: 1,
    isOriginal: locked,
    plan,
    createdBy: P('maya'),
    createdAt,
  };
  let current = v1;
  const amendments = w.amendments.map((a, i) => {
    const from = current;
    current = {
      id: fid('experiment', 202 + i),
      experimentId: EXP_ID,
      version: from.version + 1,
      isOriginal: false,
      plan: { ...from.plan, ...a.plan },
      createdBy: personRef(a.by),
      createdAt: a.at,
    };
    const changedFields = (Object.keys(a.plan) as (keyof ExperimentPlan)[]).filter(
      (k) => JSON.stringify(a.plan[k]) !== JSON.stringify(from.plan[k]),
    );
    return {
      id: fid('experiment', 301 + i),
      number: i + 1,
      fromPlanVersion: from.version,
      toPlanVersion: current.version,
      reason: a.reason,
      changedFields,
      thresholdsChanged: changedFields.includes('metrics'),
      afterResultsSeen: a.afterResultsSeen,
      author: personRef(a.by),
      createdAt: a.at,
    };
  });
  const metrics = current.plan.metrics;
  const results: ExperimentResultVersion[] = w.resultVersions.map((r, i) => ({
    id: fid('experiment', 103 + i),
    experimentId: EXP_ID,
    version: i + 1,
    observations: metrics.map((m): MetricObservation => {
      const o = r.observations.find((x) => x.metricKey === m.metricKey);
      const observed = o?.observed ?? null;
      return {
        metricKey: m.metricKey,
        observed,
        observedText: observed ?? 'Not recorded',
        result:
          observed === null || m.thresholdValue === null
            ? 'inconclusive'
            : compare(observed, m.operator, m.thresholdValue),
      };
    }),
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    sourceText: r.sourceText,
    interpretation: r.interpretation,
    limitations: r.limitations,
    recordedBy: personRef(r.by),
    recordedAt: r.at,
  }));
  const latest = results[results.length - 1];
  const displayResult: Experiment['displayResult'] = !locked
    ? 'planned'
    : !latest
      ? 'too_early_to_read'
      : latest.observations.every((o) => o.result === 'met')
        ? 'met'
        : latest.observations.some((o) => o.result === 'not_met')
          ? 'not_met'
          : 'inconclusive';
  return {
    id: EXP_ID,
    key: exp03.key,
    caseId: ME104.id,
    title: w.expDraft?.title ?? exp03.title,
    lifecycle: !locked ? 'draft' : latest ? 'result_recorded' : 'running',
    displayResult,
    owner: P('maya'),
    fieldworkOwner: w.expDraft
      ? w.expDraft.fieldworkOwnerId
        ? personRef(w.expDraft.fieldworkOwnerId)
        : null
      : personRef(exp03.fieldworkOwnerId),
    dueOn: current.plan.windowEnd,
    linkedAssumptionIds: experimentLinks(w),
    lockedByGateRequestId: locked ? gates.g1.id : null,
    lockedAt: lockedAt(w),
    original: locked ? v1 : null,
    current,
    amendments,
    results,
    decisionTaken: w.decisionTaken
      ? { text: w.decisionTaken.text, by: personRef(w.decisionTaken.by), at: w.decisionTaken.at }
      : null,
    taskSetId: locked ? TASK_SET_ID : null,
    illustrative: false,
  };
}

/** Example shown in the empty state; marked illustrative and never counted. */
export function exampleExperiment(): Experiment {
  const w = { ...ws(), expDraft: null, exp: 'draft' as const, amendments: [], resultVersions: [] };
  const plan = originalPlan(w);
  return {
    id: fid('experiment', 900),
    key: 'EXP-EX1',
    caseId: ME104.id,
    title: 'Example · validation outreach with pre-registered thresholds',
    lifecycle: 'draft',
    displayResult: 'planned',
    owner: P('maya'),
    fieldworkOwner: null,
    dueOn: plan.windowEnd,
    linkedAssumptionIds: [],
    lockedByGateRequestId: null,
    lockedAt: null,
    original: null,
    current: {
      id: fid('experiment', 901),
      experimentId: fid('experiment', 900),
      version: 1,
      isOriginal: false,
      plan,
      createdBy: P('maya'),
      createdAt: '2026-10-14T15:00:00+02:00',
    },
    amendments: [],
    results: [],
    decisionTaken: null,
    taskSetId: null,
    illustrative: true,
  };
}

// ---------------------------------------------------------------------------
// Validation tasks (ME-VAL)
// ---------------------------------------------------------------------------

export function taskSet(): TaskSet {
  const w = ws();
  const done = hasResults(w);
  const tasks: Task[] = validationTasks.map((t) => {
    const confirmed = w.tasks === 'sent';
    return {
      id: fid('task', 100 + t.ordinal),
      caseId: ME104.id,
      taskSetId: TASK_SET_ID,
      ordinal: t.ordinal,
      title: t.title,
      milestoneId: null,
      milestoneLabel: null,
      function: t.function,
      owner: personRef(t.ownerId),
      dependsOnTaskIds: [],
      dependsOnLabel: '—',
      dueOn: t.dueOn,
      dueRule: null,
      deliverable: t.deliverable,
      conditionKey: null,
      status: done ? 'done' : confirmed ? 'in_progress' : 'not_started',
      sync: {
        status:
          w.tasks === 'sent'
            ? 'confirmed'
            : w.tasks === 'sending'
              ? 'sending'
              : w.tasks === 'preview'
                ? 'in_preview'
                : 'not_sent',
        connectionId: JIRA.id,
        externalKey: confirmed ? t.externalKey : null,
        externalUrl: null,
        attempts: confirmed || w.tasks === 'sending' ? 1 : 0,
        lastErrorCode: null,
        lastErrorMessage: null,
        retryable: false,
        confirmedAt: confirmed ? SENT_AT : null,
      },
      rowVersion: 1,
    };
  });
  const confirmed = tasks.filter((t) => t.sync.status === 'confirmed').length;
  const pending = tasks.length - confirmed;
  return {
    id: TASK_SET_ID,
    caseId: ME104.id,
    ownerType: 'experiment',
    ownerId: EXP_ID,
    authorizingGateRequestId: gates.g1.id,
    connectionId: JIRA.id,
    destinationLabel: 'Jira · project ME-VAL',
    tasks,
    summary: { total: tasks.length, confirmed, failed: 0, pending, paused: 0 },
    summaryText:
      w.tasks === 'sent'
        ? `${confirmed} of ${tasks.length} tasks confirmed in Jira`
        : w.tasks === 'sending'
          ? `Sending ${tasks.length} tasks to Jira · ${confirmed} of ${tasks.length} confirmed`
          : w.tasks === 'preview'
            ? 'Preview · nothing sent yet'
            : `${tasks.length} validation tasks · not sent`,
  };
}

export function taskPreview(): TaskSyncPreview {
  const set = taskSet();
  return {
    id: PREVIEW_ID,
    taskSetId: TASK_SET_ID,
    planVersionId: null,
    contentHash: PREVIEW_HASH,
    destination: { tool: 'Jira', project: 'ME-VAL', projectName: null },
    willCreate: set.tasks.length,
    linkText: `each linked to ${ME104.key} · EXP-03`,
    assigneesText: 'assignees mapped by email',
    permissionsText: 'permission: create issues',
    repeatsText: 'Each task has a fixed reference; retrying never duplicates',
    items: set.tasks.map((t) => ({
      taskId: t.id,
      title: t.title,
      assignee: t.owner?.displayName ?? null,
      fields: { due: t.dueOn ?? '', deliverable: t.deliverable },
    })),
    problems: [],
    connectionStatus: 'connected',
    createdAt: '2026-10-16T14:15:00+02:00',
    expiresAt: '2026-10-16T15:15:00+02:00',
  };
}

export { people };
