/**
 * S03 opportunity mocks at the aster-start moment for discovery: MD-21 is approved; OPP-07,
 * OPP-12, OPP-09, OPP-14 and OPP-16 are Detected (OPP-12 is a likely duplicate of OPP-07) and
 * OPP-03 is Dismissed; the trade registry is unavailable, so discovery is partial.
 *
 * Commands (shortlist, dismiss, restore, merge, manual add, convert) persist per tab. Converting
 * OPP-07 creates ME-104 in Discovery: the case header, case list and overview follow (scoped
 * overrides, so other cases still come from the WS7 base mocks).
 */
import {
  API,
  type CaseHeader,
  type CaseListRow,
  type FitResult,
  type Opportunity,
  type OpportunityStatus,
  type WorkflowCase,
} from '@growth-os/contracts';
import {
  cases,
  connections,
  journeyMoments as J,
  mandate as MD21,
  opportunities,
  people,
  sources,
} from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { personRef, P } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { findMandate, mandateStore } from '../mandate/mocks';
import { mockUuid, persisted, scoped } from '../mandate/mock-kit';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ManualRec {
  id: string;
  key: string;
  mandateId: string;
  name: string;
  trigger: string;
  fitRationale: string;
  createdBy: string;
  createdAt: string;
}
interface Conversion {
  opportunityKey: string;
  caseId: string;
  caseKey: string;
  title: string;
  marketLabel: string;
  ownerId: string;
  at: string;
}
interface Store {
  status: Record<string, OpportunityStatus>;
  dismissReason: Record<string, string>;
  duplicateOf: Record<string, string>;
  manual: ManualRec[];
  converted: Record<string, Conversion>;
  seq: number;
}

function initial(): Store {
  return {
    status: Object.fromEntries(opportunities.map((o) => [o.key, o.status])),
    dismissReason: Object.fromEntries(
      opportunities.flatMap((o) => ('dismissReason' in o ? [[o.key, o.dismissReason]] : [])),
    ),
    duplicateOf: {},
    manual: [],
    converted: {},
    seq: 0,
  };
}

export const opportunityStore = persisted<Store>('opportunities', initial);
const st = () => opportunityStore.get();
const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');
const now = () => new Date().toISOString();

/** Fit to mandate criteria as the prototype shows them (true = met, false = not met, null = unknown). */
const FIT: Record<string, [string, boolean | null][]> = {
  'OPP-07': [
    ['Inside mandate geography and segment', true],
    ['Existing product fits target workflow', null],
    ['Channel reaches the segment', true],
    ['No excluded activity needed', true],
  ],
  'OPP-12': [
    ['Inside mandate geography and segment', true],
    ['Existing product fits target workflow', null],
    ['Channel reaches the segment', true],
  ],
  'OPP-09': [
    ['Inside mandate geography', false],
    ['Existing product fits target workflow', null],
    ['Channel reaches the segment', false],
  ],
  'OPP-14': [
    ['Inside mandate segment', true],
    ['Inside mandate geography', false],
    ['Channel reaches the segment', null],
  ],
  'OPP-16': [
    ['Inside mandate segment', true],
    ['Inside mandate geography', false],
    ['Channel reaches the segment', null],
  ],
  'OPP-03': [
    ['Inside mandate geography', false],
    ['Channel reaches the segment', false],
  ],
};
const fitResult = (b: boolean | null): FitResult =>
  b === true ? 'met' : b === false ? 'not_met' : 'unknown';

type Fx = (typeof opportunities)[number];
const fxByKey = new Map<string, Fx>(opportunities.map((o) => [o.key, o]));

function keyOfId(id: string): string | null {
  return opportunities.find((o) => o.id === id)?.key ?? st().manual.find((m) => m.id === id)?.key ?? null;
}
export function idOfKey(key: string): string | null {
  return fxByKey.get(key)?.id ?? st().manual.find((m) => m.key === key)?.id ?? null;
}
export function resolveOpportunityKey(ref: string): string | null {
  return fxByKey.has(ref) || st().manual.some((m) => m.key === ref) ? ref : keyOfId(ref);
}

export function opportunityView(key: string): Opportunity | null {
  const s = st();
  const status = s.status[key];
  const conv = s.converted[key];
  const fx = fxByKey.get(key);
  if (fx) {
    const dupKey = 'likelyDuplicateOf' in fx ? fx.likelyDuplicateOf : null;
    return {
      id: fx.id,
      key: fx.key,
      mandateId: MD21.id,
      name: fx.name,
      trigger: fx.trigger,
      fitRationale: fx.fitRationale,
      origin: fx.origin,
      agentRunId: null,
      status: status ?? fx.status,
      dismissReason: s.dismissReason[key] ?? null,
      duplicateOfId: s.duplicateOf[key] ? idOfKey(s.duplicateOf[key]) : null,
      likelyDuplicateOfId: dupKey && status === 'detected' ? idOfKey(dupKey) : null,
      convertedCaseId: conv?.caseId ?? null,
      evidenceQuality: fx.evidenceQuality,
      sourceCount: fx.sourceKeys.length,
      unknownCount: fx.unknowns.length,
      lastCheckedAt: fx.lastCheckedAt,
      fitCriteria: (FIT[key] ?? []).map(([criterion, b]) => ({
        criterion,
        result: fitResult(b),
        note: null,
      })),
      unknowns: [...fx.unknowns],
      sources: fx.sourceKeys.map((k) => {
        const src = sources.find((x) => x.key === k)!;
        return {
          sourceId: src.id,
          key: src.key,
          label: src.chipLabel,
          quality: src.quality,
          restricted: src.availability === 'restricted',
        };
      }),
      boundary: null,
      createdAt: fx.lastCheckedAt,
      createdBy: fx.origin === 'manual' ? people.jonas.id : people.analysisAgent.id,
    };
  }
  const m = s.manual.find((x) => x.key === key);
  if (!m) return null;
  return {
    id: m.id,
    key: m.key,
    mandateId: m.mandateId,
    name: m.name,
    trigger: m.trigger,
    fitRationale: m.fitRationale,
    origin: 'manual',
    agentRunId: null,
    status: status ?? 'detected',
    dismissReason: s.dismissReason[key] ?? null,
    duplicateOfId: s.duplicateOf[key] ? idOfKey(s.duplicateOf[key]) : null,
    likelyDuplicateOfId: null,
    convertedCaseId: conv?.caseId ?? null,
    evidenceQuality: 'none',
    sourceCount: 0,
    unknownCount: 1,
    lastCheckedAt: null,
    fitCriteria: ['Inside mandate geography', 'Product fit', 'Channel coverage'].map((criterion) => ({
      criterion,
      result: 'unknown' as const,
      note: null,
    })),
    unknowns: ['Everything until evidence is attached'],
    sources: [],
    boundary: null,
    createdAt: m.createdAt,
    createdBy: m.createdBy,
  };
}

function allKeys(): string[] {
  return [...opportunities.map((o) => o.key), ...st().manual.map((m) => m.key)];
}

function requireOpp(ref: string): Opportunity {
  const key = resolveOpportunityKey(ref);
  const o = key ? opportunityView(key) : null;
  if (!o) throw notFound();
  return o;
}

function transition(o: Opportunity, from: OpportunityStatus[], to: OpportunityStatus, extra?: () => void) {
  if (!from.includes(o.status))
    throw new MockProblem('INVALID_TRANSITION', `A ${o.status} candidate cannot become ${to}.`);
  opportunityStore.update((s) => {
    s.status[o.key] = to;
    extra?.();
  });
  return opportunityView(o.key)!;
}

// ---------------------------------------------------------------------------
// Converted cases (ME-104 at its Discovery moment; new keys for other candidates)
// ---------------------------------------------------------------------------

function conversionFor(caseRef: string): Conversion | null {
  return Object.values(st().converted).find((c) => c.caseKey === caseRef || c.caseId === caseRef) ?? null;
}

function g0ApprovedText(): string {
  const at = findMandate('MD-21')?.g0?.decisions.find((d) => d.disposition === 'approve')?.at;
  return at
    ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Berlin' })
    : '5 Oct';
}

function convertedCase(c: Conversion): WorkflowCase {
  return {
    id: c.caseId,
    key: c.caseKey,
    appType: 'market_expansion',
    title: c.title,
    businessUnitId: MD21.businessUnitId,
    mandateId: MD21.id,
    owner: personRef(c.ownerId),
    sponsor: P('elena'),
    stage: 'discovery',
    heldFromStage: null,
    originType: 'opportunity',
    originId: idOfKey(c.opportunityKey),
    rowVersion: 1,
    createdAt: c.at,
    updatedAt: c.at,
  };
}

function convertedRail(): CaseHeader['rail'] {
  return [
    {
      gateCode: 'G0',
      status: 'approved',
      caption: `Mandate · ${g0ApprovedText()}`,
      preconditionsMet: 5,
      preconditionsTotal: 5,
      gateRequestId: findMandate('MD-21')?.g0?.id ?? null,
    },
    ...(['G1', 'G2', 'G3'] as const).map((g) => ({
      gateCode: g,
      status: 'not_started' as const,
      caption: g === 'G1' ? 'Validation' : g === 'G2' ? 'Pilot' : 'Scale',
      preconditionsMet: null,
      preconditionsTotal: null,
      gateRequestId: null,
    })),
  ];
}

function convertedHeader(c: Conversion): CaseHeader {
  return {
    case: convertedCase(c),
    mandateLabel: MD21.mandateLabel,
    marketLabel: c.marketLabel,
    currencyLabel: 'EUR · 2026 prices',
    currentSegment: 'discovery_assessment',
    rail: convertedRail(),
    nextDecision: {
      title: 'G1 · Approve validation',
      subtitle: 'Elena Fischer · not yet requested',
      decider: P('elena'),
      gateCode: 'G1',
      blocked: true,
      why: [{ key: 'comparable_sizing', message: 'Comparable sizing not committed', gate: 'G1' }],
      primaryAction: { label: 'Start assessment', href: `/me/cases/${c.caseKey}/thesis` },
    },
    freshness: {
      lastCheckedAt: J.opportunitiesDetected,
      label: 'Evidence checked at conversion · current',
      worst: 'current',
      staleCount: 0,
      ageingCount: 0,
    },
    tabCounts: {},
    illustrative: true,
  };
}

/** Case-list rows for converted cases (they replace the base row for the same key). */
export function convertedRows(): CaseListRow[] {
  return Object.values(st().converted).map((c) => ({
    id: c.caseId,
    key: c.caseKey,
    title: c.title,
    marketLabel: c.marketLabel,
    owner: personRef(c.ownerId),
    stage: 'discovery',
    nextGate: convertedRail()[1]!,
    blockersLabel: 'None',
    freshness: 'current',
    freshnessDetail: 'Checked at conversion',
    latestUpdate: 'Converted from opportunity',
    latestUpdateAt: c.at,
  }));
}

export function mergeCaseRows(rows: CaseListRow[]): CaseListRow[] {
  const conv = convertedRows();
  const keys = new Set(conv.map((r) => r.key));
  return [...conv, ...rows.filter((r) => !keys.has(r.key))];
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const handlers: HttpHandler[] = [
  mock(API.opportunities.list, ({ query }) => {
    const m = findMandate(query.mandateId);
    const items = allKeys()
      .map((k) => opportunityView(k)!)
      .filter((o) => o.mandateId === query.mandateId)
      .filter((o) => !query.status || o.status === query.status)
      .filter((o) => !query.countryCode || fxByKey.get(o.key)?.countryCode === query.countryCode);
    const trade = connections.find((c) => c.kind === 'trade_registry')!;
    const partial = !!m && (trade.status as string) !== 'connected';
    return {
      items,
      nextCursor: null,
      discoveryPartial: partial,
      unavailableSources: partial ? [{ connectionId: trade.id, name: trade.name, since: '6 Oct' }] : [],
      filtersText: m
        ? 'Product · water monitoring · Geography · DACH + Benelux · Segment · food and beverages'
        : '',
    };
  }),
  mock(API.opportunities.get, ({ params }) => requireOpp(params.ref)),
  mock(API.opportunities.createManual, ({ body, viewerId }) => {
    if (!findMandate(body.mandateId)) throw notFound();
    let key = '';
    opportunityStore.update((s) => {
      s.seq += 1;
      key = `OPP-${16 + s.seq}`;
      const who = personRef(viewerId!).displayName;
      s.manual.push({
        id: mockUuid(10, s.seq),
        key,
        mandateId: body.mandateId,
        name: body.name,
        trigger:
          body.trigger ||
          `Added by ${who} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
        fitRationale:
          body.fitRationale || 'No rationale yet. Attach evidence and describe fit to the mandate.',
        createdBy: viewerId!,
        createdAt: now(),
      });
      s.status[key] = 'detected';
    });
    return opportunityView(key)!;
  }),
  mock(API.opportunities.shortlist, ({ params }) =>
    transition(requireOpp(params.ref), ['detected'], 'shortlisted'),
  ),
  mock(API.opportunities.dismiss, ({ params, body }) => {
    const o = requireOpp(params.ref);
    return transition(o, ['detected', 'shortlisted'], 'dismissed', () => {
      st().dismissReason[o.key] = body.reason;
    });
  }),
  mock(API.opportunities.restore, ({ params }) => {
    const o = requireOpp(params.ref);
    return transition(o, ['dismissed'], 'detected', () => {
      delete st().dismissReason[o.key];
    });
  }),
  mock(API.opportunities.merge, ({ params, body }) => {
    const o = requireOpp(params.ref);
    const targetKey = keyOfId(body.targetOpportunityId);
    if (!targetKey || targetKey === o.key) throw notFound();
    const merged = transition(o, ['detected', 'shortlisted'], 'duplicate', () => {
      st().duplicateOf[o.key] = targetKey;
    });
    return { merged, target: opportunityView(targetKey)! };
  }),
  mock(API.opportunities.convert, ({ params, body }) => {
    const o = requireOpp(params.ref);
    if (mandateStore.get().mandates.find((m) => m.id === o.mandateId)?.status !== 'approved')
      throw new MockProblem('PRECONDITIONS_UNMET', 'The mandate is not approved yet.', {
        blockers: [{ key: 'mandate_g0', message: 'Mandate G0 approval is required', gate: 'G0' }],
      });
    if (!Object.values(people).some((p) => p.id === body.ownerId && p.kind === 'human'))
      throw new MockProblem('VALIDATION_FAILED', 'Choose a person as the case owner.');
    const fx = cases.find((c) => 'originOpportunityKey' in c && c.originOpportunityKey === o.key);
    let conv: Conversion | null = null;
    const opportunity = transition(o, ['shortlisted'], 'converted', () => {
      const s = st();
      const n = Object.keys(s.converted).length;
      conv = {
        opportunityKey: o.key,
        caseId: fx?.id ?? mockUuid(11, n + 1),
        caseKey: fx?.key ?? `ME-${106 + n}`,
        title: fx?.title ?? `${o.name} — monitoring`,
        marketLabel: fx?.marketLabel ?? o.name,
        ownerId: body.ownerId,
        at: now(),
      };
      s.converted[o.key] = conv;
    });
    return { opportunity, case: convertedCase(conv!) };
  }),

  // Converted cases: header, list and activity follow the conversion; other cases fall through.
  scoped(
    API.cases.header,
    (p) => !!p.caseRef && !!conversionFor(p.caseRef),
    mock(API.cases.header, ({ params }) => convertedHeader(conversionFor(params.caseRef)!)),
  ),
  scoped(
    API.cases.activity,
    (p) => !!p.caseRef && !!conversionFor(p.caseRef),
    mock(API.cases.activity, ({ params }) => {
      const c = conversionFor(params.caseRef)!;
      return {
        items: [
          {
            id: mockUuid(12, 1),
            at: c.at,
            actor: personRef(c.ownerId),
            title: `Converted from opportunity · stage Discovery`,
            detail: `Mandate MD-21 · G0 approved ${g0ApprovedText()}`,
            keyDecision: false,
            href: `/me/opportunities?mandate=MD-21`,
          },
        ],
        nextCursor: null,
      };
    }),
  ),
];
