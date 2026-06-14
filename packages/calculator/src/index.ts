/**
 * @orbit/calculator — natural-language calculator for Root Search.
 *
 * `calculate()` inspects the input and dispatches to the right engine:
 *   - base conversion   "hex ff in decimal", "255 in binary"
 *   - percentage        "20% of 740", "740 + 10%"
 *   - currency          "15 GBP in EUR"        (needs a RateTable)
 *   - unit conversion   "5 ft in cm", "15 km in miles"
 *   - arithmetic        "125 * 8", "sqrt(2)^2"
 *
 * It returns null when the input is not confidently a calculation, so Root
 * Search can fall through to other providers without showing a bogus result.
 */

import { CalcError, evaluate } from './parser.js';
import { convert, resolveUnit } from './units.js';
import { convertCurrency, isCurrencyCode, type RateTable } from './currency.js';

export type CalcKind = 'arithmetic' | 'unit' | 'currency' | 'percentage' | 'base';

export interface CalcResult {
  readonly kind: CalcKind;
  /** Numeric result where applicable (string for base conversions). */
  readonly value: number | string;
  /** Formatted, copyable result, e.g. "9.32 mi" or "£11.85". */
  readonly formatted: string;
  /** Normalised echo of the interpreted expression. */
  readonly expression: string;
  /** Set when currency rates are older than the freshness window. */
  readonly stale?: boolean;
}

export interface CalcOptions {
  readonly rates?: RateTable;
  readonly now?: number;
  /** Locale for number formatting. */
  readonly locale?: string;
}

function formatNumber(n: number, locale = 'en-US'): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString(locale);
  const rounded = Number(n.toPrecision(10));
  return rounded.toLocaleString(locale, { maximumFractionDigits: 6 });
}

const BASES: Readonly<Record<string, number>> = {
  hex: 16, hexadecimal: 16, dec: 10, decimal: 10, bin: 2, binary: 2, oct: 8, octal: 8,
};

function parseBaseNumber(token: string): { value: number; base: number } | null {
  const t = token.trim().toLowerCase();
  if (t.startsWith('0x')) return { value: parseInt(t.slice(2), 16), base: 16 };
  if (t.startsWith('0b')) return { value: parseInt(t.slice(2), 2), base: 2 };
  if (t.startsWith('0o')) return { value: parseInt(t.slice(2), 8), base: 8 };
  return null;
}

function tryBaseConversion(input: string): CalcResult | null {
  // forms: "hex ff in decimal", "0xff to binary", "255 in hex"
  const m = input
    .trim()
    .toLowerCase()
    .match(/^(?:(hex|dec|bin|oct|hexadecimal|decimal|binary|octal)\s+)?([0-9a-fx]+)\s+(?:in|to|as)\s+(hex|dec|bin|oct|hexadecimal|decimal|binary|octal)$/);
  if (!m) return null;
  const [, fromKw, numRaw, toKw] = m;
  const toBase = BASES[toKw!]!;

  let value: number;
  const prefixed = parseBaseNumber(numRaw!);
  if (prefixed) {
    value = prefixed.value;
  } else if (fromKw) {
    value = parseInt(numRaw!, BASES[fromKw]!);
  } else {
    // No explicit source base → assume decimal.
    value = parseInt(numRaw!, 10);
  }
  if (!Number.isFinite(value)) return null;

  const out = value.toString(toBase);
  const display = toBase === 16 ? `0x${out}` : toBase === 2 ? `0b${out}` : toBase === 8 ? `0o${out}` : out;
  return {
    kind: 'base',
    value: display,
    formatted: display,
    expression: `${numRaw} → base ${toBase}`,
  };
}

function tryPercentage(input: string): CalcResult | null {
  const s = input.trim().toLowerCase();
  // "20% of 740"
  let m = s.match(/^([\d.,]+)\s*%\s*of\s*([\d.,]+)$/);
  if (m) {
    const pct = Number(m[1]!.replace(/,/g, ''));
    const base = Number(m[2]!.replace(/,/g, ''));
    const value = (pct / 100) * base;
    return {
      kind: 'percentage',
      value,
      formatted: formatNumber(value),
      expression: `${pct}% of ${base}`,
    };
  }
  // "740 + 10%" / "740 - 10%"  → base ± (pct% of base)
  m = s.match(/^([\d.,]+)\s*([+-])\s*([\d.,]+)\s*%$/);
  if (m) {
    const base = Number(m[1]!.replace(/,/g, ''));
    const sign = m[2] === '-' ? -1 : 1;
    const pct = Number(m[3]!.replace(/,/g, ''));
    const value = base + sign * (pct / 100) * base;
    return {
      kind: 'percentage',
      value,
      formatted: formatNumber(value),
      expression: `${base} ${m[2]} ${pct}%`,
    };
  }
  return null;
}

function tryConversion(input: string, opts: CalcOptions): CalcResult | null {
  // "<number> <unit> in|to|as <unit>"
  const m = input
    .trim()
    .match(/^([+-]?[\d.,]+(?:e[+-]?\d+)?)\s*([a-zA-Z°"'/]+)\s+(?:in|to|as)\s+([a-zA-Z°"'/]+)$/i);
  if (!m) return null;
  const value = Number(m[1]!.replace(/,/g, ''));
  const fromRaw = m[2]!;
  const toRaw = m[3]!;
  if (!Number.isFinite(value)) return null;

  // currency first
  if (isCurrencyCode(fromRaw) && isCurrencyCode(toRaw)) {
    const table = opts.rates;
    if (!table) return null;
    const cur = convertCurrency(value, fromRaw, toRaw, table, opts.now);
    if (!cur) return null;
    return {
      kind: 'currency',
      value: cur.value,
      formatted: `${formatNumber(cur.value, opts.locale)} ${cur.to}`,
      expression: `${formatNumber(value, opts.locale)} ${cur.from} → ${cur.to}`,
      stale: cur.stale,
    };
  }

  if (resolveUnit(fromRaw) && resolveUnit(toRaw)) {
    const conv = convert(value, fromRaw, toRaw);
    if (!conv) return null;
    return {
      kind: 'unit',
      value: conv.value,
      formatted: `${formatNumber(conv.value, opts.locale)} ${conv.toDisplay}`,
      expression: `${formatNumber(value, opts.locale)} ${conv.fromDisplay} → ${conv.toDisplay}`,
    };
  }
  return null;
}

/** Heuristic: does the input look like it's meant to be a calculation? */
function looksNumeric(input: string): boolean {
  return /\d/.test(input) && /[\d.\s+\-*/^%()a-z°"']/i.test(input);
}

export function calculate(input: string, opts: CalcOptions = {}): CalcResult | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const base = tryBaseConversion(trimmed);
  if (base) return base;

  const pct = tryPercentage(trimmed);
  if (pct) return pct;

  const conv = tryConversion(trimmed, opts);
  if (conv) return conv;

  if (!looksNumeric(trimmed)) return null;
  try {
    const value = evaluate(trimmed);
    return {
      kind: 'arithmetic',
      value,
      formatted: formatNumber(value, opts.locale),
      expression: trimmed.replace(/\s+/g, ' '),
    };
  } catch (err) {
    if (err instanceof CalcError) return null;
    return null;
  }
}

export { evaluate, CalcError } from './parser.js';
export { convert, resolveUnit } from './units.js';
export {
  convertCurrency,
  isCurrencyCode,
  FALLBACK_RATES,
  type RateTable,
} from './currency.js';
