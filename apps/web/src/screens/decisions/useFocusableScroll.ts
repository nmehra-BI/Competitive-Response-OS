/**
 * Horizontal table scrollers must be keyboard reachable (WCAG 2.1.1, axe
 * "scrollable-region-focusable"). The shared `DataTable` scroll container is not focusable, so
 * WS8c screens make every `.gos-table-scroll` inside `ref` a named, focusable region.
 * (Change request for WS7 in the WS8c notes: do this in `DataTable` itself.)
 */
import { useEffect, type RefObject } from 'react';

export function useFocusableScroll(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('.gos-table-scroll').forEach((el) => {
      if (el.tabIndex < 0) el.tabIndex = 0;
      if (!el.getAttribute('role')) el.setAttribute('role', 'region');
      if (!el.getAttribute('aria-label')) {
        const t = el.querySelector('table');
        const name = t?.getAttribute('aria-label') ?? t?.querySelector('caption')?.textContent ?? 'Table';
        el.setAttribute('aria-label', `${name} (scrollable)`);
      }
    });
    // Re-run whenever the caller's rendered content changes.
  }, [ref, ...deps]);
}
