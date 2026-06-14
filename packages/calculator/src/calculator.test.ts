import { describe, expect, it } from 'vitest';
import { calculate } from './index.js';
import { evaluate, CalcError } from './parser.js';
import { convert } from './units.js';
import { convertCurrency, FALLBACK_RATES } from './currency.js';

describe('arithmetic evaluate', () => {
  it('handles basic operators with precedence', () => {
    expect(evaluate('125 * 8')).toBe(1000);
    expect(evaluate('2 + 3 * 4')).toBe(14);
    expect(evaluate('(2 + 3) * 4')).toBe(20);
    expect(evaluate('2 ^ 10')).toBe(1024);
  });

  it('is right-associative for exponent', () => {
    expect(evaluate('2 ^ 2 ^ 3')).toBe(256); // 2^(2^3)
  });

  it('supports unary minus and scientific notation', () => {
    expect(evaluate('-5 + 3')).toBe(-2);
    expect(evaluate('1.5e3')).toBe(1500);
  });

  it('supports functions and constants', () => {
    expect(evaluate('sqrt(144)')).toBe(12);
    expect(Number(evaluate('sqrt(2)^2').toFixed(10))).toBe(2);
    expect(Number(evaluate('cos(0)'))).toBe(1);
    expect(Math.abs(evaluate('pi') - Math.PI)).toBeLessThan(1e-12);
    expect(evaluate('max(3, 7, 5)')).toBe(7);
  });

  it('handles thousands separators', () => {
    expect(evaluate('1,000 + 2,000')).toBe(3000);
    expect(evaluate('1_000 * 2')).toBe(2000);
  });

  it('rejects division by zero', () => {
    expect(() => evaluate('1/0')).toThrow(CalcError);
  });

  it('rejects malformed / injection-like input safely', () => {
    expect(() => evaluate('process.exit(1)')).toThrow(CalcError);
    expect(() => evaluate('2 +')).toThrow(CalcError);
    expect(() => evaluate('alert("x")')).toThrow(CalcError);
    expect(() => evaluate('1; 2')).toThrow();
  });
});

describe('calculate dispatch', () => {
  it('returns arithmetic results', () => {
    const r = calculate('125 * 8');
    expect(r?.kind).toBe('arithmetic');
    expect(r?.value).toBe(1000);
    expect(r?.formatted).toBe('1,000');
  });

  it('handles "% of"', () => {
    const r = calculate('20% of 740');
    expect(r?.kind).toBe('percentage');
    expect(r?.value).toBe(148);
  });

  it('handles "base + percent"', () => {
    const r = calculate('740 + 10%');
    expect(r?.kind).toBe('percentage');
    expect(r?.value).toBeCloseTo(814, 6);
  });

  it('converts units', () => {
    const r = calculate('15 km in miles');
    expect(r?.kind).toBe('unit');
    expect(typeof r?.value).toBe('number');
    expect(r?.value as number).toBeCloseTo(9.3206, 3);
  });

  it('converts feet to cm', () => {
    const r = calculate('5 ft in cm');
    expect(r?.value as number).toBeCloseTo(152.4, 3);
  });

  it('converts base numbers', () => {
    expect(calculate('hex ff in decimal')?.value).toBe('255');
    expect(calculate('255 in hex')?.value).toBe('0xff');
    expect(calculate('0xff to binary')?.value).toBe('0b11111111');
  });

  it('returns null for non-calculations', () => {
    expect(calculate('open downloads')).toBeNull();
    expect(calculate('chrome')).toBeNull();
    expect(calculate('')).toBeNull();
  });

  it('does currency only when given rates, flagged stale appropriately', () => {
    expect(calculate('15 GBP in EUR')).toBeNull(); // no rates → null
    // Fallback table is fetchedAt epoch 0; "now" well past the 24h window.
    const r = calculate('15 GBP in EUR', { rates: FALLBACK_RATES, now: 2 * 24 * 3600 * 1000 });
    expect(r?.kind).toBe('currency');
    expect(r?.stale).toBe(true);
  });
});

describe('unit conversion edge cases', () => {
  it('converts temperature with offsets', () => {
    expect(convert(0, 'c', 'f')?.value).toBeCloseTo(32, 6);
    expect(convert(100, 'c', 'f')?.value).toBeCloseTo(212, 6);
    expect(convert(32, 'f', 'c')?.value).toBeCloseTo(0, 6);
    expect(convert(0, 'c', 'k')?.value).toBeCloseTo(273.15, 6);
  });

  it('refuses cross-dimension conversions', () => {
    expect(convert(1, 'km', 'kg')).toBeNull();
  });

  it('handles binary vs decimal data sizes', () => {
    expect(convert(1, 'gib', 'mib')?.value).toBeCloseTo(1024, 6);
    expect(convert(1, 'gb', 'mb')?.value).toBeCloseTo(1000, 6);
  });
});

describe('currency math', () => {
  it('cross-converts via the base currency', () => {
    const r = convertCurrency(100, 'GBP', 'EUR', FALLBACK_RATES, 1000);
    // 100 GBP / 0.79 = 126.58 USD * 0.92 = 116.46 EUR
    expect(r?.value).toBeCloseTo((100 / 0.79) * 0.92, 6);
  });
  it('rejects unknown currencies', () => {
    expect(convertCurrency(1, 'XXX', 'EUR', FALLBACK_RATES)).toBeNull();
  });
});
