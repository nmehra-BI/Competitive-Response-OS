/**
 * My Work mocks at the pilot moment (2 Dec 2026, pilot day 2 of 90): the viewer's pilot and
 * validation tasks from fixtures/aster with the prototype's task briefs, plus the review requests
 * assigned to them. Task status changes go through tasks.update (S11, owned by the pilot screen).
 */
import { API, type WorkItem } from '@growth-os/contracts';
import { cases, gates, people, pilotTasks, validationTasks } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { mock } from '../../mocks/define';
import { mockUuid } from '../mandate/mock-kit';
import { gateDecisionsAwaiting, reviewRequestsFor } from '../reviews/mocks';

const ME104 = cases[0];
const MILESTONE = ['M1 Kick-off', 'M2 Run and measure', 'M3 Review'];
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const STAY_INSIDE = [
  'Up to 4 sites · Germany · 1 Dec 2026 – 28 Feb 2027',
  `Budget ceiling €120k (G2 v3)`,
  'Outbound messages stay drafts — not authorized to send',
];
const dueText = (iso: string, rule: string | null) =>
  `${new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${rule ? ` · ${rule.toLowerCase()}` : ''}`;

/** Task briefs from the approved prototype (MyWork artboard), keyed by external task key. */
const BRIEF: Record<string, { why: string; done: string; measured: string; status: string; gate?: string }> =
  {
    'PIL-11': {
      why: 'The approved pilot is limited to the 4 sites with paid commitments (condition C1). Confirming them starts installation.',
      done: 'A signed site list with one contact per site, attached to the case.',
      measured: 'Feeds the paid-use and continuation threshold: 4 of 4 pilot customers.',
      status: 'In progress',
    },
    'PIL-14': {
      why: 'Deployment effort is a decision-critical assumption. Condition C2 asks for a weekly log per site.',
      done: 'One entry per site per week with hours and blockers.',
      measured: 'Deployment effort within the assumed [hours per site].',
      status: 'Not started',
      gate: 'G2 · v3 · condition C2',
    },
    'PIL-15': {
      why: 'Renewal intent and buyer fit are part of the day-90 review.',
      done: 'Interview notes per site in the case.',
      measured: 'Buyer fit (qualitative) and continuation.',
      status: 'Not started',
    },
  };

export function workItemsFor(viewerId: string | null): WorkItem[] {
  const pilot = pilotTasks
    .filter((t) => t.ownerId === viewerId)
    .map((t): WorkItem => {
      const b = BRIEF[t.externalKey];
      return {
        id: t.id, // a task work item carries the task id (tasks.update / tasks.reportBlocker)
        kind: 'task',
        title: t.title,
        caseId: ME104.id,
        caseKey: ME104.key,
        subtitle: `${ME104.key} · ${MILESTONE[t.milestone - 1]} · ${cap(t.function)}`,
        dueText: dueText(t.dueOn, t.dueRule),
        statusText: b?.status ?? 'Not started',
        href: `/me/cases/${ME104.key}/pilot?task=${t.externalKey}`,
        brief: {
          gateText: b?.gate ?? 'G2 · v3',
          syncText: `Confirmed · ${t.externalKey}`,
          why: b?.why ?? `Part of the approved pilot: ${gates.g2.buttonLabel}.`,
          doneLooksLike: b?.done ?? t.deliverable,
          stayInside: STAY_INSIDE,
          measuredAgainst: b?.measured ?? 'Day-90 review against pre-registered thresholds.',
        },
      };
    });
  const validation = validationTasks
    .filter((t) => t.ownerId === viewerId)
    .slice(0, 1)
    .map((t, i): WorkItem => ({
      id: mockUuid(31, i + 1),
      kind: 'task',
      title: t.title,
      caseId: ME104.id,
      caseKey: ME104.key,
      subtitle: `${ME104.key} · Validation · ${cap(t.function)}`,
      dueText: dueText(t.dueOn, null),
      statusText: 'Done',
      href: `/me/cases/${ME104.key}/validation?experiment=EXP-03`,
      brief: {
        gateText: 'G1 · v1',
        syncText: `Confirmed · ${t.externalKey}`,
        why: 'Validation outreach to 20 sites.',
        doneLooksLike: t.deliverable,
        stayInside: ['20 sites · Germany', 'Budget ceiling €15k (G1 v1)'],
        measuredAgainst: 'Interviews ≥ 8 · commitments ≥ 4.',
      },
    }));
  const reviews = reviewRequestsFor(viewerId)
    .filter((r) => r.status === 'open')
    .map((r, i): WorkItem => ({
      id: mockUuid(32, i + 1),
      kind: 'review_request',
      title: r.question,
      caseId: r.caseId,
      caseKey: r.caseKey,
      subtitle: `${r.caseKey} · ${cap(r.area)} review · requested by ${r.requestedBy.displayName}`,
      dueText: r.dueOn ? dueText(r.dueOn, null) : null,
      statusText: 'Awaiting your review',
      href: `/reviews?tab=${r.area === 'finance' ? 'economics' : 'assigned'}&request=${r.id}`,
      brief: {
        gateText: 'Review · not a gate decision',
        syncText: 'Internal only',
        why: `${r.requestedBy.displayName} needs your view before the next gate.`,
        doneLooksLike: 'Confirm, dispute or abstain, with a reason.',
        stayInside: r.whatToCheck,
        measuredAgainst: r.whatToCheck[r.whatToCheck.length - 1] ?? '',
      },
    }));
  return [...pilot, ...validation, ...reviews];
}

export const handlers: HttpHandler[] = [
  mock(API.work.myWork, ({ viewerId }) => {
    const items = workItemsFor(viewerId);
    const tasks = items.filter((i) => i.kind !== 'review_request');
    const approver = gateDecisionsAwaiting(viewerId).length > 0 || viewerId === people.elena.id;
    return {
      tabs: [
        { key: 'tasks', label: 'Tasks', count: tasks.length },
        { key: 'reviews', label: 'Reviews', count: items.length - tasks.length },
        { key: 'done', label: 'Done', count: tasks.filter((t) => t.statusText === 'Done').length },
      ],
      items,
      approvalsNotice: approver
        ? null
        : 'You approve nothing in this workspace. Gate decisions for BU Water are made by Elena Fischer. Owning tasks does not include approval rights.',
    };
  }),
];
