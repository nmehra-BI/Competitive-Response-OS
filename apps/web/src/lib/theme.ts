/**
 * Theme preference. Light is the designed default; dark tokens are wired in tokens.css and follow
 * `prefers-color-scheme` unless `data-theme` is set on <html>. Stored per browser only.
 */
export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'growth-os:theme';

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}
