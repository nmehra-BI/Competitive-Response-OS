/**
 * Mutable MSW mock state shared by the WS8b assessment screens (S05 Thesis, S06 Sizing,
 * S07 Feasibility, S08 Economics). It sits at the assessment moment of the Aster journey
 * (13–14 Oct 2026): sizing v2 is a draft about to be committed, economics v2 is committed,
 * Daniel Weber has disputed 20% adoption, the specialist review is pending.
 *
 * Engine outputs are never written by hand: every sizing and economics result is computed by the
 * deterministic engines (./engine/adapter, ../economics/engine/adapter) from the frozen fixture
 * inputs, so the mocks return exactly what the engines produce for the Aster fixture.
 *
 * Variants (set from the browser with `__growthOsMocks.setScenario({...})`, or from Vitest with
 * `setAssessmentScenario`) are read lazily on each request:
 *   sizingVariant: 'normal' | 'sam_exceeds_tam' | 'duplicate_cohort'
 *   adoptionDisputed: false  → start before Daniel's dispute (acceptance step 9)
 *   thesisRun: 'running' | 'partial' | 'completed'
 *   siteListRestricted: true → the viewer sees aggregates only (also automatic for Jonas)
 */
import {
  type Challenge,
  type EconomicsInput,
  type EconomicsOutput,
  type SizingCohortInput,
  type SizingInput,
  type SizingOutput,
  type SourceChip,
} from '@growth-os/contracts';
import {
  adoptionDispute,
  assumptions,
  COHORT_PROCESS_ID,
  COHORT_PROCESS_IMPORTED_ID,
  cases,
  economicsV2Input,
  journeyMoments as J,
  people,
  sizingMeta,
  sizingV2Input,
  sources,
} from '@growth-os/fixtures-aster';
import { personRef } from '../../mocks/data';
import { state as ws7 } from '../../mocks/state';
import { ws as ws8c } from '../decisions/mock-state';
import { economicsEngine } from '../economics/engine/adapter';
import { sizingEngine } from './engine/adapter';

// ---------------------------------------------------------------------------
// Scenario flags (stored on the shared WS7 scenario object, so `setScenario` works unchanged)
// ---------------------------------------------------------------------------

export type SizingVariant = 'normal' | 'sam_exceeds_tam' | 'duplicate_cohort';
export interface AssessmentScenario {
  sizingVariant?: SizingVariant;
  adoptionDisputed?: boolean;
  thesisRun?: 'running' | 'partial' | 'completed';
  siteListRestricted?: boolean;
}

export function scenario(): AssessmentScenario {
  return ws7.scenario as unknown as AssessmentScenario;
}
export function setAssessmentScenario(s: AssessmentScenario) {
  Object.assign(ws7.scenario, s);
}

// ---------------------------------------------------------------------------
// Ids, people, sources
// ---------------------------------------------------------------------------

export const CASE_KEY = 'ME-104';
export const CASE_ID = cases[0].id;

/** Deterministic ids for rows the fixture does not carry (WS8b namespace). */
export function wsId(kind: number, n: number): string {
  return `a57eb8${String(kind).padStart(2, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const PEOPLE = {
  maya: personRef(people.maya.id),
  daniel: personRef(people.daniel.id),
  jonas: personRef(people.jonas.id),
  priya: personRef(people.priya.id),
  lena: personRef(people.lena.id),
  elena: personRef(people.elena.id),
  opsLead: personRef(people.opsLead.id),
};

export function personOf(id: string) {
  return personRef(id);
}

export function sourceChip(key: string): SourceChip {
  const s = sources.find((x) => x.key === key);
  if (!s) throw new Error(`unknown source ${key}`);
  return {
    sourceId: s.id,
    key: s.key,
    label: s.chipLabel,
    quality: s.quality,
    restricted: s.availability === 'restricted',
  };
}

export const ASM = Object.fromEntries(assumptions.map((a) => [a.inputKey, a])) as Record<
  string,
  (typeof assumptions)[number]
>;

/** Viewers who see the site census as aggregates only (fixture source entitlements). */
export function siteListRestrictedFor(viewerId: string | null): boolean {
  if (scenario().siteListRestricted) return true;
  return viewerId === people.jonas.id || viewerId === people.opsLead.id;
}

// ---------------------------------------------------------------------------
// Engine results (cached by input; engines are pure)
// ---------------------------------------------------------------------------

const sizingCache = new Map<string, Promise<SizingOutput>>();
const econCache = new Map<string, Promise<EconomicsOutput>>();

export function sizingResult(input: SizingInput): Promise<SizingOutput> {
  const k = JSON.stringify(input);
  let p = sizingCache.get(k);
  if (!p) {
    p = sizingEngine.calculate(input);
    sizingCache.set(k, p);
  }
  return p;
}

export function economicsResult(input: EconomicsInput): Promise<EconomicsOutput> {
  const k = JSON.stringify(input);
  let p = econCache.get(k);
  if (!p) {
    p = economicsEngine.calculate(input);
    econCache.set(k, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Sizing state
// ---------------------------------------------------------------------------

export interface InputEdit {
  inputKey: string;
  from: string;
  to: string;
  at: string;
  byId: string;
}

export interface SizingDraftState {
  id: string;
  version: number;
  rowVersion: number;
  createdAt: string;
  input: SizingInput;
  edits: InputEdit[];
}

export interface SizingCommitted {
  id: string;
  version: number;
  input: SizingInput;
  committedAt: string;
  committedBy: string;
  edits: InputEdit[];
}

export type DuplicateState = 'none' | 'pending' | 'kept_v1' | 'kept_imported';

const IMPORTED_COHORT: SizingCohortInput = {
  cohortId: COHORT_PROCESS_IMPORTED_ID,
  name: sizingMeta.variants.duplicateCohort.name,
  rule: 'Uses the target water process',
  siteCount: sizingMeta.variants.duplicateCohort.siteCount,
  populationUnit: 'site',
  priceYear: 2026,
  status: 'duplicate_candidate',
  ref: { type: 'cohort', id: COHORT_PROCESS_IMPORTED_ID, version: 1 },
};

export function freshSizingDraft(): SizingDraftState {
  return {
    id: sizingMeta.versionId,
    version: sizingMeta.version,
    rowVersion: 1,
    createdAt: '2026-10-09T11:05:00+02:00',
    input: structuredClone(sizingV2Input),
    edits: [],
  };
}

// ---------------------------------------------------------------------------
// Economics state
// ---------------------------------------------------------------------------

export interface EconomicsDraftState {
  id: string;
  version: number;
  rowVersion: number;
  createdAt: string;
  input: EconomicsInput;
}
export interface EconomicsCommitted {
  id: string;
  version: number;
  input: EconomicsInput;
  committedAt: string;
  committedBy: string;
}

// ---------------------------------------------------------------------------
// Thesis, claims and feasibility state
// ---------------------------------------------------------------------------

export interface ThesisFieldsState {
  proposition: { value: string; origin: 'human' | 'ai' | 'ai_edited' };
  intendedCustomer: { value: string; origin: 'human' | 'ai' | 'ai_edited' };
  whyNow: { value: string; origin: 'human' | 'ai' | 'ai_edited' };
  recommendation: { value: string; origin: 'human' | 'ai' | 'ai_edited' };
}

export interface FeasibilitySignState {
  dimension: string;
  position: string;
  scopeText: string;
  coversGate: 'G1' | 'G2' | 'G3' | 'X' | null;
  maxSites: number | null;
  maxDays: number | null;
  statement: string | null;
  signedById: string;
  signedAt: string;
}

interface AssessmentState {
  appliedVariant: SizingVariant;
  sizing: {
    draft: SizingDraftState | null;
    committed: SizingCommitted[];
    duplicate: DuplicateState;
  };
  economics: {
    committed: EconomicsCommitted[];
    draft: EconomicsDraftState;
  };
  /** Disputes created through the API in this session (the fixture dispute is derived). */
  createdDisputes: Challenge[];
  disputeReplies: Record<string, Challenge['replies']>;
  disputeResolved: Record<string, { resolution: string; byId: string; at: string }>;
  thesis: {
    currentVersion: number;
    committedFields: ThesisFieldsState;
    draft: { version: number; rowVersion: number; fields: ThesisFieldsState } | null;
    aiClaim: 'proposed' | 'accepted' | 'discarded';
    aiClaimAcceptedBy: string | null;
    challenges: Record<string, Challenge>;
    runOverride: { status: 'running' | 'completed'; startedAt: string } | null;
  };
  feasibility: {
    disagreements: Record<string, { id: string; authorId: string; statement: string; createdAt: string }[]>;
    signed: Record<string, FeasibilitySignState>;
    requested: Record<string, string>;
    blockerResolutions: Record<string, { text: string; byId: string }>;
  };
}

export const THESIS_FIELDS_V1: ThesisFieldsState = {
  proposition: {
    value:
      'Offer our existing water-monitoring system to German food-processing plants as a monitored service, at about €20k per site per year.',
    origin: 'human',
  },
  intendedCustomer: {
    value: 'Plant and quality managers at food-processing sites with a process-water treatment step.',
    origin: 'human',
  },
  whyNow: {
    value:
      'Two 2026 trade sources report rising attention to process-water monitoring in food plants. Our partner already covers part of the segment.',
    origin: 'ai_edited',
  },
  recommendation: {
    value:
      'Request G1 validation of €15k: approach 20 selected sites through the partner channel and aim for 8 completed interviews and 4 paid pilot commitments before any pilot request.',
    origin: 'human',
  },
};

function initial(): AssessmentState {
  return {
    appliedVariant: 'normal',
    sizing: { draft: freshSizingDraft(), committed: [], duplicate: 'none' },
    economics: {
      committed: [
        {
          id: wsId(13, 2),
          version: 2,
          input: structuredClone(economicsV2Input),
          committedAt: J.sizingCommitted,
          committedBy: people.maya.id,
        },
      ],
      draft: {
        id: wsId(13, 3),
        version: 3,
        rowVersion: 1,
        createdAt: '2026-10-14T09:00:00+02:00',
        input: structuredClone(economicsV2Input),
      },
    },
    createdDisputes: [],
    disputeReplies: {},
    disputeResolved: {},
    thesis: {
      currentVersion: 1,
      committedFields: structuredClone(THESIS_FIELDS_V1),
      draft: null,
      aiClaim: 'proposed',
      aiClaimAcceptedBy: null,
      challenges: {},
      runOverride: null,
    },
    feasibility: {
      disagreements: {
        differentiation: [
          {
            id: wsId(21, 1),
            authorId: people.jonas.id,
            statement: 'Differentiation is overstated for large plants; incumbents already offer this.',
            createdAt: '2026-10-13T15:20:00+02:00',
          },
        ],
      },
      signed: {},
      requested: {},
      blockerResolutions: {},
    },
  };
}

export const assessment: AssessmentState = initial();

/** Back to the assessment moment (Vitest `afterEach`; the browser resets on reload). */
export function resetAssessmentMocks() {
  Object.assign(assessment, initial());
  const s = scenario();
  delete s.sizingVariant;
  delete s.adoptionDisputed;
  delete s.thesisRun;
  delete s.siteListRestricted;
}

/** Apply a newly selected sizing variant (lazily, on the next request). */
export function syncSizingVariant() {
  const v = scenario().sizingVariant ?? 'normal';
  if (v === assessment.appliedVariant) return;
  assessment.appliedVariant = v;
  assessment.sizing = { draft: freshSizingDraft(), committed: [], duplicate: 'none' };
  const d = assessment.sizing.draft!;
  if (v === 'sam_exceeds_tam') {
    d.edits.push({
      inputKey: 'tam_site_count',
      from: d.input.tamPopulation.value,
      to: sizingMeta.variants.samExceedsTam.tamPopulation,
      at: '2026-10-13T15:02:00+02:00',
      byId: people.maya.id,
    });
    d.input.tamPopulation = {
      ...d.input.tamPopulation,
      value: sizingMeta.variants.samExceedsTam.tamPopulation,
    };
  }
  if (v === 'duplicate_cohort') {
    assessment.sizing.duplicate = 'pending';
    d.input.cohorts = [...d.input.cohorts, structuredClone(IMPORTED_COHORT)];
  }
}

/** Keep one of two duplicate cohorts; the other is excluded, not deleted. */
export function resolveDuplicate(keepCohortId: string, excludeCohortId: string): boolean {
  const d = assessment.sizing.draft;
  if (!d) return false;
  const ids = new Set([COHORT_PROCESS_ID, COHORT_PROCESS_IMPORTED_ID]);
  if (!ids.has(keepCohortId) || !ids.has(excludeCohortId) || keepCohortId === excludeCohortId) return false;
  d.input.cohorts = d.input.cohorts.map((c) =>
    c.cohortId === keepCohortId
      ? { ...c, status: 'active' as const }
      : c.cohortId === excludeCohortId
        ? { ...c, status: 'excluded' as const }
        : c,
  );
  assessment.sizing.duplicate = keepCohortId === COHORT_PROCESS_ID ? 'kept_v1' : 'kept_imported';
  d.rowVersion += 1;
  return true;
}

// ---------------------------------------------------------------------------
// The adoption dispute (Daniel Weber, ASM-01)
// ---------------------------------------------------------------------------

export function fixtureDispute(): Challenge {
  // The thread (replies, resolution) is WS8c journey state, shared with S09 (D-061).
  const w = ws8c();
  return {
    id: adoptionDispute.id,
    kind: 'dispute',
    targetType: 'assumption',
    targetId: ASM['adoption_rate.base']!.id,
    caseId: CASE_ID,
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
        id: wsId(22, i + 1),
        author: personRef(r.authorId),
        body: r.body,
        createdAt: r.at,
      })),
      ...w.disputeReplies.map((r, i) => ({
        id: wsId(22, 100 + i),
        author: personRef(r.authorId),
        body: r.body,
        createdAt: r.at,
      })),
    ],
  };
}

/** All disputes and challenges on assumptions, with replies and resolution applied. */
export function assumptionDisputes(): Challenge[] {
  const base = scenario().adoptionDisputed === false ? [] : [fixtureDispute()];
  return [...base, ...assessment.createdDisputes].map((c) => {
    const replies = [...c.replies, ...(assessment.disputeReplies[c.id] ?? [])];
    const resolved = assessment.disputeResolved[c.id];
    return resolved && c.status === 'open'
      ? {
          ...c,
          replies,
          status: 'resolved' as const,
          resolution: resolved.resolution,
          resolvedBy: personRef(resolved.byId),
          resolvedAt: resolved.at,
        }
      : { ...c, replies };
  });
}

export function openDisputeFor(assumptionId: string): Challenge | null {
  return assumptionDisputes().find((c) => c.targetId === assumptionId && c.status === 'open') ?? null;
}

export function nowIso(): string {
  return new Date().toISOString();
}
