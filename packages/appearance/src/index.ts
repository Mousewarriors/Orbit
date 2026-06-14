/**
 * Pure appearance model shared by the launcher and the Settings window.
 *
 * This package is GUI-free and unit-tested: it owns the *meaning* of the
 * appearance preferences (theme resolution, opacity clamping, serialisation to
 * and from the settings store). The renderer applies the resolved values to the
 * DOM; the native side just persists the raw strings.
 */

export type ThemeChoice = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

export interface Appearance {
  readonly theme: ThemeChoice;
  /** Use solid surfaces (no transparency/blur) for maximum contrast. */
  readonly reducedTransparency: boolean;
  /** Disable animations and transitions. */
  readonly reducedMotion: boolean;
  /** Launcher surface opacity as a percentage, 40–100. */
  readonly opacity: number;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'system',
  reducedTransparency: false,
  reducedMotion: false,
  opacity: 92,
};

/** Settings-store keys for each appearance field (the single source of truth). */
export const APPEARANCE_KEYS = {
  theme: 'appearance.theme',
  reducedTransparency: 'appearance.reduced_transparency',
  reducedMotion: 'appearance.reduced_motion',
  opacity: 'appearance.opacity',
} as const;

const MIN_OPACITY = 40;
const MAX_OPACITY = 100;

/** Clamp/round an opacity percentage into the supported range. */
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_APPEARANCE.opacity;
  return Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, Math.round(value)));
}

/** Resolve a theme *choice* into a concrete theme using the OS preference. */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === 'system' || value === 'dark' || value === 'light';
}

/** A raw string map (e.g. straight from the settings store), values nullable. */
export type RawSettings = Readonly<Record<string, string | null | undefined>>;

/** Parse stored settings into a validated Appearance, falling back to defaults. */
export function appearanceFromSettings(raw: RawSettings): Appearance {
  const themeRaw = raw[APPEARANCE_KEYS.theme] ?? null;
  const opacityRaw = raw[APPEARANCE_KEYS.opacity];
  const opacity =
    opacityRaw == null || opacityRaw === ''
      ? DEFAULT_APPEARANCE.opacity
      : clampOpacity(Number(opacityRaw));
  return {
    theme: isThemeChoice(themeRaw) ? themeRaw : DEFAULT_APPEARANCE.theme,
    reducedTransparency: raw[APPEARANCE_KEYS.reducedTransparency] === 'true',
    reducedMotion: raw[APPEARANCE_KEYS.reducedMotion] === 'true',
    opacity,
  };
}

/** Serialise an Appearance into the string map persisted to the settings store. */
export function appearanceToSettings(a: Appearance): Record<string, string> {
  return {
    [APPEARANCE_KEYS.theme]: a.theme,
    [APPEARANCE_KEYS.reducedTransparency]: String(a.reducedTransparency),
    [APPEARANCE_KEYS.reducedMotion]: String(a.reducedMotion),
    [APPEARANCE_KEYS.opacity]: String(clampOpacity(a.opacity)),
  };
}

/** The concrete DOM-facing values to apply for a given appearance + OS theme. */
export interface AppliedAppearance {
  readonly theme: ResolvedTheme;
  readonly reducedTransparency: boolean;
  readonly reducedMotion: boolean;
  /** Surface alpha as a 0–1 fraction for the `--surface-alpha` CSS variable. */
  readonly surfaceAlpha: number;
}

/** Compute the DOM-facing values for an appearance under the current OS theme. */
export function computeApplied(a: Appearance, systemPrefersDark: boolean): AppliedAppearance {
  return {
    theme: resolveTheme(a.theme, systemPrefersDark),
    reducedTransparency: a.reducedTransparency,
    reducedMotion: a.reducedMotion,
    // Reduced transparency forces fully opaque surfaces regardless of the slider.
    surfaceAlpha: a.reducedTransparency ? 1 : clampOpacity(a.opacity) / 100,
  };
}
