/**
 * View-model builders for S08 Economics and the assumption register slice the assessment screens
 * read (MSW mocks only). Results always come from the economics engine run on the fixture input
 * (`economicsV2Input`) or on the edited draft; nothing here computes money.
 */
import {
  type Assumption,
  type EconomicsDriverKey,
  type EconomicsInput,
  type EconomicsVersion,
  type EconomicsView,
  type EngineInput,
  type LedgerRow,
  type ModelReview,
  type RegisterGroup,
} from '@growth-os/contracts';
import { assumptions, economicsMeta, people, sizingMeta } from '@growth-os/fixtures-aster';
import { formatCount, formatRate } from '@growth-os/ui';
import { personRef } from '../../mocks/data';
import {
  ASM,
  assessment,
  CASE_ID,
  CASE_KEY,
  economicsResult,
  type EconomicsCommitted,
  openDisputeFor,
  wsId,
} from '../sizing/mock-state';

export function economicsCurrent(version?: number): EconomicsCommitted | undefined {
  const list = assessment.economics.committed;
  return version === undefined ? list[list.length - 1] : list.find((c) => c.version === version);
}

export function economicsDraftInput(): EconomicsInput {
  return assessment.economics.draft.input;
}

/** Engine slots for each driver key (the adapter maps them back the same way). */
export const DRIVER_ORDER: EconomicsDriverKey[] = [
  'annual_price',
  'adoption_rate.base',
  'gross_margin',
  'annual_incremental_opex',
  'capacity',
  'one_time_investment',
  'reachable_pool',
  'adoption_rate.downside',
  'adoption_rate.upside',
];

export function driverInput(input: EconomicsInput, key: EconomicsDriverKey): EngineInput | null {
  switch (key) {
    case 'annual_price':
      return input.annualPricePerCustomer;
    case 'adoption_rate.base':
      return input.adoption.base;
    case 'adoption_rate.downside':
      return input.adoption.downside;
    case 'adoption_rate.upside':
      return input.adoption.upside;
    case 'gross_margin':
      return input.grossMargin;
    case 'annual_incremental_opex':
      return input.annualIncrementalOpex;
    case 'capacity':
      return input.capacity;
    case 'one_time_investment':
      return input.oneTimeInvestment;
    case 'reachable_pool':
      return input.reachablePool;
  }
}

/** Write a driver value into the engine input (draft edits). Returns false for unknown keys. */
export function setDriver(input: EconomicsInput, key: string, value: string): boolean {
  const set = (e: EngineInput | null) => (e ? { ...e, value } : null);
  switch (key) {
    case 'annual_price':
      input.annualPricePerCustomer = set(input.annualPricePerCustomer)!;
      return true;
    case 'adoption_rate.base':
      input.adoption = { ...input.adoption, base: set(input.adoption.base)! };
      return true;
    case 'adoption_rate.downside':
      if (!input.adoption.downside) return false;
      input.adoption = { ...input.adoption, downside: set(input.adoption.downside) };
      return true;
    case 'adoption_rate.upside':
      if (!input.adoption.upside) return false;
      input.adoption = { ...input.adoption, upside: set(input.adoption.upside) };
      return true;
    case 'gross_margin':
      input.grossMargin = set(input.grossMargin)!;
      return true;
    case 'annual_incremental_opex':
      input.annualIncrementalOpex = set(input.annualIncrementalOpex)!;
      return true;
    case 'capacity':
      input.capacity = set(input.capacity)!;
      return true;
    case 'one_time_investment':
      if (!input.oneTimeInvestment) return false;
      input.oneTimeInvestment = set(input.oneTimeInvestment);
      return true;
    default:
      return false;
  }
}

function assumptionFor(key: EconomicsDriverKey) {
  return ASM[key === 'annual_price' ? 'annual_spend_per_site' : key]!;
}

function basisText(key: EconomicsDriverKey, input: EconomicsInput): string {
  switch (key) {
    case 'annual_price':
      return 'Test: paid pilot offer · buyer interviews';
    case 'adoption_rate.base': {
      const d = input.adoption.downside;
      const who = d ? personRef(assumptionFor('adoption_rate.downside').ownerId).displayName : null;
      return `Of the ${formatCount(Number(input.reachablePool.value))}-site reachable pool${
        d ? ` · Downside fixed at ${formatRate(d.value)} (${who})` : ''
      }`;
    }
    case 'gross_margin':
      return 'Delivery and COGS deducted';
    case 'annual_incremental_opex':
      return 'Sales and admin only · excludes COGS';
    case 'capacity':
      return 'Raising it is a G3 decision';
    case 'one_time_investment':
      return 'Kept apart from all /year values';
    case 'reachable_pool':
      return `From Sizing v${sizingMeta.version} · edit there`;
    default:
      return assumptionFor(key).basis;
  }
}

export function driversFromInput(
  input: EconomicsInput,
  at: string,
  compareTo: EconomicsInput | null,
): LedgerRow[] {
  return DRIVER_ORDER.flatMap((key) => {
    const e = driverInput(input, key);
    if (!e) return [];
    const a = assumptionFor(key);
    const before = compareTo ? driverInput(compareTo, key) : null;
    return [
      {
        inputKey: key,
        name: e.label,
        value: e.value,
        unit: e.unit,
        currency: e.currency,
        kind: e.kind,
        basis: { source: null, owner: personRef(a.ownerId), text: basisText(key, input) },
        evidenceQuality: a.evidenceQuality,
        assumptionId: e.ref.id,
        version: e.ref.version ?? 1,
        lastChangedAt: at,
        usedByCount: key === 'reachable_pool' || key.startsWith('adoption') || key === 'capacity' ? 2 : 1,
        disputed: openDisputeFor(a.id) !== null,
        changedInDraft: !!before && before.value !== e.value,
      },
    ];
  });
}

async function versionOf(
  src: { id: string; version: number; input: EconomicsInput; createdAt: string },
  state: 'draft' | 'committed',
  extra: { rowVersion: number; committedAt: string | null; committedBy: string | null },
  compareTo: EconomicsInput | null,
): Promise<EconomicsVersion> {
  return {
    id: src.id,
    caseId: CASE_ID,
    version: src.version,
    state,
    sizingVersionId: sizingMeta.versionId,
    currency: src.input.currency,
    priceYear: src.input.priceYear,
    horizonYears: src.input.horizonYears,
    drivers: driversFromInput(src.input, extra.committedAt ?? src.createdAt, compareTo),
    result: await economicsResult(src.input),
    rowVersion: extra.rowVersion,
    committedAt: extra.committedAt,
    committedBy: extra.committedBy,
    createdAt: src.createdAt,
  };
}

export function committedVersion(c: EconomicsCommitted): Promise<EconomicsVersion> {
  return versionOf(
    { ...c, createdAt: c.committedAt },
    'committed',
    { rowVersion: 0, committedAt: c.committedAt, committedBy: c.committedBy },
    null,
  );
}

export function draftVersion(): Promise<EconomicsVersion> {
  const d = assessment.economics.draft;
  return versionOf(
    d,
    'draft',
    { rowVersion: d.rowVersion, committedAt: null, committedBy: null },
    economicsCurrent()?.input ?? null,
  );
}

export function financeReview(): ModelReview {
  const f = economicsMeta.financeReview;
  return {
    id: wsId(23, 1),
    modelType: 'economics',
    modelVersionId: economicsCurrent(2)!.id,
    reviewer: personRef(f.reviewerId),
    requestedAt: f.requestedAt,
    dueOn: f.dueOn,
    checkedItems: [...f.checkedItems],
    notCheckedItems: [...f.notCheckedItems],
    position: 'not_yet_reviewed',
    statement: null,
    signedAt: null,
  };
}

export async function economicsView(): Promise<EconomicsView> {
  const cur = economicsCurrent();
  const current = cur ? await committedVersion(cur) : null;
  const draft = await draftVersion();
  const shown = draft.result ?? current?.result;
  const blocking = shown?.checks.filter((c) => c.blocking) ?? [];
  return {
    current,
    draft,
    financeReview: financeReview(),
    recommendationIncomplete: blocking.length > 0,
    incompleteReasons: blocking.map((c) => c.message),
    versions: assessment.economics.committed.map((c) => ({
      id: c.id,
      version: c.version,
      committedAt: c.committedAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Assumption register slice (S05 critical assumptions, S08 dispute)
// ---------------------------------------------------------------------------

function registerGroup(a: (typeof assumptions)[number]): RegisterGroup {
  if (a.sensitivity === 'high') return a.evidenceQuality === 'some' ? 'test_next' : 'test_first';
  if (a.sensitivity === 'medium') return a.decisionCritical ? 'watch' : 'monitor';
  return 'monitor';
}

const USED_BY: Record<string, string[]> = {
  'adoption_rate.base': ['SOM', 'Economics'],
  'adoption_rate.downside': ['SOM', 'Economics'],
  'adoption_rate.upside': ['SOM', 'Economics'],
  annual_spend_per_site: ['TAM', 'SAM', 'SOM', 'Economics'],
  reachable_pool: ['Reachable pool', 'SOM', 'Economics'],
  capacity: ['SOM', 'Economics'],
  gross_margin: ['Economics'],
  annual_incremental_opex: ['Economics'],
  one_time_investment: ['Economics'],
};

export function assumptionView(a: (typeof assumptions)[number]): Assumption {
  const valueText = 'valueText' in a ? a.valueText : null;
  const currency = 'currency' in a ? a.currency : null;
  const priceYear = 'priceYear' in a ? a.priceYear : null;
  const version = a.inputKey === 'adoption_rate.base' || a.inputKey === 'annual_spend_per_site' ? 2 : 1;
  return {
    id: a.id,
    key: a.key,
    caseId: CASE_ID,
    inputKey: a.inputKey,
    name: a.name,
    scenario: a.scenario,
    owner: personRef(a.ownerId),
    sensitivity: a.sensitivity,
    decisionCritical: a.decisionCritical,
    consequenceIfFalse: a.consequenceIfFalse,
    validationMethod: a.validationMethod,
    linkedExperimentIds: [],
    dueOn: a.dueOn,
    status: a.status,
    statusDetail: null,
    retiredReason: null,
    current: {
      id: wsId(25, Number(a.key.slice(4))),
      assumptionId: a.id,
      version,
      value: a.value,
      valueText,
      unit: a.unit,
      currency,
      priceYear,
      basis: a.basis,
      evidenceQuality: a.evidenceQuality,
      sources: [],
      origin: 'human',
      agentRunId: null,
      changeReason: null,
      createdBy: personRef(a.ownerId),
      createdAt: '2026-10-10T09:00:00+02:00',
    },
    registerGroup: registerGroup(a),
    openDispute: openDisputeFor(a.id),
    usedBy: (USED_BY[a.inputKey] ?? []).map((label) => ({
      label,
      href:
        label === 'Economics'
          ? `/me/cases/${CASE_KEY}/economics?input=${encodeURIComponent(a.inputKey)}`
          : `/me/cases/${CASE_KEY}/sizing?input=${encodeURIComponent(`input.${a.inputKey}`)}&view=lineage`,
    })),
    rowVersion: 1,
  };
}

export function assumptionList(): Assumption[] {
  const SENS = { high: 0, medium: 1, low: 2 } as const;
  const QUAL = { none: 0, conflicting: 1, weak: 2, some: 3, strong: 4 } as const;
  return assumptions
    .map(assumptionView)
    .sort(
      (x, y) =>
        SENS[x.sensitivity] - SENS[y.sensitivity] ||
        QUAL[x.current.evidenceQuality] - QUAL[y.current.evidenceQuality],
    );
}

export const OWNER_IDS = { maya: people.maya.id, elena: people.elena.id } as const;
