/**
 * My Work: the viewer's tasks, experiments, conditions, review requests and gate decisions, with the
 * task brief (what authorizes it, sync status, scope to stay inside, what it is measured against).
 * Task ownership never grants approval; the notice says so to people who approve nothing.
 */
import {
  API,
  GATE_STATUS_LABELS,
  SYNC_STATUS_LABELS,
  type GateStatus,
  type WorkItem,
} from '@growth-os/contracts';
import { canReadCase, matchingRole, signedIn } from '../../../platform/authz';
import { query, type HandlerMap } from '../../../platform/pipeline';
import { caseById, shortDate, subjectOf, type CaseLite } from '../../me/gates/lib/common';
import { awaitingDecisions } from '../../me/gates/lib/inbox';
import { scopeOf, gateById } from '../../me/gates/lib/serialize';
import { myReviewRequests } from '../reviews';

const NOTICE =
  'You approve nothing in this workspace. Gate decisions belong to the sponsor and the investment committee.';

export const workHandlers: HandlerMap = {
  [API.work.myWork.id]: query(API.work.myWork, {
    authorize: () => signedIn,
    handle: async (ctx, { tx }) => {
      const subject = subjectOf(ctx);
      const uid = ctx.userId;
      const caseCache = new Map<string, CaseLite | null>();
      const visibleCase = async (id: string) => {
        if (!caseCache.has(id)) {
          const c = await caseById(tx, id);
          caseCache.set(id, c && canReadCase(subject, c) ? c : null);
        }
        return caseCache.get(id) ?? null;
      };
      const tasksTab: WorkItem[] = [];
      const reviewsTab: WorkItem[] = [];
      const doneTab: WorkItem[] = [];

      const tasks = await tx
        .selectFrom('platform.task as t')
        .innerJoin('platform.task_set as s', 's.id', 't.task_set_id')
        .leftJoin('platform.milestone as m', 'm.id', 't.milestone_id')
        .leftJoin('platform.external_task_link as l', 'l.task_id', 't.id')
        .select([
          't.id',
          't.case_id',
          't.title',
          't.ordinal',
          't.status',
          't.function',
          't.due_on',
          't.due_rule',
          't.deliverable',
          's.authorizing_gate_request_id',
          's.owner_type',
          's.owner_id',
          'm.name as milestone',
          'l.sync_status',
          'l.external_key',
        ])
        .where('t.owner_user_id', '=', uid)
        .orderBy('t.due_on')
        .execute();
      for (const t of tasks) {
        const c = await visibleCase(t.case_id);
        if (!c) continue;
        const gate = await gateById(tx, t.authorizing_gate_request_id);
        const scope = gate ? scopeOf(gate) : null;
        const plan =
          t.owner_type === 'pilot_plan_version'
            ? await tx
                .selectFrom('me.pilot_plan_version')
                .select('thresholds_text')
                .where('id', '=', t.owner_id)
                .executeTakeFirst()
            : undefined;
        const fn = t.function.charAt(0).toUpperCase() + t.function.slice(1);
        const item: WorkItem = {
          id: t.id,
          kind: 'task',
          title: t.title,
          caseId: c.id,
          caseKey: c.key,
          subtitle: [c.key, t.milestone, fn].filter(Boolean).join(' · '),
          dueText: t.due_rule ?? (t.due_on ? `Due ${shortDate(String(t.due_on).slice(0, 10))}` : null),
          statusText: t.status.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()),
          href: `/me/cases/${c.key}/${t.owner_type === 'experiment' ? 'validation' : 'pilot'}?task=${t.id}`,
          brief: {
            gateText: gate
              ? `Authorized by ${gate.display_key} · ${GATE_STATUS_LABELS[(gate.status === 'stale' ? 'awaiting_decision' : gate.status) as GateStatus] ?? gate.status}`
              : 'No authorizing gate',
            syncText: t.sync_status
              ? t.sync_status === 'confirmed' && t.external_key
                ? `Confirmed · ${t.external_key}`
                : SYNC_STATUS_LABELS[t.sync_status as 'not_sent']
              : 'Not sent to the task tool',
            why: `Task ${t.ordinal} of the ${t.owner_type === 'experiment' ? 'validation' : 'pilot'} plan for ${c.key}`,
            doneLooksLike: t.deliverable,
            stayInside: scope ? [...scope.authorizes, ...scope.doesNotAuthorize] : [],
            measuredAgainst: plan?.thresholds_text.join('; ') || 'The pre-registered thresholds of the plan',
          },
        };
        (t.status === 'done' ? doneTab : tasksTab).push(item);
      }

      const exps = await tx
        .selectFrom('me.experiment')
        .select(['id', 'case_id', 'display_key', 'title', 'lifecycle'])
        .where('owner_user_id', '=', uid)
        .where('lifecycle', 'in', ['locked', 'running'])
        .execute();
      for (const e of exps) {
        const c = await visibleCase(e.case_id);
        if (!c) continue;
        tasksTab.push({
          id: e.id,
          kind: 'experiment',
          title: `${e.display_key} · ${e.title}`,
          caseId: c.id,
          caseKey: c.key,
          subtitle: `${c.key} · Validation`,
          dueText: null,
          statusText: e.lifecycle === 'running' ? 'Running' : 'Locked · ready to start',
          href: `/me/cases/${c.key}/validation?experiment=${e.id}`,
          brief: null,
        });
      }

      const conds = await tx
        .selectFrom('platform.condition as k')
        .innerJoin('platform.gate_request as g', 'g.id', 'k.gate_request_id')
        .select([
          'k.id',
          'k.key',
          'k.text',
          'k.status',
          'k.due_on',
          'k.due_rule',
          'k.blocks_execution',
          'g.case_id',
          'g.display_key',
        ])
        .where('k.owner_user_id', '=', uid)
        .execute();
      for (const k of conds) {
        if (!k.case_id) continue;
        const c = await visibleCase(k.case_id);
        if (!c) continue;
        const item: WorkItem = {
          id: k.id,
          kind: 'condition',
          title: `${k.key} · ${k.text}`,
          caseId: c.id,
          caseKey: c.key,
          subtitle: `${c.key} · ${k.display_key} · ${k.blocks_execution ? 'Blocks execution until met' : 'Monitor only'}`,
          dueText: k.due_rule ?? (k.due_on ? `Due ${shortDate(String(k.due_on).slice(0, 10))}` : null),
          statusText: k.status === 'open' ? 'Open' : k.status === 'met' ? 'Met' : 'Waived',
          href: `/me/cases/${c.key}/pilot`,
          brief: null,
        };
        (k.status === 'open' ? tasksTab : doneTab).push(item);
      }

      for (const r of await myReviewRequests(tx, subject, uid)) {
        const c = (await visibleCase(r.case_id))!;
        const item: WorkItem = {
          id: r.id,
          kind: 'review_request',
          title: r.question,
          caseId: c.id,
          caseKey: c.key,
          subtitle: `${c.key} · ${r.area} review`,
          dueText: r.due_on ? `Due ${shortDate(String(r.due_on).slice(0, 10))}` : null,
          statusText: r.status === 'open' ? 'Awaiting your review' : `Answered · ${r.response}`,
          href: `/reviews?request=${r.id}`,
          brief: null,
        };
        (r.status === 'open' ? reviewsTab : doneTab).push(item);
      }

      for (const d of await awaitingDecisions(tx, subject, uid)) {
        if (!d.caseId) continue;
        reviewsTab.push({
          id: d.gateRequestId,
          kind: 'gate_decision',
          title: d.buttonLabel,
          caseId: d.caseId,
          caseKey: d.caseKey,
          subtitle: `${d.caseKey} · Awaiting your decision`,
          dueText: d.dueText,
          statusText: 'Awaiting decision',
          href: d.href,
          brief: null,
        });
      }

      const tab = ctx.query.tab ?? 'tasks';
      const decides = subject.roles.some(
        (r) => r.revokedAt === null && (r.role === 'sponsor' || r.role === 'investment_committee'),
      );
      return {
        tabs: [
          { key: 'tasks', label: 'Tasks', count: tasksTab.length },
          { key: 'reviews', label: 'Reviews', count: reviewsTab.length },
          { key: 'done', label: 'Done', count: doneTab.length },
        ],
        items: tab === 'reviews' ? reviewsTab : tab === 'done' ? doneTab : tasksTab,
        approvalsNotice:
          decides || matchingRole(subject, 'gate.decide', { businessUnitId: null, caseId: null })
            ? null
            : NOTICE,
      };
    },
  }),
};
