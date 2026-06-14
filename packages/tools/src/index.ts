/**
 * Pure helpers for Orbit's small built-in tools (colour conversion, JSON
 * formatting, password generation). GUI-free and deterministic (randomness is
 * injected), so each is unit-tested. The renderer wires these into a
 * SearchProvider; secure randomness is supplied there.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** Parse `#rgb`, `#rrggbb`, or `rgb(r,g,b)` into an Rgb, or null. */
export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    if ([r, g, b].every((n) => n >= 0 && n <= 255)) return { r, g, b };
  }
  return null;
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Convert RGB (0–255) to HSL with H in degrees, S/L in percent. */
export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export interface ColorConversions {
  readonly hex: string;
  readonly rgb: string;
  readonly hsl: string;
}

/** Full set of conversions for a colour input, or null if unparseable. */
export function colorConversions(input: string): ColorConversions | null {
  const rgb = parseColor(input);
  if (!rgb) return null;
  const { h, s, l } = rgbToHsl(rgb);
  return {
    hex: rgbToHex(rgb),
    rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    hsl: `hsl(${h}, ${s}%, ${l}%)`,
  };
}

export type JsonResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

/** Pretty-print JSON, or report a parse error. */
export function formatJson(input: string, indent = 2): JsonResult {
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(input), null, indent) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'invalid JSON' };
  }
}

/** Minify JSON, or report a parse error. */
export function minifyJson(input: string): JsonResult {
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(input)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'invalid JSON' };
  }
}

export interface PasswordOptions {
  readonly length: number;
  readonly lower: boolean;
  readonly upper: boolean;
  readonly digits: boolean;
  readonly symbols: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
};

const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
} as const;

/**
 * Generate a password. `rng` returns a float in [0, 1); the caller injects a
 * cryptographically secure one in production (the logic here is deterministic and
 * testable). Guarantees at least one character from each selected class.
 */
export function generatePassword(options: PasswordOptions, rng: () => number): string {
  const pools: string[] = [];
  if (options.lower) pools.push(CHARSETS.lower);
  if (options.upper) pools.push(CHARSETS.upper);
  if (options.digits) pools.push(CHARSETS.digits);
  if (options.symbols) pools.push(CHARSETS.symbols);
  if (pools.length === 0) pools.push(CHARSETS.lower);

  const length = Math.max(pools.length, Math.min(256, Math.floor(options.length)));
  const all = pools.join('');
  const pick = (set: string): string => set[Math.floor(rng() * set.length)] ?? set[0]!;

  const chars: string[] = pools.map((p) => pick(p)); // one from each class
  while (chars.length < length) chars.push(pick(all));

  // Fisher–Yates shuffle so the guaranteed characters aren't all up front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
