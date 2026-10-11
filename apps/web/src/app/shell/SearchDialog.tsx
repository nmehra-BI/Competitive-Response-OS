/**
 * ⌘K search. Finds cases, opportunities, assumptions, experiments and sources the viewer can
 * access. It only navigates: it never offers Approve or any other command (FRONTEND §8).
 */
import { API, type SearchHit } from '@growth-os/contracts';
import { Icon, Kbd, Mono, type IconName } from '@growth-os/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '../../lib/query';
// Onboarding hook (D-195): ⌘K "Guide" opens the Getting started guide.
import { wantsGuide } from '../../onboarding/GuideEntryPoints';
import { useOnboarding } from '../../onboarding/OnboardingProvider';
import { Modal } from './Modal';

const TYPE_ICON: Record<SearchHit['type'], IconName> = {
  case: 'briefcase',
  opportunity: 'compass',
  assumption: 'pencilruler',
  experiment: 'target',
  source: 'filetext',
  mandate: 'flag',
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const navigate = useNavigate();
  const term = useDebounced(q.trim(), 180);
  const { data, isFetching } = useApiQuery(
    API.search.search,
    { query: { q: term, limit: 10 } },
    { enabled: term.length > 0, staleTime: 10_000 },
  );
  const hits = term ? (data?.hits ?? []) : [];
  // Onboarding hook (D-195): a pinned "Guide" command when the term asks for it. It only opens the guide.
  const onboarding = useOnboarding();
  const guide = onboarding?.state && wantsGuide(q) ? onboarding : null;
  const options: {
    id: string;
    title: string;
    subtitle: string;
    key: string | null;
    icon: IconName;
    run: () => void;
  }[] = [
    ...(guide
      ? [
          {
            id: 'guide',
            title: 'Guide · Getting started',
            subtitle: 'Your steps, what to do next, and the tour',
            key: null,
            icon: 'help' as IconName,
            run: () => guide.openGuide(),
          },
        ]
      : []),
    ...hits.map((h) => ({
      id: h.id,
      title: h.title,
      subtitle: h.subtitle,
      key: h.key,
      icon: TYPE_ICON[h.type],
      run: () => navigate(h.href),
    })),
  ];
  const go = (o: (typeof options)[number] | undefined) => {
    if (!o) return;
    onClose();
    o.run();
  };
  const activeHit = options[Math.min(active, options.length - 1)];
  return (
    <Modal label="Search" onClose={onClose} initialFocus={input}>
      <div className="app-search-input">
        <Icon name="search" size={16} />
        <input
          ref={input}
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search cases, opportunities, assumptions, experiments and sources"
          aria-activedescendant={activeHit ? `${listId}-${activeHit.id}` : undefined}
          placeholder="Search cases, opportunities, assumptions, sources"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(activeHit);
            }
          }}
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul id={listId} role="listbox" aria-label="Results" className="app-search-results">
        {options.map((h, i) => (
          <li
            key={h.id}
            id={`${listId}-${h.id}`}
            role="option"
            aria-selected={i === active}
            className="app-search-hit"
            onMouseMove={() => setActive(i)}
            onClick={() => go(h)}
          >
            <span style={{ color: 'var(--text-secondary)', display: 'inline-flex' }}>
              <Icon name={h.icon} size={16} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>{h.title}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-tertiary)' }}>
                {h.subtitle}
              </span>
            </span>
            {h.key ? <Mono size={12}>{h.key}</Mono> : null}
          </li>
        ))}
      </ul>
      <div role="status" aria-live="polite" className="app-search-foot">
        {!term ? (
          <span>Type to search. Results include only what you can access.</span>
        ) : isFetching && !data ? (
          <span>Searching…</span>
        ) : hits.length ? (
          <span>
            {hits.length} result{hits.length > 1 ? 's' : ''} · ↑↓ to move · Enter to open
          </span>
        ) : (
          <span>No results you can access.</span>
        )}
      </div>
    </Modal>
  );
}
