/**
 * Tabs for My Work and the Reviews inbox (WAI-ARIA tabs pattern): arrow keys, Home and End move
 * between tabs; the selected tab is written to the `tab` deep link by the caller.
 */
import { useRef, type ReactNode } from 'react';

export interface TabDef<K extends string> {
  key: K;
  label: string;
  count: number;
}

export function WorkTabs<K extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
}: {
  label: string;
  tabs: TabDef<K>[];
  value: K;
  onChange: (k: K) => void;
  idPrefix: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    refs.current[n]?.focus();
    onChange(tabs[n]!.key);
  };
  return (
    <div role="tablist" aria-label={label} className="dx-tabs">
      {tabs.map((t, i) => (
        <button
          key={t.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.key}`}
          aria-selected={t.key === value}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={t.key === value ? 0 : -1}
          className="dx-tab"
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') move(i + 1);
            else if (e.key === 'ArrowLeft') move(i - 1);
            else if (e.key === 'Home') move(0);
            else if (e.key === 'End') move(tabs.length - 1);
            else return;
            e.preventDefault();
          }}
        >
          {t.label}
          <span className="dx-count">{t.count}</span>
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  value,
  children,
}: {
  idPrefix: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${value}`}>
      {children}
    </div>
  );
}
