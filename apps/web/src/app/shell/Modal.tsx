import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

/** Modal dialog: traps focus, closes on Escape or backdrop click, restores focus on close. */
export function Modal({
  label,
  onClose,
  children,
  initialFocus,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => prev?.focus?.();
  }, [initialFocus]);
  return (
    <div
      className="app-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key !== 'Tab' || !ref.current) return;
          const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
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
