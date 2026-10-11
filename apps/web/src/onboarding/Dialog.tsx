/**
 * Modal dialog for the welcome and the explainer (APG dialog pattern): named by its heading, focus moves in
 * and is trapped, Escape closes, focus returns to where it was. Same behaviour as the shell's Modal, with a
 * width option for the player.
 */
import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

export function OnbDialog({
  labelledBy,
  onEscape,
  children,
  wide = false,
  initialFocus,
  testId,
}: {
  labelledBy: string;
  onEscape: () => void;
  children: ReactNode;
  wide?: boolean;
  initialFocus?: React.RefObject<HTMLElement | null>;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => {
      if (prev && document.contains(prev)) prev.focus?.();
    };
  }, [initialFocus]);
  return (
    <div className="app-dialog-backdrop onb-backdrop">
      <div
        ref={ref}
        className={`app-dialog onb-dialog${wide ? ' onb-dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-testid={testId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onEscape();
            return;
          }
          if (e.key !== 'Tab' || !ref.current) return;
          const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => !el.closest('[hidden]'),
          );
          if (!items.length) return;
          const first = items[0]!;
          const last = items[items.length - 1]!;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
