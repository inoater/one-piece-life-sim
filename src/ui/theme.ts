import type { Theme } from './store';

const KEY = 'opsim.theme';

/** Storage can be unavailable (private modes, sandboxed frames); a preference is never worth an error. */
export function loadTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  } catch {
    /* fall through to the default */
  }
  return 'auto';
}

export function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* not persisted; still applied for this visit */
  }
}

/** "auto" follows the system setting (no attribute); light and dark are explicit overrides. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
