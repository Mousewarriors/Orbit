/**
 * Renderer-side glue between the pure {@link @orbit/appearance} model, the native
 * settings store, and the DOM. Both the launcher and the Settings window use
 * this: the launcher to apply the saved appearance (on mount and whenever it is
 * re-shown), Settings to read, mutate and persist it.
 */
import {
  APPEARANCE_KEYS,
  DEFAULT_APPEARANCE,
  appearanceFromSettings,
  appearanceToSettings,
  computeApplied,
  type Appearance,
} from '@orbit/appearance';
import * as native from './native.js';

export type { Appearance } from '@orbit/appearance';
export { DEFAULT_APPEARANCE } from '@orbit/appearance';

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Apply an appearance to the document root (theme, transparency, motion, alpha). */
export function applyAppearance(a: Appearance): void {
  if (typeof document === 'undefined') return;
  const applied = computeApplied(a, systemPrefersDark());
  const root = document.documentElement;
  root.setAttribute('data-theme', applied.theme);
  root.setAttribute('data-reduced-transparency', String(applied.reducedTransparency));
  root.setAttribute('data-reduced-motion', String(applied.reducedMotion));
  root.style.setProperty('--surface-alpha', applied.surfaceAlpha.toFixed(3));
}

/** Load the saved appearance from the settings store (defaults outside Tauri). */
export async function loadAppearance(): Promise<Appearance> {
  if (!native.isTauri()) return DEFAULT_APPEARANCE;
  const keys = Object.values(APPEARANCE_KEYS);
  const entries = await Promise.all(
    keys.map(async (k) => [k, await native.getSetting(k).catch(() => null)] as const),
  );
  return appearanceFromSettings(Object.fromEntries(entries));
}

/** Persist an appearance and apply it immediately. */
export async function saveAppearance(a: Appearance): Promise<void> {
  applyAppearance(a);
  if (!native.isTauri()) return;
  const map = appearanceToSettings(a);
  await Promise.all(Object.entries(map).map(([k, v]) => native.setSetting(k, v)));
}

/** Load and apply the saved appearance in one call (used at startup / on show). */
export async function initAppearance(): Promise<Appearance> {
  const a = await loadAppearance();
  applyAppearance(a);
  return a;
}
