/**
 * Pure route-selection for the single-bundle desktop renderer.
 *
 * The launcher and the standalone Settings window load the *same* `index.html`
 * bundle (one Vite entry, one JS bundle). This module decides which root
 * component to mount. It is intentionally pure (no `window`/Tauri access) so the
 * decision is unit-tested in a plain Node environment.
 *
 * Selection precedence (most → least robust):
 *   1. The Tauri window label (`settings` → Settings). This is independent of the
 *      URL, so it survives any asset-path/encoding quirk in the shell.
 *   2. The `?view=settings` query parameter — how the Settings window is opened
 *      (`WebviewUrl::App("index.html?view=settings")`). A query string is never
 *      mistaken for an asset path the way a `#/settings` fragment could be.
 *   3. A legacy `#/settings` hash fragment, kept so older shells/builds that
 *      still navigate to `index.html#/settings` keep rendering Settings.
 *
 * Anything else renders the launcher.
 */
export type RootView = 'settings' | 'launcher';

export interface RouteInputs {
  /** The current Tauri window label, if inside Tauri (e.g. "settings"). */
  readonly label?: string | null;
  /** `window.location.search`, e.g. "?view=settings". */
  readonly search?: string | null;
  /** `window.location.hash`, e.g. "#/settings" (legacy). */
  readonly hash?: string | null;
}

/** The window label used for the standalone Settings window (mirrors Rust). */
export const SETTINGS_LABEL = 'settings';

/** Decide which root component the bundle should mount. */
export function selectView({ label, search, hash }: RouteInputs): RootView {
  // 1. Window label — the most robust signal, independent of the URL.
  if (label === SETTINGS_LABEL) return 'settings';

  // 2. Query parameter — the canonical way the Settings window is opened.
  if (new URLSearchParams(search ?? '').get('view') === SETTINGS_LABEL) {
    return 'settings';
  }

  // 3. Legacy hash fragment (`#/settings`, `#settings`, `#/settings/...`).
  if (/^#\/?settings(\/|$)/.test(hash ?? '')) return 'settings';

  return 'launcher';
}
