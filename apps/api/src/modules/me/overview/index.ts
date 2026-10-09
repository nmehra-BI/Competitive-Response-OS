/**
 * Portfolio overview (S01). Only accessible cases are counted; hidden cases are never counted or named.
 * Market sizes are never totalled across cases; budgets are listed per gate (one-time budgets only)
 * and never added to annual figures; spent-to-date stays "Not available" without a finance feed.
 */
import {
  API,
  GATE_STATUS_LABELS,
  type ActivityItem,
  type CaseStage,
  type GateCode,
  type PortfolioOverview,
} from '@growth-os/contracts';
import { readAudit } from '../../../platform/audit-read';
import { query, type HandlerMap } from '../../../platform/pipeline';
import { isoDateTime, isoDateTimeOrNull } from '../../../platform/serialize';
import { asOf, caseHref, policy, shortDate, subjectAt } from '../cases/access';
import { accessibleCases } from '../cases';
import { buttonLabel, displayStatus, scopeOf } from '../gates/lib/serialize';
import { buildListRow } from '../cases/read';

const GATE_NAME: Record<GateCode, string> = {
  G0: 'Scope',
  G1: 'Validation',
  G2: 'Pilot',
  G3: 'Scale',
  X: 'Extension',
};
const KEY = /gate|stage_changed|case\.created|stop|decision|seed\.(gate|case_converted)/;

export const overviewHandlers: HandlerMap = {
  [API.overview.portfolio.id]: query(API.overview.portfolio, {
    authorize: () => ({ allow: true, rule: 'overview.portfolio', authorityGrantId: null }),
    handle: async (ctx, { tx }): Promise<PortfolioOverview> => {
      const acc = await accessibleCases(tx, ctx.identity);
      const cases = acc.cases.filter(
        (c) => !ctx.query.businessUnitId || c.business_unit_id === ctx.query.businessUnitId,
      );
      const ids = cases.map((c) => c.id);
      const stages = new Map<CaseStage, number>();
      for (const c of cases) stages.set(c.stage as CaseStage, (stages.get(c.stage as CaseStage) ?? 0) + 1);
      const gates = ids.length
        ? await tx
            .selectFrom('platform.gate_request')
            .selectAll()
            .where('case_id', 'in', ids)
            .orderBy('created_at')
            .execute()
        : [];
      const subject = subjectAt(ctx.identity, ctx.now);
      const decisions: PortfolioOverview['decisionsAwaitingViewer'] = [];
      for (const g of gates.filter((x) => x.status === 'awaiting_decision')) {
        const c = cases.find((x) => x.id === g.case_id)!;
        const snap = g.current_snapshot_id
          ? await tx
              .selectFrom('platform.decision_snapshot')
              .select(['version', 'created_by'])
              .where('id', '=', g.current_snapshot_id)
              .executeTakeFirst()
          : undefined;
        const panel = policy.approvalPanel(subject, {
          type: 'gate_request',
          id: g.id,
          businessUnitId: g.business_unit_id,
          caseId: c.id,
          facts: {
            caseOwnerId: c.owner_user_id,
            sponsorId: c.sponsor_user_id,
            packageAuthorId: snap?.created_by,
            gateCode: g.gate_code as GateCode,
            requestedAmount: g.requested_amount,
            currency: g.currency,
          },
        });
        if (!panel.canDecide) continue;
        decisions.push({
          gateRequestId: g.id,
          caseKey: c.display_key,
          buttonLabel: buttonLabel(g.gate_code as GateCode, scopeOf(g)),
          snapshotVersion: snap?.version ?? 1,
          dueText: g.submitted_at ? `Submitted ${shortDate(g.submitted_at)}` : 'Awaiting decision',
          href: caseHref(c.display_key, 'decision'),
        });
      }
      const spendRows = gates
        .filter((g) => g.requested_amount !== null && g.currency !== null && g.gate_code !== 'G0')
        .map((g) => {
          const c = cases.find((x) => x.id === g.case_id)!;
          const status = displayStatus(g, { allMet: true, metCount: 1 });
          const approved = g.status === 'approved' || g.status === 'approved_with_conditions';
          return {
            caseKey: c.display_key,
            gateLabel: `${g.gate_code} · ${GATE_NAME[g.gate_code as GateCode]}${g.duration_days ? ` · ${g.duration_days} days` : ''}`,
            statusText: GATE_STATUS_LABELS[status],
            amount: {
              amount: g.requested_amount!,
              currency: g.currency!,
              measure: approved ? ('approved_budget' as const) : ('requested_budget' as const),
              timeBasis: 'budget' as const,
            },
          };
        });
      const finance = await tx
        .selectFrom('platform.connection')
        .select(['status', 'name'])
        .where('kind', '=', 'finance')
        .executeTakeFirst();
      const today = asOf(ctx.now, ctx.identity.tenant.timeZone);
      const overdue = ids.length
        ? await tx
            .selectFrom('platform.assumption')
            .select(['display_key', 'name', 'due_on', 'case_id'])
            .where('case_id', 'in', ids)
            .where('status', 'in', ['untested', 'testing'])
            .where('due_on', '<', today as never)
            .orderBy('due_on')
            .execute()
        : [];
      const events = (await Promise.all(cases.map((c) => readAudit(tx, { caseId: c.id, limit: 20 }))))
        .flat()
        .filter((e) => KEY.test(e.action))
        .sort((a, b) => b.seq - a.seq)
        .slice(0, 10);
      const conns = await tx.selectFrom('platform.connection').selectAll().orderBy('name').execute();
      return {
        scope: acc.scope,
        businessUnits: acc.businessUnits.map((b) => ({ id: b.id, name: b.name, accessible: b.accessible })),
        casesByStage: [...stages.entries()].map(([stage, count]) => ({ stage, count })),
        decisionsAwaitingViewer: decisions,
        spend: {
          rows: spendRows,
          spentToDate: {
            unavailable: true,
            reason:
              finance && finance.status !== 'connected'
                ? `${finance.name} connection ${finance.status.replace(/_/g, ' ')}`
                : 'Spent-to-date is recorded per case on the Pilot tab',
            missingInputs: [],
          },
          note: 'Budgets are one-time amounts per gate. They are never added to annual market or revenue figures.',
        },
        overdueValidation: overdue.map((a) => {
          const c = cases.find((x) => x.id === a.case_id)!;
          return {
            title: `${a.display_key} · ${a.name}`,
            caseKey: c.display_key,
            dueText: `Due ${shortDate(String(a.due_on))}`,
            href: caseHref(c.display_key, 'assumptions'),
          };
        }),
        pilotsNeedingReview: cases
          .filter((c) => c.stage === 'review_due')
          .map((c) => ({
            caseKey: c.display_key,
            dueText: 'Outcome review due',
            href: caseHref(c.display_key, 'outcomes'),
          })),
        pilotsNeedingReviewNote: cases.some((c) => c.stage === 'review_due')
          ? null
          : 'No pilot is due for review.',
        cases: await Promise.all(cases.map((c) => buildListRow(tx, c, ctx.now))),
        casesNote:
          'Market sizes are not totalled across cases. Each case has its own market boundary, unit and year.',
        keyEvents: events.map((e): ActivityItem => ({
          id: e.id,
          at: e.occurredAt,
          actor: e.actor,
          title: e.summary,
          detail: null,
          keyDecision: true,
          href: null,
        })),
        dataSources: conns.map((c) => ({
          key: c.kind,
          name: c.name,
          available: c.status === 'connected',
          lastRefreshedAt: isoDateTimeOrNull(c.last_success_at),
          message: c.status === 'connected' ? null : `${c.name}: ${c.status.replace(/_/g, ' ')}`,
        })),
        refreshedAt: isoDateTime(ctx.now),
      };
    },
  }),
};
