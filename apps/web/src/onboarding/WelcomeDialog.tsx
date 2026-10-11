/** First sign-in welcome (ONBOARDING.md §4.1). Shown once per person; any action records it. */
import { GUIDE_PATH_LABELS, type GuidePath } from '@growth-os/contracts';
import { Icon } from '@growth-os/ui';
import { useRef } from 'react';
import { OnbDialog } from './Dialog';
import { TOUR_BUTTON_LABEL } from './explainer/script';

const ROLE_LINE: Record<GuidePath, string> = {
  build: 'You build expansion cases: shortlist, size, validate and submit them for a decision.',
  decide:
    'You decide pilot and scale investments within your authority. Nothing is approved until you decide.',
  run: 'You run approved pilots: your tasks, the plan, and what reached the task tool.',
  review: 'You review what you are asked to — confirm, dispute or abstain, always with a reason.',
  configure: 'You set up connections, roles and policies. Administrators configure; they never approve.',
};

export function WelcomeDialog({
  firstName,
  path,
  illustrative,
  onPlay,
  onGuide,
  onSkip,
}: {
  firstName: string;
  path: GuidePath;
  illustrative: boolean;
  onPlay: () => void;
  onGuide: () => void;
  onSkip: () => void;
}) {
  const play = useRef<HTMLButtonElement>(null);
  return (
    <OnbDialog
      labelledBy="onb-welcome-title"
      onEscape={onSkip}
      initialFocus={play}
      testId="onboarding-welcome"
    >
      <div className="onb-welcome">
        <span aria-hidden="true" className="app-switcher__mark onb-welcome__mark">
          <Icon name="compass" size={18} strokeWidth={1.8} />
        </span>
        <h2 id="onb-welcome-title" className="onb-welcome__title">
          Welcome to Market Expansion, {firstName}
        </h2>
        <p className="onb-welcome__lede">
          Each expansion decision lives in one case — evidence, sizing, validation, approvals, the pilot and
          the outcome — with an owner and a stage.
        </p>
        <p className="onb-welcome__role">
          <strong>{GUIDE_PATH_LABELS[path]}.</strong> {ROLE_LINE[path]}
        </p>
        {illustrative ? (
          <p className="onb-welcome__note">
            Illustrative data: Aster Industrial Systems and its people are fictional.
          </p>
        ) : null}
        <div className="onb-welcome__actions">
          <button ref={play} type="button" className="gos-btn gos-btn--primary" onClick={onPlay}>
            {TOUR_BUTTON_LABEL}
          </button>
          <button type="button" className="gos-btn gos-btn--secondary" onClick={onGuide}>
            Show me around
          </button>
          <button type="button" className="gos-btn gos-btn--ghost" onClick={onSkip}>
            Skip for now
          </button>
        </div>
        <p className="onb-welcome__hint">
          The tour is narrated, with captions on and music you can turn off. You can replay it, or open the
          guide, from the Guide button or your account menu.
        </p>
      </div>
    </OnbDialog>
  );
}
