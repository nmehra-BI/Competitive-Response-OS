/**
 * AppShell (common.py shell()): illustrative-data ribbon, sidebar with the Growth OS app switcher
 * and navigation, top bar with ⌘K search, save status, notifications and the signed-in person.
 * Administration is hidden (not disabled) for non-admins.
 */
import type { Viewer } from '@growth-os/contracts';
import {
  AutosaveStatus,
  Avatar,
  Icon,
  IllustrativeDataBar,
  Kbd,
  toIconName,
  type AppShellProps,
  type IconName,
} from '@growth-os/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { applyTheme, readTheme, type ThemePref } from '../../lib/theme';
import { GLOBAL_NAV } from '../routes';
import { Modal } from './Modal';
import { SearchDialog } from './SearchDialog';

export const WORKSPACE_NAV = [
  { label: 'Mandates', to: '/me/mandates', icon: 'flag' },
  { label: 'Compare', to: '/me/opportunities/compare', icon: 'compare' },
  { label: 'Design foundations', to: '/design-system', icon: 'layers' },
] as const;

export interface AppShellViewProps extends AppShellProps {
  viewer: Viewer;
  onSignOut: () => void;
}

function NavItem({
  label,
  to,
  icon,
  active,
  count,
}: {
  label: string;
  to: string;
  icon: string;
  active: boolean;
  count?: number;
}) {
  return (
    <li>
      <Link to={to} className="app-navitem" aria-current={active ? 'page' : undefined}>
        <Icon name={toIconName(icon) ?? 'dot'} size={16} />
        <span>{label}</span>
        {count ? (
          <span className="app-navitem__count">
            {count}
            <span className="gos-sr-only"> waiting on you</span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function AppSwitcher({ isAdmin, tenantName }: { isAdmin: boolean; tenantName: string }) {
  return (
    <details className="app-switcher">
      <summary aria-label="Switch Growth OS app. Current app: Market Expansion">
        <span aria-hidden="true" className="app-switcher__mark">
          <Icon name="compass" size={16} strokeWidth={1.8} />
        </span>
        <span className="app-switcher__text">
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Growth OS · {tenantName}</span>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Market Expansion</span>
        </span>
        <span style={{ color: 'var(--text-tertiary)' }}>
          <Icon name="chevd" size={14} />
        </span>
      </summary>
      <div className="app-switcher__panel">
        <h2
          style={{
            fontSize: 11.5,
            color: 'var(--text-tertiary)',
            padding: '4px 8px 6px',
            fontWeight: 500,
            margin: 0,
          }}
        >
          Growth OS apps
        </h2>
        <ul className="gos-list-plain">
          <li>
            <Link
              to="/"
              className="app-switcher__item"
              aria-current="true"
              style={{ background: 'var(--bg-canvas)', alignItems: 'center' }}
            >
              <Icon name="compass" size={16} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>Market Expansion</span>
              <span
                style={{
                  color: 'var(--success-fg)',
                  display: 'inline-flex',
                  gap: 4,
                  alignItems: 'center',
                  fontSize: 12,
                }}
              >
                <Icon name="check" size={13} strokeWidth={2.2} />
                Current
              </span>
            </Link>
          </li>
          <li className="app-switcher__item" aria-disabled="true" style={{ color: 'var(--text-tertiary)' }}>
            <Icon name="shieldhalf2" size={16} />
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', lineHeight: '17px' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                Competitive Response
              </span>
              <span style={{ fontSize: 12 }}>Not enabled in this workspace</span>
            </span>
          </li>
        </ul>
        {isAdmin ? (
          <>
            <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
            <Link
              to="/admin/health"
              className="app-switcher__item"
              style={{ color: 'var(--text-secondary)', fontSize: 13, alignItems: 'center' }}
            >
              <Icon name="settings" size={15} />
              Growth OS settings
            </Link>
          </>
        ) : null}
      </div>
    </details>
  );
}

function UserMenu({ viewer, onSignOut }: { viewer: Viewer; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(readTheme());
  const panelId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div
      ref={wrap}
      style={{ position: 'relative' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        className="app-user"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar initials={viewer.person.initials} />
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '15px' }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{viewer.person.displayName}</span>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{viewer.person.title}</span>
        </span>
        <span className="gos-sr-only">Account and display settings</span>
      </button>
      {open ? (
        <div id={panelId} className="app-popover">
          <fieldset className="gos-field" style={{ padding: 4 }}>
            <legend style={{ marginBottom: 4 }}>Theme</legend>
            {(['light', 'dark', 'system'] as const).map((t) => (
              <label key={t} className="gos-radio">
                <input
                  type="radio"
                  name="theme"
                  checked={theme === t}
                  onChange={() => {
                    setTheme(t);
                    applyTheme(t);
                  }}
                />
                {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'Match system'}
              </label>
            ))}
          </fieldset>
          <div style={{ height: 1, background: 'var(--border-subtle)' }} />
          <button
            type="button"
            className="gos-btn gos-btn--ghost"
            style={{ justifyContent: 'flex-start' }}
            onClick={onSignOut}
          >
            <Icon name="logout" size={15} />
            Switch persona
          </button>
        </div>
      ) : null}
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['⌘K / Ctrl K', 'Search'],
  ['s · d · m', 'Shortlist · dismiss · merge (Opportunities)'],
  [']', 'Toggle the context panel'],
  ['?', 'Keyboard shortcuts'],
];

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

export function AppShell({
  activeNav,
  counts = {},
  illustrative,
  autosave,
  children,
  viewer,
  onSignOut,
}: AppShellViewProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === '?' && !isTyping(e.target)) {
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const nav = GLOBAL_NAV.filter((n) => !('adminOnly' in n && n.adminOnly) || viewer.isAdmin);
  return (
    <div className="app-root">
      <a href="#main" className="app-skip">
        Skip to main content
      </a>
      {illustrative ? <IllustrativeDataBar tenantName={viewer.tenant.name} /> : null}
      <div className="app-frame">
        <nav aria-label="Primary" className="app-nav">
          <AppSwitcher isAdmin={viewer.isAdmin} tenantName={viewer.tenant.name} />
          <ul className="app-nav__list">
            {nav.map((n) => (
              <NavItem
                key={n.to}
                label={n.label}
                to={n.to}
                icon={n.icon}
                active={activeNav === n.label}
                count={counts[n.label]}
              />
            ))}
          </ul>
          <div className="app-nav__divider" />
          <h2 className="app-nav__heading">Workspace</h2>
          <ul className="app-nav__list">
            {WORKSPACE_NAV.map((n) => (
              <NavItem key={n.to} label={n.label} to={n.to} icon={n.icon} active={activeNav === n.label} />
            ))}
          </ul>
          <button type="button" className="app-nav__foot" onClick={() => setHelpOpen(true)}>
            <Kbd>?</Kbd> Keyboard shortcuts
          </button>
        </nav>
        <div className="app-main-panel">
          <header className="app-header">
            <button
              type="button"
              className="app-search-btn"
              aria-label="Search cases, opportunities, assumptions, experiments and sources"
              aria-keyshortcuts="Meta+K Control+K"
              onClick={() => setSearchOpen(true)}
            >
              <Icon name="search" size={15} />
              <span>Search cases, opportunities, assumptions, sources</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 3 }} aria-hidden="true">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <div className="app-header__right">
              {autosave ? <AutosaveStatus state={autosave} /> : null}
              <button
                type="button"
                className="gos-ibtn"
                aria-label="Notifications"
                onClick={() => navigate('/my-work')}
              >
                <Icon name="bell" size={17} />
              </button>
              <UserMenu viewer={viewer} onSignOut={onSignOut} />
            </div>
          </header>
          <main id="main" className="app-main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      {searchOpen ? <SearchDialog onClose={() => setSearchOpen(false)} /> : null}
      {helpOpen ? (
        <Modal label="Keyboard shortcuts" onClose={() => setHelpOpen(false)}>
          <div
            style={{
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16, flex: 1 }}>Keyboard shortcuts</h2>
            <button type="button" className="gos-ibtn" aria-label="Close" onClick={() => setHelpOpen(false)}>
              <Icon name={'x' as IconName} size={16} />
            </button>
          </div>
          <dl
            style={{
              margin: 0,
              padding: '12px 16px 16px',
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '8px 16px',
              fontSize: 13,
            }}
          >
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>
                  <Kbd>{k}</Kbd>
                </dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      ) : null}
    </div>
  );
}
