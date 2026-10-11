/**
 * Case read models: the persistent header (rail, next decision, freshness, tab counts) and the case
 * list row. Exported for WS4b and the overview. Hidden cases never reach these functions.
 */
import type {
  CaseHeader,
  CaseListRow,
  EvidenceFreshness,
  GateCode,
  GateRailNode,
  GateStatus,
  NextDecision,
  RailSegment,
} from '@growth-os/contracts';
import { STAGE_SEGMENT, type GateEvaluation } from '@growth-os/domain';
import type { Tx } from '@growth-os/db';
import type { Identity } from '../../../platform/context';
import { isoDateTime, isoDateTimeOrNull } from '../../../platform/serialize';
import { caseHref, moneyLabel, peopleMap, shortDate, toWorkflowCase, who, type CaseRecord } from './access';
import { toCaseLite } from '../gates/lib/common';
import { caseGateState, caseSourceIds } from '../gates/lib/facts';
import { buttonLabel, displayStatus, gateById, scopeOf, type GateRow } from '../gates/lib/serialize';

const COUNTRY: Record<string, string> = {
  DE: 'Germany',
  AT: 'Austria',
  NL: 'Netherlands',
  CH: 'Switzerland',
  PL: 'Poland',
  FR: 'France',
  BE: 'Belgium',
  DK: 'Denmark',
};
const FRESH_ORDER: EvidenceFreshness[] = ['current', 'ageing', 'stale', 'superseded'];
const APPROVED = new Set(['approved', 'approved_with_conditions']);
const GATE_NAME: Record<GateCode, string> = {
  G0: 'Mandate', // rail caption "Mandate · 5 Oct" (prototype)
  G1: 'Validation',
  G2: 'Pilot',
  G3: 'Scale',
  X: 'Extension',
};

export async function marketLabel(tx: Tx, c: CaseRecord): Promise<string> {
  const b = await tx
    .selectFrom('me.sizing_version as v')
    .innerJoin('me.market_boundary as b', 'b.id', 'v.market_boundary_id')
    .select(['b.country_code', 'b.segment_label'])
    .where('v.case_id', '=', c.id)
    .orderBy('v.version', 'desc')
    .executeTakeFirst();
  if (b) return `${COUNTRY[b.country_code] ?? b.country_code} · ${b.segment_label}`;
  const m = await mandateVersionOf(tx, c);
  if (m) {
    const segs = m.segment_ids.length
      ? await tx.selectFrom('platform.segment').select('name').where('id', 'in', m.segment_ids).execute()
      : [];
    return `${m.geography_codes.map((g) => COUNTRY[g] ?? g).join(', ')} · ${segs.map((s) => s.name.toLowerCase()).join(', ')}`;
  }
  return c.title.split(' — ')[0] ?? c.title;
}

async function mandateVersionOf(tx: Tx, c: CaseRecord) {
  if (!c.mandate_id) return undefined;
  const m = await tx
    .selectFrom('me.mandate')
    .select(['current_version_id', 'draft_version_id', 'display_key', 'g0_gate_request_id'])
    .where('id', '=', c.mandate_id)
    .executeTakeFirst();
  const vid = m?.current_version_id ?? m?.draft_version_id;
  if (!vid) return undefined;
  const v = await tx.selectFrom('me.mandate_version').selectAll().where('id', '=', vid).executeTakeFirst();
  return v ? { ...v, mandateKey: m!.display_key, g0: m!.g0_gate_request_id } : undefined;
}

interface RailInfo {
  rail: GateRailNode[];
  evaluations: Partial<Record<GateCode, GateEvaluation>>;
  gates: Partial<Record<GateCode, GateRow>>;
}

function caption(gate: GateCode, g: GateRow | undefined): string {
  if (!g) return GATE_NAME[gate];
  const parts = [GATE_NAME[gate]];
  if (gate !== 'G0') parts[0] = `${GATE_NAME[gate]} ${moneyLabel(g.requested_amount, g.currency ?? 'EUR')}`;
  if (g.duration_days) parts.push(`${g.duration_days} days`);
  const at = g.decided_at ?? g.submitted_at;
  if (at) parts.push(shortDate(at));
  return parts.join(' · ');
}

export async function buildRail(tx: Tx, c: CaseRecord): Promise<RailInfo> {
  const lite = toCaseLite(c);
  const gates: Partial<Record<GateCode, GateRow>> = {};
  const evaluations: RailInfo['evaluations'] = {};
  const statuses: Partial<Record<GateCode, GateStatus>> = {};
  // G1–G3 and X come from the same function as `gates.preconditions` (D-072), so they always agree.
  for (const code of ['G1', 'G2', 'G3', 'X'] as const) {
    const st = await caseGateState(tx, lite, code);
    if (st.gate) gates[code] = st.gate;
    if (code !== 'X') evaluations[code] = st.evaluation;
    statuses[code] = st.status;
  }
  // G0 belongs to the mandate: its request is the mandate's G0, decided before the case existed.
  const mv = await mandateVersionOf(tx, c);
  if (mv?.g0) {
    const g0 = await gateById(tx, mv.g0);
    if (g0) gates.G0 = g0;
  }
  const g0 = gates.G0;
  statuses.G0 = g0
    ? displayStatus(g0, { allMet: true, metCount: 1 })
    : c.stage === 'draft_mandate'
      ? 'not_started'
      : 'approved';
  const codes: GateCode[] = ['G0', 'G1', 'G2', 'G3', ...(gates.X ? (['X'] as const) : [])];
  const rail = codes.map((code): GateRailNode => {
    const g = gates[code];
    const ev = evaluations[code];
    return {
      gateCode: code,
      status: statuses[code]!,
      caption: caption(code, g),
      preconditionsMet: ev ? ev.metCount : null,
      preconditionsTotal: ev ? ev.total : null,
      gateRequestId: g?.id ?? null,
    };
  });
  return { rail, evaluations, gates };
}

async function freshness(tx: Tx, c: CaseRecord, now: Date) {
  const ids = await caseSourceIds(tx, c.id);
  const rows = ids.length
    ? await tx
        .selectFrom('platform.source')
        .select(['freshness', 'retrieved_at'])
        .where('id', 'in', ids)
        .execute()
    : [];
  const worst = rows.reduce<EvidenceFreshness>(
    (w, r) =>
      FRESH_ORDER.indexOf(r.freshness as EvidenceFreshness) > FRESH_ORDER.indexOf(w)
        ? (r.freshness as EvidenceFreshness)
        : w,
    'current',
  );
  const last = rows.reduce<Date | null>(
    (m, r) => (r.retrieved_at && (!m || r.retrieved_at > m) ? r.retrieved_at : m),
    null,
  );
  const ageing = rows.filter((r) => r.freshness === 'ageing').length;
  const stale = rows.filter((r) => r.freshness === 'stale' || r.freshness === 'superseded').length;
  const days = last ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / 86_400_000)) : null;
  const parts = [
    days === null
      ? 'No evidence yet'
      : `Evidence checked ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}`,
  ];
  if (ageing) parts.push(`${ageing} source${ageing === 1 ? '' : 's'} ageing`);
  if (stale) parts.push(`${stale} source${stale === 1 ? '' : 's'} stale`);
  return {
    lastCheckedAt: isoDateTimeOrNull(last),
    label: parts.join(' · '),
    worst,
    staleCount: stale,
    ageingCount: ageing,
  };
}

function segmentOf(c: CaseRecord): RailSegment {
  const s = STAGE_SEGMENT[c.stage as keyof typeof STAGE_SEGMENT];
  if (s) return s;
  const held = c.held_from_stage ? STAGE_SEGMENT[c.held_from_stage as keyof typeof STAGE_SEGMENT] : null;
  return held ?? 'discovery_assessment';
}

async function nextDecision(tx: Tx, c: CaseRecord, r: RailInfo): Promise<NextDecision> {
  const people = await peopleMap(tx, [c.sponsor_user_id, c.owner_user_id]);
  const pending = r.rail.find((n) => n.gateCode !== 'X' && !APPROVED.has(n.status));
  if (!pending || ['stopped', 'closed'].includes(c.stage))
    return {
      title: 'No gate decision pending',
      subtitle: '',
      decider: null,
      gateCode: null,
      blocked: false,
      why: [],
      primaryAction: null,
    };
  const g = r.gates[pending.gateCode];
  const ev = r.evaluations[pending.gateCode];
  const label = g ? buttonLabel(pending.gateCode, scopeOf(g)) : `Prepare the ${pending.gateCode} request`;
  const awaiting = g?.status === 'awaiting_decision' || g?.status === 'stale';
  const sponsor = who(people, c.sponsor_user_id);
  const blocked = !awaiting && ev !== undefined && !ev.allMet;
  return {
    title: `${pending.gateCode} · ${label}`,
    subtitle: awaiting
      ? `${sponsor.displayName} · submitted ${shortDate(g!.submitted_at ?? g!.created_at)}`
      : blocked
        ? `${ev!.metCount} of ${ev!.total} preconditions met`
        : `${who(people, c.owner_user_id).displayName} prepares the request`,
    decider: awaiting ? sponsor : null,
    gateCode: pending.gateCode,
    blocked,
    why: blocked ? ev!.blockers : [],
    primaryAction: awaiting
      ? { label: 'Open decision package', href: caseHref(c.display_key, 'decision') }
      : { label: 'Review preconditions', href: caseHref(c.display_key, 'gates') },
  };
}

async function tabCounts(tx: Tx, c: CaseRecord): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const feas = await tx
    .selectFrom('me.feasibility_assessment')
    .select('status')
    .where('case_id', '=', c.id)
    .execute();
  const pending = feas.filter((f) => f.status === 'pending' || f.status === 'in_review').length;
  if (pending) out.Feasibility = `${pending} pending`;
  const disputes = await tx
    .selectFrom('platform.challenge')
    .select('id')
    .where('case_id', '=', c.id)
    .where('kind', '=', 'dispute')
    .where('status', '=', 'open')
    .execute();
  if (disputes.length) out.Validation = `${disputes.length} disputed`;
  return out;
}

export async function buildHeader(tx: Tx, identity: Identity, c: CaseRecord, now: Date): Promise<CaseHeader> {
  const people = await peopleMap(tx, [c.owner_user_id, c.sponsor_user_id]);
  const rail = await buildRail(tx, c);
  const mv = await mandateVersionOf(tx, c);
  const bu = await tx
    .selectFrom('platform.business_unit')
    .select('name')
    .where('id', '=', c.business_unit_id)
    .executeTakeFirst();
  const boundary = await tx
    .selectFrom('me.sizing_version as v')
    .innerJoin('me.market_boundary as b', 'b.id', 'v.market_boundary_id')
    .select(['b.currency', 'b.price_year'])
    .where('v.case_id', '=', c.id)
    .orderBy('v.version', 'desc')
    .executeTakeFirst();
  return {
    case: toWorkflowCase(c, people),
    mandateLabel: `Mandate${mv ? ` ${mv.mandateKey}` : ''} · ${bu?.name ?? 'Business unit'}`,
    marketLabel: await marketLabel(tx, c),
    currencyLabel: boundary
      ? `${boundary.currency} · ${boundary.price_year} prices`
      : mv?.currency
        ? `${mv.currency} · prices not yet fixed`
        : 'Currency not stated',
    currentSegment: segmentOf(c),
    rail: rail.rail,
    nextDecision: await nextDecision(tx, c, rail),
    freshness: await freshness(tx, c, now),
    tabCounts: await tabCounts(tx, c),
    illustrative: identity.tenant.illustrative,
  };
}

export async function buildListRow(tx: Tx, c: CaseRecord, now: Date): Promise<CaseListRow> {
  const people = await peopleMap(tx, [c.owner_user_id]);
  const rail = await buildRail(tx, c);
  const next = rail.rail.find((n) => n.gateCode !== 'X' && !APPROVED.has(n.status)) ?? null;
  const fresh = await freshness(tx, c, now);
  const dissents = await tx.selectFrom('platform.dissent').select('id').where('case_id', '=', c.id).execute();
  const blockers = await tx
    .selectFrom('me.blocker')
    .select('id')
    .where('case_id', '=', c.id)
    .where('status', '=', 'open')
    .execute();
  const parts: string[] = [];
  if (dissents.length) parts.push(`${dissents.length} dissent${dissents.length === 1 ? '' : 's'} recorded`);
  if (blockers.length) parts.push(`${blockers.length} blocker${blockers.length === 1 ? '' : 's'} open`);
  const latest = await tx
    .selectFrom('platform.audit_event')
    .select(['summary', 'occurred_at'])
    .where('case_id', '=', c.id)
    .orderBy('seq', 'desc')
    .executeTakeFirst();
  return {
    id: c.id,
    key: c.display_key,
    title: c.title,
    marketLabel: await marketLabel(tx, c),
    owner: who(people, c.owner_user_id),
    stage: c.stage as CaseListRow['stage'],
    nextGate: ['stopped', 'closed'].includes(c.stage) ? null : next,
    blockersLabel: ['stopped', 'closed'].includes(c.stage) ? '—' : parts.join(' · ') || 'None',
    freshness: fresh.worst,
    freshnessDetail: fresh.label,
    latestUpdate: latest?.summary ?? 'Created',
    latestUpdateAt: isoDateTime(latest?.occurred_at ?? c.updated_at),
  };
}
