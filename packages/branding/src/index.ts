/**
 * Centralised product branding & identity.
 *
 * This is the SINGLE source of truth for the product name, copy, identifiers,
 * URLs and protocol scheme. Nothing else in the codebase should hard-code the
 * product name. Renaming the product = editing this file (plus regenerating the
 * Tauri config from it via `scripts/sync-branding`).
 *
 * The current name "Orbit" is a TEMPORARY placeholder.
 */

export interface Branding {
  /** Human-facing product name. */
  readonly name: string;
  /** Lowercase, filesystem/identifier-safe slug. */
  readonly slug: string;
  /** Short marketing tagline. */
  readonly tagline: string;
  /** Reverse-DNS bundle identifier base. */
  readonly bundleId: string;
  /** Custom URL protocol scheme (without `://`). */
  readonly protocol: string;
  /** Public URLs. */
  readonly urls: {
    readonly website: string;
    readonly docs: string;
    readonly store: string;
    readonly support: string;
    readonly privacy: string;
  };
  /** Vendor / publisher displayed in installers and certificates. */
  readonly publisher: string;
  /** Copyright line. */
  readonly copyright: string;
  /** Name of the on-disk application data directory. */
  readonly dataDirName: string;
}

export const BRANDING: Branding = {
  name: 'Orbit',
  slug: 'orbit',
  tagline: 'Everything on your computer, one shortcut away.',
  bundleId: 'dev.orbitlauncher.app',
  protocol: 'orbit',
  urls: {
    website: 'https://orbitlauncher.dev',
    docs: 'https://orbitlauncher.dev/docs',
    store: 'https://orbitlauncher.dev/store',
    support: 'https://orbitlauncher.dev/support',
    privacy: 'https://orbitlauncher.dev/privacy',
  },
  publisher: 'Orbit Labs',
  copyright: `© ${new Date().getFullYear()} Orbit Labs`,
  dataDirName: 'Orbit',
};

/** Build a deeplink URL for this product, e.g. `orbit://command/foo`. */
export function deeplink(path: string): string {
  const trimmed = path.replace(/^\/+/, '');
  return `${BRANDING.protocol}://${trimmed}`;
}
