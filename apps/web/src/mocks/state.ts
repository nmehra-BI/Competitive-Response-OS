/**
 * Mutable mock state: the signed-in persona (the "session cookie") and the few journey facts that
 * commands change (G2 decision, opportunity statuses, stale-snapshot variant). Everything else is
 * derived from fixtures/aster on each request. `resetMockState()` returns to the aster-demo moment
 * (26 Nov 2026: G2 v3 awaiting Elena's decision).
 */
import type { GateDisposition, OpportunityStatus } from '@growth-os/contracts';
import { opportunities } from '@growth-os/fixtures-aster';

const STORAGE_KEY = 'growth-os:msw-session';

function load(): string | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

export const session = {
  get viewerId(): string | null {
    return state.viewerId;
  },
  signIn(userId: string) {
    state.viewerId = userId;
    try {
      sessionStorage.setItem(STORAGE_KEY, userId);
    } catch {
      /* node */
    }
  },
  signOut() {
    state.viewerId = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* node */
    }
  },
};

export interface MockScenario {
  /** S10 variant: v3 went stale after Maya edited Base adoption (acceptance step 19). */
  g2Stale: boolean;
}

export interface G2Decision {
  disposition: GateDisposition;
  rationale: string;
  note: string | null;
  by: string;
  at: string;
  conditions: {
    text: string;
    ownerId: string;
    dueOn: string | null;
    dueRule: string | null;
    flag: 'blocks_execution' | 'monitor_only';
  }[];
}

interface State {
  viewerId: string | null;
  scenario: MockScenario;
  g2Decision: G2Decision | null;
  opportunityStatus: Record<string, OpportunityStatus>;
  mandateDraftRowVersion: number;
}

function initial(): State {
  return {
    viewerId: load(),
    scenario: { g2Stale: false },
    g2Decision: null,
    opportunityStatus: Object.fromEntries(opportunities.map((o) => [o.key, o.status])),
    mandateDraftRowVersion: 1,
  };
}

export const state: State = initial();

export function resetMockState(opts: { keepSession?: boolean } = {}) {
  const viewer = state.viewerId;
  Object.assign(state, initial());
  if (!opts.keepSession) state.viewerId = null;
  else state.viewerId = viewer;
}

export function setScenario(s: Partial<MockScenario>) {
  Object.assign(state.scenario, s);
}
