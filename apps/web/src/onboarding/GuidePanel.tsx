/**
 * "Getting started" guide (ONBOARDING.md §4.2): a non-modal side panel. Path, progress, the state-driven Next
 * card, the role checklist with "Show me", replay, skip/resume and (illustrative workspaces only) reset.
 * Escape closes it and focus returns to the Guide button.
 */
import { GUIDE_PATH_LABELS, type GuideStep, type OnboardingState } from '@growth-os/contracts';
import { Icon } from '@growth-os/ui';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { GuideEmptyState } from './GuideEmptyState';
import type { NextAction } from './next';

export function GuidePanel({
  state,
  next,
  onClose,
  onShowMe,
  onReplay,
  onSkipGuide,
  onResumeGuide,
  onReset,
  resetting,
}: {
  state: OnboardingState;
  next: NextAction;
  onClose: () => void;
  onShowMe: (step: GuideStep) => void;
  onReplay: () => void;
  onSkipGuide: () => void;
  onResumeGuide: () => void;
  onReset: () => void;
  resetting: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const done = state.steps.filter((s) => s.done).length;
  const total = state.steps.length;
  return (
    <aside
      className="onb-panel"
      aria-labelledby="onb-panel-title"
      data-testid="guide-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="onb-panel__head">
        <div>
          <h2 id="onb-panel-title" ref={heading} tabIndex={-1} className="onb-panel__title">
            Getting started
          </h2>
          <p className="onb-panel__path">{GUIDE_PATH_LABELS[state.path]}</p>
        </div>
        <button type="button" className="gos-ibtn" aria-label="Close the guide" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="onb-panel__progress">
        <span>{`${done} of ${total} complete`}</span>
        <span className="onb-meter" aria-hidden="true">
          <span className="onb-meter__fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </span>
      </div>

      {next.kind === 'complete' ? (
        <GuideEmptyState
          title="What this place is for"
          body="Your guide is complete. Use it again whenever you join a new case or role."
          next={null}
        />
      ) : (
        <section className="onb-next" aria-labelledby="onb-next-title">
          <p className="onb-next__eyebrow">Next</p>
          <h3 id="onb-next-title" className="onb-next__title">
            {next.title}
          </h3>
          <p className="onb-next__detail">{next.detail}</p>
          <div className="onb-next__actions">
            {next.step ? (
              <button type="button" className="gos-btn gos-btn--primary" onClick={() => onShowMe(next.step!)}>
                Show me
              </button>
            ) : null}
            {next.href ? (
              <Link to={next.href} className="gos-btn gos-btn--secondary" onClick={onClose}>
                {next.kind === 'decision'
                  ? 'Open the decision'
                  : next.kind === 'review'
                    ? 'Open Reviews'
                    : 'Go there'}
              </Link>
            ) : null}
          </div>
        </section>
      )}

      <ol className="onb-steps" aria-label="Your steps">
        {state.steps.map((s, i) => (
          <li key={s.key} className={`onb-step${s.done ? ' onb-step--done' : ''}`} data-step={s.key}>
            <span className="onb-step__glyph" aria-hidden="true">
              {s.done ? <Icon name="checkcircle" size={16} /> : <span className="onb-step__n">{i + 1}</span>}
            </span>
            <span className="onb-step__body">
              <span className="onb-step__title">{s.title}</span>
              <span className="onb-step__status">{s.done ? 'Complete' : 'To do'}</span>
              <span className="onb-step__why">{s.why}</span>
              <span className="onb-step__actions">
                <button
                  type="button"
                  className="gos-btn gos-btn--ghost onb-step__show"
                  onClick={() => onShowMe(s)}
                  aria-label={`Show me: ${s.title}`}
                >
                  Show me
                </button>
              </span>
            </span>
          </li>
        ))}
      </ol>

      <div className="onb-panel__foot">
        <button type="button" className="gos-btn gos-btn--ghost" onClick={onReplay}>
          Play the tour again
        </button>
        {state.guideDismissed ? (
          <button type="button" className="gos-btn gos-btn--ghost" onClick={onResumeGuide}>
            Resume guide
          </button>
        ) : (
          <button type="button" className="gos-btn gos-btn--ghost" onClick={onSkipGuide}>
            Skip guide
          </button>
        )}
        {state.canReset ? (
          <button
            type="button"
            className="gos-btn gos-btn--ghost"
            onClick={onReset}
            disabled={resetting}
            aria-describedby="onb-reset-note"
          >
            Reset onboarding (demo)
          </button>
        ) : null}
      </div>
      {state.canReset ? (
        <p id="onb-reset-note" className="onb-panel__note">
          Demo workspace only: shows the welcome and the guide again for you. Your work is not changed.
        </p>
      ) : null}
    </aside>
  );
}
