/**
 * First-run onboarding layer (ONBOARDING.md; decisions.md D-190 onward). Mounted once by the AppShell.
 *
 * - Reads the person's guide state from `onboarding.get` (server truth: it follows them across devices).
 * - Shows the welcome dialog on the first sign-in only (server `welcomeSeen = false`), never before a click
 *   plays anything, and never more than one layer at a time (machine.ts).
 * - Marks "visit" steps when the person opens the place they name; state steps come from the server.
 * - Every write is one `onboarding.update` command (audited); writes are serialized.
 */
import {
  API,
  type GuideStep,
  type GuideStepKey,
  type OnboardingPatch,
  type OnboardingState,
} from '@growth-os/contracts';
import { visitStepsFor } from '@growth-os/domain';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, queryKey } from '../lib/api-client';
import { newIdempotencyKey } from '../lib/idempotency';
import { useApiQuery } from '../lib/query';
import { CoachMark } from './CoachMark';
import { OnbDialog } from './Dialog';
import { ExplainerPlayer } from './explainer/ExplainerPlayer';
import { GuidePanel } from './GuidePanel';
import {
  effectsOf,
  INITIAL_UI,
  readAutostart,
  reduce,
  type Effect,
  type UiEvent,
  type UiState,
} from './machine';
import { nextAction, type NextAction } from './next';
import { WelcomeDialog } from './WelcomeDialog';
import './onboarding.css';

export interface OnboardingViewer {
  firstName: string;
  displayName: string;
  initials: string;
  illustrative: boolean;
}

export interface OnboardingApi {
  state: OnboardingState | undefined;
  ui: UiState;
  next: NextAction | null;
  progress: { done: number; total: number } | null;
  openGuide: () => void;
  toggleGuide: () => void;
  replayTour: () => void;
  reset: () => void;
}

const Ctx = createContext<OnboardingApi | null>(null);

/** The onboarding API, or null outside the provider (components then render nothing). */
export function useOnboarding(): OnboardingApi | null {
  return useContext(Ctx);
}

type Reducer = (s: { ui: UiState; effects: Effect[] }, e: UiEvent) => { ui: UiState; effects: Effect[] };
const withEffects: Reducer = (s, e) => ({ ui: reduce(s.ui, e), effects: effectsOf(s.ui, e) });

function patchFor(effect: Effect): OnboardingPatch {
  if (effect.kind === 'welcomeSeen') return { welcomeSeen: true };
  if (effect.kind === 'explainer') return { explainer: effect.status };
  return { dismissCoachMark: effect.step };
}

export function OnboardingProvider({ viewer, children }: { viewer: OnboardingViewer; children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const query = useApiQuery(API.onboarding.get, {}, { retry: false, staleTime: 60_000 });
  const inbox = useApiQuery(API.work.reviewsInbox, { query: {} }, { retry: false });
  const state = query.data;
  const [{ ui, effects }, dispatch] = useReducer(withEffects, { ui: INITIAL_UI, effects: [] });
  const [announcement, setAnnouncement] = useState('');
  const [resetting, setResetting] = useState(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  /** Serialized write; the response is the new state. */
  const write = useCallback(
    (body: OnboardingPatch) => {
      chain.current = chain.current
        .catch(() => undefined)
        .then(async () => {
          const next = await api(API.onboarding.update, { body, idempotencyKey: newIdempotencyKey() });
          qc.setQueryData(queryKey(API.onboarding.get), next);
        })
        .catch(() => undefined); // onboarding never blocks work; a failed write is retried on the next action
      return chain.current;
    },
    [qc],
  );

  // Perform the server writes a transition asked for.
  useEffect(() => {
    for (const e of effects) void write(patchFor(e));
  }, [effects, write]);

  // First-login trigger.
  useEffect(() => {
    if (state) dispatch({ type: 'LOADED', welcomeSeen: state.welcomeSeen, autostart: readAutostart() });
  }, [state]);

  // Visit steps complete when the person opens the place they name.
  const pending = useRef(new Set<string>());
  useEffect(() => {
    if (!state) return;
    for (const key of visitStepsFor(state.path, location.pathname)) {
      const step = state.steps.find((s) => s.key === key);
      if (!step || step.done || pending.current.has(key)) continue;
      pending.current.add(key);
      void write({ visitedStep: key }).finally(() => pending.current.delete(key));
    }
  }, [state, location.pathname, write]);

  // Announce newly completed steps (polite live region).
  const seenDone = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!state) return;
    const now = new Set(state.steps.filter((s) => s.done).map((s) => s.key));
    if (seenDone.current) {
      const fresh = state.steps.find((s) => s.done && !seenDone.current!.has(s.key));
      if (fresh) setAnnouncement(`Step complete: ${fresh.title}`);
    }
    seenDone.current = now;
  }, [state]);

  const next = useMemo(() => (state ? nextAction(state.steps, inbox.data) : null), [state, inbox.data]);
  const progress = useMemo(
    () => (state ? { done: state.steps.filter((s) => s.done).length, total: state.steps.length } : null),
    [state],
  );

  const showMe = useCallback(
    (step: GuideStep) => {
      navigate(step.href);
      dispatch({ type: 'SHOW_ME', step: step.key });
    },
    [navigate],
  );

  const reset = useCallback(async () => {
    setResetting(true);
    try {
      const fresh = await api(API.onboarding.reset, { idempotencyKey: newIdempotencyKey() });
      qc.setQueryData(queryKey(API.onboarding.get), fresh);
      seenDone.current = null;
      dispatch({ type: 'RESET' });
      setAnnouncement('Onboarding reset. The welcome is showing again.');
    } finally {
      setResetting(false);
    }
  }, [qc]);

  const apiValue = useMemo<OnboardingApi>(
    () => ({
      state,
      ui,
      next,
      progress,
      openGuide: () => dispatch({ type: 'OPEN_GUIDE' }),
      toggleGuide: () => dispatch({ type: 'TOGGLE_GUIDE' }),
      replayTour: () => dispatch({ type: 'PLAY_TOUR' }),
      reset: () => void reset(),
    }),
    [state, ui, next, progress, reset],
  );

  const layer = ui.layer;
  const coachStep = layer.kind === 'coach' ? state?.steps.find((s) => s.key === layer.step) : undefined;
  const coachIndex = coachStep && state ? state.steps.indexOf(coachStep) : -1;
  const nextAfter = (key: GuideStepKey): GuideStep | null => {
    if (!state) return null;
    const i = state.steps.findIndex((s) => s.key === key);
    return state.steps.slice(i + 1).find((s) => !s.done) ?? state.steps.slice(i + 1)[0] ?? null;
  };

  return (
    <Ctx.Provider value={apiValue}>
      {children}
      <div aria-live="polite" className="gos-sr-only" data-testid="onboarding-live">
        {announcement}
      </div>
      {state && ui.layer.kind === 'welcome' ? (
        <WelcomeDialog
          firstName={viewer.firstName}
          path={state.path}
          illustrative={viewer.illustrative}
          onPlay={() => dispatch({ type: 'PLAY_TOUR' })}
          onGuide={() => dispatch({ type: 'OPEN_GUIDE' })}
          onSkip={() => dispatch({ type: 'SKIP_WELCOME' })}
        />
      ) : null}
      {state && ui.layer.kind === 'explainer' ? (
        <OnbDialog
          labelledBy="onb-player-title"
          wide
          onEscape={() => dispatch({ type: 'TOUR_CLOSED' })}
          testId="onboarding-explainer"
        >
          <ExplainerPlayer
            path={state.path}
            name={viewer.displayName}
            initials={viewer.initials}
            autoPlay={ui.layer.autoPlay}
            onFinished={() => dispatch({ type: 'TOUR_FINISHED' })}
            onSkip={() => dispatch({ type: 'TOUR_CLOSED' })}
            onDone={(href) => {
              dispatch({ type: 'TOUR_CLOSED' });
              if (href) navigate(href);
            }}
          />
        </OnbDialog>
      ) : null}
      {state && next && ui.layer.kind === 'guide' ? (
        <GuidePanel
          state={state}
          next={next}
          onClose={() => {
            dispatch({ type: 'CLOSE_GUIDE' });
            document.getElementById('onb-guide-button')?.focus();
          }}
          onShowMe={showMe}
          onReplay={() => dispatch({ type: 'PLAY_TOUR' })}
          onSkipGuide={() => void write({ guideDismissed: true })}
          onResumeGuide={() => void write({ guideDismissed: false })}
          onReset={() => void reset()}
          resetting={resetting}
        />
      ) : null}
      {state && coachStep ? (
        <CoachMark
          step={coachStep}
          index={coachIndex}
          total={state.steps.length}
          hasNext={!!nextAfter(coachStep.key)}
          onNext={() => {
            const n = nextAfter(coachStep.key);
            if (n) navigate(n.href);
            dispatch({ type: 'COACH_NEXT', step: n?.key ?? null });
          }}
          onClose={() => dispatch({ type: 'COACH_CLOSE' })}
          ready={location.pathname === coachStep.href.split('?')[0]}
        />
      ) : null}
    </Ctx.Provider>
  );
}
