import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PASSWORD_OPTIONS,
  colorConversions,
  formatJson,
  generatePassword,
  minifyJson,
  parseColor,
  rgbToHex,
  rgbToHsl,
} from './index.js';

describe('colour conversion', () => {
  it('parses #rgb, #rrggbb and rgb()', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor('rgb(0, 128, 255)')).toEqual({ r: 0, g: 128, b: 255 });
    expect(parseColor('not a colour')).toBeNull();
    expect(parseColor('rgb(300,0,0)')).toBeNull();
  });

  it('round-trips rgb<->hex', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 128 })).toBe('#ff0080');
  });

  it('converts to hsl', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
    expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('produces a full conversion set', () => {
    expect(colorConversions('#ff0000')).toEqual({
      hex: '#ff0000',
      rgb: 'rgb(255, 0, 0)',
      hsl: 'hsl(0, 100%, 50%)',
    });
    expect(colorConversions('nope')).toBeNull();
  });
});

describe('json tools', () => {
  it('formats valid JSON', () => {
    const r = formatJson('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('{\n  "a": 1\n}');
  });
  it('reports invalid JSON', () => {
    expect(formatJson('{bad}').ok).toBe(false);
  });
  it('minifies', () => {
    const r = minifyJson('{ "a": 1, "b": 2 }');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('{"a":1,"b":2}');
  });
});

describe('password generation', () => {
  // Deterministic RNG cycling through fixed values.
  const seq = (values: number[]): (() => number) => {
    let i = 0;
    return () => values[i++ % values.length]!;
  };

  it('respects the requested length', () => {
    const pw = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 24 }, seq([0.1, 0.5, 0.9]));
    expect(pw).toHaveLength(24);
  });

  it('includes at least one of each selected class', () => {
    const pw = generatePassword(
      { length: 12, lower: true, upper: true, digits: true, symbols: true },
      Math.random,
    );
    expect(/[a-z]/.test(pw)).toBe(true);
    expect(/[A-Z]/.test(pw)).toBe(true);
    expect(/[0-9]/.test(pw)).toBe(true);
  });

  it('never shorter than the number of selected classes', () => {
    const pw = generatePassword(
      { length: 1, lower: true, upper: true, digits: true, symbols: true },
      seq([0]),
    );
    expect(pw.length).toBeGreaterThanOrEqual(4);
  });

  it('falls back to lowercase when nothing is selected', () => {
    const pw = generatePassword(
      { length: 8, lower: false, upper: false, digits: false, symbols: false },
      seq([0.3]),
    );
    expect(/^[a-z]+$/.test(pw)).toBe(true);
  });
});
