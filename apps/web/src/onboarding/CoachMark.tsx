/**
 * Coach mark (ONBOARDING.md §4.3): a NON-modal dialog anchored to a real element (APG: content with buttons is
 * a dialog, not a tooltip). One at a time, no backdrop, never covers its anchor. Focus moves to its heading;
 * Escape or × closes and returns focus to the anchor (or the Guide button). If no anchor appears within 3 s it
 * docks under the top bar with the step's link instead of pointing at nothing.
 */
import type { GuideStep } from '@growth-os/contracts';
import { Icon } from '@growth-os/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const GAP = 12;
const WIDTH = 320;
export const ANCHOR_WAIT_MS = 3000;
/** Each less specific anchor becomes acceptable this much later (the screen may still be loading). */
export const ANCHOR_FALLBACK_STEP_MS = 700;

/**
 * First visible element for the selectors, most specific first. `upTo` limits how far down the list may go:
 * the coach mark gives the specific anchors time to render before it settles for a general one.
 */
export function findAnchor(
  selectors: readonly string[],
  root: ParentNode = document,
  upTo: number = selectors.length - 1,
): HTMLElement | null {
  for (const sel of selectors.slice(0, upTo + 1)) {
    let el: HTMLElement | null = null;
    try {
      el = root.querySelector<HTMLElement>(sel);
    } catch {
      continue; // an invalid selector never breaks the guide
    }
    // Visible only: a screen that is still being replaced (hidden by a pending navigation) never counts.
    const visible = typeof el?.checkVisibility === 'function' ? el.checkVisibility() : !!el?.isConnected;
    if (el && visible) return el;
  }
  return null;
}

interface Placement {
  top: number;
  left: number;
  side: 'below' | 'above' | 'docked';
  arrowLeft: number;
}

function place(anchor: HTMLElement | null, height: number): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!anchor) return { top: 72, left: Math.max(16, vw - WIDTH - 24), side: 'docked', arrowLeft: 0 };
  const r = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(16, r.left + r.width / 2 - WIDTH / 2), vw - WIDTH - 16);
  const below = r.bottom + GAP;
  const side = below + height <= vh - 8 || r.top - GAP - height < 8 ? 'below' : 'above';
  const top = side === 'below' ? below : r.top - GAP - height;
  const arrowLeft = Math.min(Math.max(16, r.left + r.width / 2 - left), WIDTH - 16);
  return { top, left, side, arrowLeft };
}

export function CoachMark({
  step,
  index,
  total,
  hasNext,
  onNext,
  onClose,
  ready = true,
}: {
  /** The page the step names is on screen (the provider compares the location with the step's link). */
  ready?: boolean;
  step: GuideStep;
  index: number;
  total: number;
  hasNext: boolean;
  onNext: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [pos, setPos] = useState<Placement | null>(null);

  // Wait for the anchor (the screen may still be loading after "Show me" navigated).
  useEffect(() => {
    setAnchor(null);
    setGaveUp(false);
    if (!ready) return undefined;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      const upTo = Math.floor((Date.now() - started) / ANCHOR_FALLBACK_STEP_MS);
      const el = findAnchor(step.anchors, document, upTo);
      if (el) {
        setAnchor(el);
        return;
      }
      if (Date.now() - started >= ANCHOR_WAIT_MS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(look, 150);
    };
    look();
    return () => clearTimeout(timer);
  }, [step.key, step.anchors, ready]);

  // Highlight the anchor and keep it in view.
  useEffect(() => {
    if (!anchor) return undefined;
    anchor.classList.add('onb-anchor');
    anchor.setAttribute('data-coach-anchor', step.key);
    anchor.scrollIntoView?.({ block: 'nearest' });
    return () => {
      anchor.classList.remove('onb-anchor');
      anchor.removeAttribute('data-coach-anchor');
    };
  }, [anchor, step.key]);

  useLayoutEffect(() => {
    if (!anchor && !gaveUp) return undefined;
    const update = () => setPos(place(anchor, box.current?.offsetHeight ?? 160));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor, gaveUp]);

  // Focus in when shown; out to the anchor (if it takes focus) or the Guide button when closed.
  const focusedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pos || focusedFor.current === step.key) return;
    focusedFor.current = step.key;
    heading.current?.focus();
  }, [pos, step.key]);
  const anchorRef = useRef<HTMLElement | null>(null);
  anchorRef.current = anchor;
  useEffect(
    () => () => {
      const a = anchorRef.current;
      const target =
        a && a.isConnected && a.matches('a[href],button,input,select,textarea,[tabindex]')
          ? a
          : document.getElementById('onb-guide-button');
      target?.focus?.();
    },
    [],
  );

  const visible = pos !== null;
  return (
    <div
      ref={box}
      className={`onb-coach onb-coach--${pos?.side ?? 'below'}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="onb-coach-title"
      aria-describedby="onb-coach-body"
      data-testid="coach-mark"
      data-step={step.key}
      data-anchored={anchor ? 'true' : 'false'}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: visible ? 'visible' : 'hidden' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {pos && pos.side !== 'docked' ? (
        <span
          className={`onb-coach__arrow onb-coach__arrow--${pos.side}`}
          style={{ left: pos.arrowLeft - 6 }}
        />
      ) : null}
      <div className="onb-coach__head">
        <span className="onb-coach__count">{`Step ${index + 1} of ${total}`}</span>
        <button type="button" className="gos-ibtn" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <h2 id="onb-coach-title" ref={heading} tabIndex={-1} className="onb-coach__title">
        {step.title}
      </h2>
      <p id="onb-coach-body" className="onb-coach__body">
        {step.why}
      </p>
      {!anchor && gaveUp ? (
        <p className="onb-coach__fallback">
          This part of the screen is not shown here yet. <Link to={step.href}>Go to it</Link>.
        </p>
      ) : null}
      <div className="onb-coach__actions">
        {hasNext ? (
          <button type="button" className="gos-btn gos-btn--primary" onClick={onNext}>
            Next
          </button>
        ) : null}
        <button type="button" className="gos-btn gos-btn--ghost" onClick={onClose}>
          {hasNext ? 'Close for now' : 'Got it'}
        </button>
      </div>
    </div>
  );
}
