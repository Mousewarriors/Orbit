import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_KEYS,
  DEFAULT_APPEARANCE,
  appearanceFromSettings,
  appearanceToSettings,
  clampOpacity,
  computeApplied,
  resolveTheme,
} from './index.js';

describe('clampOpacity', () => {
  it('clamps below the minimum and above the maximum', () => {
    expect(clampOpacity(10)).toBe(40);
    expect(clampOpacity(250)).toBe(100);
  });
  it('rounds and passes through valid values', () => {
    expect(clampOpacity(87.4)).toBe(87);
  });
  it('falls back to the default for non-finite input', () => {
    expect(clampOpacity(Number.NaN)).toBe(DEFAULT_APPEARANCE.opacity);
  });
});

describe('resolveTheme', () => {
  it('maps system to the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('respects explicit choices', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });
});

describe('appearanceFromSettings', () => {
  it('returns defaults for an empty store', () => {
    expect(appearanceFromSettings({})).toEqual(DEFAULT_APPEARANCE);
  });
  it('parses stored values and clamps opacity', () => {
    const a = appearanceFromSettings({
      [APPEARANCE_KEYS.theme]: 'dark',
      [APPEARANCE_KEYS.reducedTransparency]: 'true',
      [APPEARANCE_KEYS.reducedMotion]: 'false',
      [APPEARANCE_KEYS.opacity]: '5',
    });
    expect(a).toEqual({
      theme: 'dark',
      reducedTransparency: true,
      reducedMotion: false,
      opacity: 40,
    });
  });
  it('ignores an invalid theme value', () => {
    expect(appearanceFromSettings({ [APPEARANCE_KEYS.theme]: 'neon' }).theme).toBe('system');
  });
});

describe('round-trip', () => {
  it('settings -> appearance -> settings is stable', () => {
    const a = appearanceFromSettings({
      [APPEARANCE_KEYS.theme]: 'light',
      [APPEARANCE_KEYS.opacity]: '73',
      [APPEARANCE_KEYS.reducedTransparency]: 'false',
      [APPEARANCE_KEYS.reducedMotion]: 'true',
    });
    const serialised = appearanceToSettings(a);
    expect(appearanceFromSettings(serialised)).toEqual(a);
  });
});

describe('computeApplied', () => {
  it('forces opaque surfaces under reduced transparency', () => {
    const applied = computeApplied(
      { theme: 'dark', reducedTransparency: true, reducedMotion: false, opacity: 60 },
      true,
    );
    expect(applied.surfaceAlpha).toBe(1);
  });
  it('derives surface alpha from the opacity slider otherwise', () => {
    const applied = computeApplied(
      { theme: 'system', reducedTransparency: false, reducedMotion: false, opacity: 80 },
      false,
    );
    expect(applied.theme).toBe('light');
    expect(applied.surfaceAlpha).toBeCloseTo(0.8);
  });
});
