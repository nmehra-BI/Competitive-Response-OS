/**
 * Entry points the AppShell mounts (ONBOARDING.md §4.2, §4.5): the top-bar Guide button with progress, the
 * account-menu items (replay the tour, open the guide, demo reset) and the ⌘K "Guide" command. Each renders
 * nothing outside the OnboardingProvider.
 */
import { Icon } from '@growth-os/ui';
import { useOnboarding } from './OnboardingProvider';

export function GuideButton() {
  const o = useOnboarding();
  if (!o?.state) return null;
  const open = o.ui.layer.kind === 'guide';
  const showProgress = !o.state.guideDismissed && o.progress && o.progress.done < o.progress.total;
  return (
    <button
      id="onb-guide-button"
      type="button"
      className="onb-guide-btn"
      aria-expanded={open}
      aria-haspopup="dialog"
      data-guide="guide-button"
      onClick={o.toggleGuide}
    >
      <Icon name="help" size={16} />
      <span>Guide</span>
      {showProgress ? (
        <span className="onb-guide-btn__progress">
          <span className="gos-sr-only">, </span>
          {`${o.progress!.done} of ${o.progress!.total}`}
          <span className="gos-sr-only"> complete</span>
        </span>
      ) : null}
    </button>
  );
}

export function GuideMenuItems({ onSelect }: { onSelect: () => void }) {
  const o = useOnboarding();
  if (!o?.state) return null;
  return (
    <div className="onb-menu" role="group" aria-label="Getting started">
      <button
        type="button"
        className="gos-btn gos-btn--ghost onb-menu__item"
        onClick={() => {
          onSelect();
          o.replayTour();
        }}
      >
        <Icon name="rocket" size={15} />
        Replay the tour
      </button>
      <button
        type="button"
        className="gos-btn gos-btn--ghost onb-menu__item"
        onClick={() => {
          onSelect();
          o.openGuide();
        }}
      >
        <Icon name="help" size={15} />
        Open the guide
      </button>
      {o.state.canReset ? (
        <button
          type="button"
          className="gos-btn gos-btn--ghost onb-menu__item"
          onClick={() => {
            onSelect();
            o.reset();
          }}
        >
          <Icon name="refresh" size={15} />
          Reset onboarding (demo)
        </button>
      ) : null}
    </div>
  );
}

/** ⌘K: does the search term ask for the guide? */
export function wantsGuide(term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  return (
    'guide'.startsWith(t) ||
    'getting started'.startsWith(t) ||
    'tour'.startsWith(t) ||
    'help'.startsWith(t) ||
    'onboarding'.startsWith(t) ||
    t.startsWith('guide') ||
    t.startsWith('tour')
  );
}
