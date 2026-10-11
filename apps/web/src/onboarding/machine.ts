/**
 * The first-run UI state machine (ONBOARDING.md §6). Pure: one layer at a time, never more than one dialog
 * or coach mark. Server state (welcome seen, explainer, steps) lives in `onboarding.get`; this machine only
 * decides what is on screen. It never blocks anything: every layer can be closed, and closing returns to idle.
 */
import type { GuideStepKey } from '@growth-os/contracts';

export type Layer =
  | { kind: 'idle' }
  | { kind: 'welcome' }
  | { kind: 'explainer'; autoPlay: boolean }
  | { kind: 'guide' }
  | { kind: 'coach'; step: GuideStepKey };

export interface UiState {
  layer: Layer;
  /** The first-login welcome was considered this session (shown or not needed). */
  triggered: boolean;
}

export type UiEvent =
  | { type: 'LOADED'; welcomeSeen: boolean; autostart: boolean }
  | { type: 'PLAY_TOUR' }
  | { type: 'TOUR_FINISHED' }
  | { type: 'TOUR_CLOSED' }
  | { type: 'SKIP_WELCOME' }
  | { type: 'OPEN_GUIDE' }
  | { type: 'CLOSE_GUIDE' }
  | { type: 'TOGGLE_GUIDE' }
  | { type: 'SHOW_ME'; step: GuideStepKey }
  | { type: 'COACH_NEXT'; step: GuideStepKey | null }
  | { type: 'COACH_CLOSE' }
  | { type: 'RESET' };

export const INITIAL_UI: UiState = { layer: { kind: 'idle' }, triggered: false };

/** Side effects the provider performs for a transition (server writes). */
export type Effect =
  | { kind: 'welcomeSeen' }
  | { kind: 'explainer'; status: 'completed' | 'skipped' }
  | { kind: 'dismissCoachMark'; step: GuideStepKey };

export function reduce(state: UiState, event: UiEvent): UiState {
  const { layer } = state;
  switch (event.type) {
    case 'LOADED':
      // First-login trigger: once per session, only when the server says the welcome was never seen and
      // the browser has not opted out of automatic first-run dialogs (automation, D-196).
      if (state.triggered) return state;
      if (!event.welcomeSeen && event.autostart && layer.kind === 'idle')
        return { layer: { kind: 'welcome' }, triggered: true };
      return { ...state, triggered: true };
    case 'PLAY_TOUR':
      return { ...state, layer: { kind: 'explainer', autoPlay: true } };
    case 'TOUR_FINISHED':
      return state; // stays open on the end card until the person closes it
    case 'TOUR_CLOSED':
      return layer.kind === 'explainer' ? { ...state, layer: { kind: 'idle' } } : state;
    case 'SKIP_WELCOME':
      return layer.kind === 'welcome' ? { ...state, layer: { kind: 'idle' } } : state;
    case 'OPEN_GUIDE':
      return { ...state, layer: { kind: 'guide' } };
    case 'CLOSE_GUIDE':
      return layer.kind === 'guide' ? { ...state, layer: { kind: 'idle' } } : state;
    case 'TOGGLE_GUIDE':
      return { ...state, layer: layer.kind === 'guide' ? { kind: 'idle' } : { kind: 'guide' } };
    case 'SHOW_ME':
      return { ...state, layer: { kind: 'coach', step: event.step } };
    case 'COACH_NEXT':
      return { ...state, layer: event.step ? { kind: 'coach', step: event.step } : { kind: 'guide' } };
    case 'COACH_CLOSE':
      return layer.kind === 'coach' ? { ...state, layer: { kind: 'idle' } } : state;
    case 'RESET':
      return { layer: { kind: 'welcome' }, triggered: true };
  }
}

/** Server writes that go with a transition. */
export function effectsOf(state: UiState, event: UiEvent): Effect[] {
  const { layer } = state;
  switch (event.type) {
    case 'PLAY_TOUR':
    case 'SKIP_WELCOME':
    case 'OPEN_GUIDE':
      return layer.kind === 'welcome' ? [{ kind: 'welcomeSeen' }] : [];
    case 'TOUR_FINISHED':
      return [{ kind: 'explainer', status: 'completed' }];
    case 'TOUR_CLOSED':
      return [{ kind: 'explainer', status: 'skipped' }]; // the server never downgrades "completed"
    case 'COACH_CLOSE':
    case 'COACH_NEXT':
      return layer.kind === 'coach' ? [{ kind: 'dismissCoachMark', step: layer.step }] : [];
    default:
      return [];
  }
}

const AUTOSTART_KEY = 'gos.onboarding.autostart';

/**
 * Automatic first-run dialogs can be turned off per browser (`localStorage[gos.onboarding.autostart] = off`).
 * Only automation sets it (the e2e harness, so unrelated journeys are not interrupted; D-196). The guide,
 * replay and every manual entry point still work.
 */
export function readAutostart(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(AUTOSTART_KEY) !== 'off';
  } catch {
    return true;
  }
}
export const AUTOSTART_STORAGE_KEY = AUTOSTART_KEY;
