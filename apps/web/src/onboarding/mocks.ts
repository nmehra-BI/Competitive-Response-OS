/**
 * MSW handlers for the onboarding endpoints (CR-ONB-1), same rules as the API: per persona, people only, the
 * role path from the persona's roles, state steps derived from the aster-demo moment, visit steps by visit.
 */
import { API, type GuideStepKey, type OnboardingState, type RoleCode } from '@growth-os/contracts';
import {
  applyPatch,
  checkPatch,
  composeSteps,
  EMPTY_ONBOARDING,
  guidePathFor,
  type OnboardingRowState,
} from '@growth-os/domain';
import { people, roleAssignments } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { mock, MockProblem } from '../mocks/define';

const STORAGE_KEY = 'growth-os:msw-onboarding';

/** Rows survive a reload like the mock session does (sessionStorage), so "second sign-in" can be shown. */
function load(): Map<string, OnboardingRowState> {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
    return new Map(raw ? (JSON.parse(raw) as [string, OnboardingRowState][]) : []);
  } catch {
    return new Map();
  }
}
const rows = load();
function save(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...rows]));
  } catch {
    /* node */
  }
}

/** Clear the mock rows (tests). */
export function resetOnboardingMocks(): void {
  rows.clear();
  save();
}

const HUMANS = new Set<string>(
  Object.values(people)
    .filter((p) => p.kind === 'human')
    .map((p) => p.id),
);

function rolesOf(userId: string): { role: RoleCode; revokedAt: null }[] {
  return (roleAssignments as readonly { userId: string; role: string }[])
    .filter((r) => r.userId === userId)
    .map((r) => ({ role: r.role as RoleCode, revokedAt: null }));
}

/** The aster-demo moment (26 Nov 2026): Maya's case work is done up to G2 submitted; Elena decided G1. */
const DERIVED: Partial<Record<string, Partial<Record<GuideStepKey, boolean>>>> = {
  [people.maya.id]: {
    'build.shortlist': true,
    'build.case': true,
    'build.sizing': true,
    'build.validation': true,
    'build.submitG2': true,
  },
  [people.elena.id]: { 'decide.decide': true },
  [people.jonas.id]: { 'run.taskSync': true },
};

function stateOf(userId: string): OnboardingState {
  const path = guidePathFor(rolesOf(userId));
  const row = rows.get(userId) ?? EMPTY_ONBOARDING;
  const caseKey = userId === people.maya.id || userId === people.jonas.id ? 'ME-104' : null;
  return {
    path,
    welcomeSeen: row.welcomeSeen,
    explainer: row.explainer,
    guideDismissed: row.guideDismissed,
    steps: composeSteps(path, DERIVED[userId] ?? {}, row.visitedSteps, { caseKey }),
    coachMarksDismissed: row.coachMarksDismissed as GuideStepKey[],
    canReset: true,
    updatedAt: rows.has(userId) ? '2026-11-26T09:00:00.000Z' : null,
  };
}

function human(viewerId: string | null): string {
  if (!viewerId || !HUMANS.has(viewerId)) throw new MockProblem('AGENT_IDENTITY_FORBIDDEN', 'People only.');
  return viewerId;
}

export const handlers: HttpHandler[] = [
  mock(API.onboarding.get, ({ viewerId }) => stateOf(human(viewerId))),
  mock(API.onboarding.update, ({ viewerId, body }) => {
    const uid = human(viewerId);
    const path = guidePathFor(rolesOf(uid));
    const check = checkPatch(path, body);
    if (!check.ok) throw new MockProblem('VALIDATION_FAILED', check.reason);
    rows.set(uid, applyPatch(rows.get(uid) ?? EMPTY_ONBOARDING, body));
    save();
    return stateOf(uid);
  }),
  mock(API.onboarding.reset, ({ viewerId }) => {
    const uid = human(viewerId);
    rows.delete(uid);
    save();
    return stateOf(uid);
  }),
];
