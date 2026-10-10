/**
 * Wave 4 S11 mocks (D-112 §5, D-114 §2, D-127, D-133): milestone dates and evidence expected, task
 * budget lines, the approved G2's stop rules with their trips, and "Record spend" with reversing
 * entries. Same rules as the API: spend above the remaining approved amount is refused with "Request
 * scope change"; a reversal needs a reason, happens at most once and is never reversed; a trip asks the
 * sponsor and changes nothing else. State resets with WS7's `resetMockState()` and survives a page load.
 */
import { API, type BudgetEntry, type BudgetMeter, type StopRuleState } from '@growth-os/contracts';
import { cases, gates, pilotBudget, people } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { mockId, personRef } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { state } from '../../mocks/state';

const STORAGE_KEY = 'growth-os:w4-e2-mocks';
const ME104 = cases[0];
const G2_ID = gates.g2.id;

interface EntryState {
  id: string;
  kind: 'committed' | 'spent';
  amount: string;
  asOf: string;
  sourceText: string;
  reference: string | null;
  taskId: string | null;
  reversesEntryId: string | null;
  reversalReason: string | null;
  recordedBy: string;
  recordedAt: string;
}

interface W4State {
  seq: number;
  entries: EntryState[];
  trips: Record<string, { at: string; by: string; reviewRequestId: string }>;
  milestones: Record<string, { dueOn: string | null; evidenceExpected: string | null }>;
  budgetLines: Record<string, { amount: string; note: string | null } | null>;
}

const initial = (): W4State => ({ seq: 0, entries: [], trips: {}, milestones: {}, budgetLines: {} });

function read(): W4State | null {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as W4State) : null;
  } catch {
    return null;
  }
}

let bound: object | null = null;
let current: W4State = initial();

export function w4(): W4State {
  if (bound === null) {
    bound = state.scenario;
    current = read() ?? initial();
  } else if (bound !== state.scenario) {
    bound = state.scenario;
    current = initial();
    persist();
  }
  return current;
}

function persist() {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* node */
  }
}

const nextId = () => mockId(4200 + ++w4().seq);
const nowIso = () =>
  `2026-12-0${Math.min(9, 1 + Math.floor(w4().seq / 10))}T10:${String(w4().seq % 60).padStart(2, '0')}:00+01:00`;

// ----- money as exact cents (no float arithmetic) -----
const cents = (a: string): bigint => {
  const [i = '0', f = ''] = a.split('.');
  return BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
};
const fromCents = (c: bigint): string => {
  const a = c < 0n ? -c : c;
  return `${c < 0n ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
};
const short = (a: string) => {
  const c = cents(a);
  return c % 100000n === 0n ? `€${c / 100000n}k` : `€${fromCents(c)}`;
};

function net(kind: 'committed' | 'spent'): bigint {
  return w4()
    .entries.filter((e) => e.kind === kind)
    .reduce((s, e) => (e.reversesEntryId ? s - cents(e.amount) : s + cents(e.amount)), 0n);
}

export function budgetEntries(): BudgetEntry[] {
  const all = w4().entries;
  return all.map((e) => ({
    id: e.id,
    gateRequestId: G2_ID,
    kind: e.kind,
    amount: e.amount,
    currency: pilotBudget.currency,
    asOf: e.asOf,
    sourceText: e.sourceText,
    recordedBy: personRef(e.recordedBy),
    reference: e.reference,
    taskId: e.taskId,
    reversesEntryId: e.reversesEntryId,
    reversalReason: e.reversalReason,
    reversedByEntryId: all.find((x) => x.reversesEntryId === e.id)?.id ?? null,
    recordedAt: e.recordedAt,
  }));
}

export function budgetMeter(): BudgetMeter {
  const money = (
    amount: string,
    measure: 'approved_budget' | 'committed_spend' | 'spent_to_date' | 'remaining_budget',
  ) => ({ amount, currency: pilotBudget.currency, measure, timeBasis: 'budget' as const });
  const spent = cents(pilotBudget.spent) + net('spent');
  return {
    gateRequestId: G2_ID,
    asOf: pilotBudget.asOf,
    approved: money(pilotBudget.approved, 'approved_budget'),
    committed: money(fromCents(cents(pilotBudget.committed) + net('committed')), 'committed_spend'),
    spent: money(fromCents(spent), 'spent_to_date'),
    remaining: money(fromCents(cents(pilotBudget.approved) - spent), 'remaining_budget'),
    note: 'Spend above €120k is blocked without a scope-change request.',
  };
}

export function stopRules(): StopRuleState[] {
  const trips = w4().trips;
  return gates.g2.structuredStopRules.map((r) => {
    const trip = trips[r.id];
    return {
      id: r.id,
      key: r.key,
      trigger: { ...r.trigger },
      consequence: r.consequence,
      ownerId: r.ownerId,
      owner: personRef(r.ownerId),
      status: trip ? 'tripped' : 'not_tripped',
      trippedAt: trip?.at ?? null,
      trippedBy: trip ? personRef(trip.by) : null,
      reviewRequestId: trip?.reviewRequestId ?? null,
    };
  });
}

/** Overlay of the plan editor's milestone fields. */
export function milestoneFields(id: string) {
  return w4().milestones[id] ?? { dueOn: null, evidenceExpected: null };
}

export function budgetLineOf(taskId: string) {
  const l = w4().budgetLines[taskId];
  return l ? { amount: l.amount, currency: pilotBudget.currency, note: l.note } : null;
}

type DraftBody = (typeof API.pilot.saveDraft.body)['_output'];

/** Apply the editor's additive fields to the mock plan (existing rows only). */
export function applyDraft(body: DraftBody) {
  const s = w4();
  for (const m of body.milestones ?? [])
    if (m.id)
      s.milestones[m.id] = {
        dueOn: m.dueOn ?? s.milestones[m.id]?.dueOn ?? null,
        evidenceExpected: m.evidenceExpected ?? s.milestones[m.id]?.evidenceExpected ?? null,
      };
  for (const t of body.tasks ?? []) {
    if (!t.id || t.budgetLine === undefined) continue;
    if (t.budgetLine && t.budgetLine.currency !== pilotBudget.currency)
      throw new MockProblem(
        'VALIDATION_FAILED',
        `Use ${pilotBudget.currency}, the currency of the approved budget.`,
      );
    s.budgetLines[t.id] = t.budgetLine ? { amount: t.budgetLine.amount, note: t.budgetLine.note } : null;
  }
  persist();
}

const requireCase = (ref: string) => {
  if (ref !== ME104.key && ref !== ME104.id) throw new MockProblem('NOT_FOUND', 'Not found.');
};
const RECORDERS = new Set<string>([people.jonas.id, people.maya.id]);

/** Record a trip as a sponsor review item; nothing else changes (the caller returns the pilot view). */
export function tripStopRule(caseRef: string, stopRuleId: string, viewerId: string | null) {
  requireCase(caseRef);
  const rule = gates.g2.structuredStopRules.find((r) => r.id === stopRuleId);
  if (!rule) throw new MockProblem('NOT_FOUND', 'Not found.');
  if (!RECORDERS.has(viewerId!) && viewerId !== rule.ownerId)
    throw new MockProblem(
      'FORBIDDEN',
      'Only the rule owner, the case owner or the pilot owner reports a trip.',
    );
  const s = w4();
  if (s.trips[rule.id])
    throw new MockProblem(
      'INVALID_TRANSITION',
      `${rule.key} is already tripped · the sponsor review is open.`,
    );
  s.trips[rule.id] = { at: nowIso(), by: viewerId!, reviewRequestId: nextId() };
  persist();
}

/** S09 "Add assumption" (D-112 §1, E2): a new register row, Evidence when sources are linked. */
const QUALITY: Record<string, 'strong' | 'some'> = { 'SRC-014': 'strong', 'SRC-009': 'strong' };
let asmSeq = 0;
const addAssumption = mock(API.assumptions.create, ({ params, body, viewerId }) => {
  const c = cases.find((x) => x.key === params.caseRef || x.id === params.caseRef);
  if (!c) throw new MockProblem('NOT_FOUND', 'Not found.');
  if (viewerId !== c.ownerId) throw new MockProblem('FORBIDDEN', 'Only the case owner adds assumptions.');
  if (body.value === null && !body.valueText?.trim())
    throw new MockProblem('VALIDATION_FAILED', 'Give a value or describe it in words.');
  const n = ++asmSeq;
  const sources = (body.sourceIds ?? []).map((id) => ({
    sourceId: id,
    key: `SRC-${id.slice(-3)}`,
    label: `Source ${id.slice(-3)}`,
    quality: QUALITY[`SRC-${id.slice(-3)}`] ?? ('some' as const),
    restricted: false,
  }));
  const quality: 'strong' | 'some' | 'none' = sources.some((s) => s.quality === 'strong')
    ? 'strong'
    : sources.length
      ? 'some'
      : 'none';
  const id = mockId(4600 + n);
  const createdAt = nowIso();
  return {
    id,
    key: `ASM-${20 + n}`,
    caseId: c.id,
    inputKey: body.inputKey,
    name: body.name,
    scenario: null,
    owner: personRef(body.ownerId),
    sensitivity: body.sensitivity,
    decisionCritical: body.decisionCritical,
    consequenceIfFalse: body.consequenceIfFalse,
    validationMethod: body.validationMethod,
    linkedExperimentIds: [],
    dueOn: body.dueOn,
    status: 'untested' as const,
    statusDetail: null,
    retiredReason: null,
    current: {
      id: mockId(4700 + n),
      assumptionId: id,
      version: 1,
      value: body.value,
      valueText: body.value === null ? body.valueText : null,
      unit: body.unit,
      currency: body.currency ?? null,
      priceYear: body.priceYear ?? null,
      basis: body.basis,
      evidenceQuality: quality,
      sources,
      origin: 'human' as const,
      agentRunId: null,
      changeReason: null,
      createdBy: personRef(viewerId!),
      createdAt,
    },
    registerGroup:
      body.sensitivity === 'low'
        ? ('monitor' as const)
        : quality === 'none'
          ? body.sensitivity === 'high'
            ? ('test_first' as const)
            : ('test_next' as const)
          : ('watch' as const),
    openDispute: null,
    usedBy: [],
    rowVersion: 1,
  };
});

export const w4Handlers: HttpHandler[] = [
  addAssumption,
  mock(API.budget.listEntries, ({ params }) => {
    requireCase(params.caseRef);
    return { items: budgetEntries(), meter: budgetMeter() };
  }),
  mock(API.budget.recordEntry, ({ params, body, viewerId }) => {
    requireCase(params.caseRef);
    if (!RECORDERS.has(viewerId!))
      throw new MockProblem('FORBIDDEN', 'Only the case owner or the pilot owner records spend.');
    if (body.gateRequestId !== G2_ID) throw new MockProblem('NOT_FOUND', 'Not found.');
    if (body.currency !== pilotBudget.currency)
      throw new MockProblem(
        'VALIDATION_FAILED',
        `Record entries in ${pilotBudget.currency}, the currency of the approved budget.`,
      );
    const remaining =
      cents(pilotBudget.approved) -
      (body.kind === 'spent' ? cents(pilotBudget.spent) + net('spent') : net('committed'));
    if (cents(body.amount) > remaining)
      throw new MockProblem(
        'PRECONDITIONS_UNMET',
        'This would exceed the approved €120k. Request a scope change.',
        {
          blockers: [
            {
              key: 'budget_ceiling',
              message: `${body.kind === 'spent' ? 'Spend' : 'Commitments'} above the remaining ${short(fromCents(remaining))} needs a scope-change request`,
              gate: 'G2',
              href: `/me/cases/${ME104.key}/pilot?view=scope`,
            },
          ],
        },
      );
    const s = w4();
    const e: EntryState = {
      id: nextId(),
      kind: body.kind,
      amount: fromCents(cents(body.amount)),
      asOf: body.asOf,
      sourceText: body.sourceText,
      reference: body.reference ?? null,
      taskId: body.taskId ?? null,
      reversesEntryId: null,
      reversalReason: null,
      recordedBy: viewerId!,
      recordedAt: nowIso(),
    };
    s.entries.push(e);
    persist();
    return budgetEntries().find((x) => x.id === e.id)!;
  }),
  mock(API.budget.reverseEntry, ({ params, body, viewerId }) => {
    const s = w4();
    const e = s.entries.find((x) => x.id === params.id);
    if (!e) throw new MockProblem('NOT_FOUND', 'Not found.');
    if (!RECORDERS.has(viewerId!))
      throw new MockProblem('FORBIDDEN', 'Only the case owner or the pilot owner records spend.');
    if (e.reversesEntryId)
      throw new MockProblem(
        'INVALID_TRANSITION',
        'A reversal cannot be reversed. Record a new entry instead.',
      );
    if (s.entries.some((x) => x.reversesEntryId === e.id))
      throw new MockProblem('INVALID_TRANSITION', 'This entry is already reversed.');
    if (!body.reason.trim()) throw new MockProblem('VALIDATION_FAILED', 'Give a reason for the correction.');
    const r: EntryState = {
      ...e,
      id: nextId(),
      asOf: pilotBudget.asOf,
      sourceText: `Reversal of ${e.sourceText}`,
      reversesEntryId: e.id,
      reversalReason: body.reason.trim(),
      recordedBy: viewerId!,
      recordedAt: nowIso(),
    };
    s.entries.push(r);
    persist();
    return budgetEntries().find((x) => x.id === r.id)!;
  }),
];
