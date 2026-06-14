/**
 * Unit conversion tables. Each dimension has a base unit; every unit declares a
 * factor to the base (and optionally an offset, for temperature). Aliases map
 * many spellings/abbreviations to a canonical unit key.
 */

export type Dimension = 'length' | 'mass' | 'temperature' | 'data' | 'time' | 'speed' | 'area' | 'volume';

interface UnitDef {
  readonly dimension: Dimension;
  /** Multiply a value in this unit by `factor` (then add `offset`) to get base. */
  readonly factor: number;
  readonly offset?: number;
  readonly display: string;
}

// Base units: length=metre, mass=gram, temperature=kelvin, data=byte,
// time=second, speed=metre/second, area=m², volume=litre.
const UNITS: Readonly<Record<string, UnitDef>> = {
  // length (base: metre)
  mm: { dimension: 'length', factor: 0.001, display: 'mm' },
  cm: { dimension: 'length', factor: 0.01, display: 'cm' },
  m: { dimension: 'length', factor: 1, display: 'm' },
  km: { dimension: 'length', factor: 1000, display: 'km' },
  in: { dimension: 'length', factor: 0.0254, display: 'in' },
  ft: { dimension: 'length', factor: 0.3048, display: 'ft' },
  yd: { dimension: 'length', factor: 0.9144, display: 'yd' },
  mi: { dimension: 'length', factor: 1609.344, display: 'mi' },
  // mass (base: gram)
  mg: { dimension: 'mass', factor: 0.001, display: 'mg' },
  g: { dimension: 'mass', factor: 1, display: 'g' },
  kg: { dimension: 'mass', factor: 1000, display: 'kg' },
  t: { dimension: 'mass', factor: 1_000_000, display: 't' },
  oz: { dimension: 'mass', factor: 28.349523125, display: 'oz' },
  lb: { dimension: 'mass', factor: 453.59237, display: 'lb' },
  st: { dimension: 'mass', factor: 6350.29318, display: 'st' },
  // temperature (base: kelvin) — uses offset
  k: { dimension: 'temperature', factor: 1, offset: 0, display: 'K' },
  c: { dimension: 'temperature', factor: 1, offset: 273.15, display: '°C' },
  f: { dimension: 'temperature', factor: 5 / 9, offset: 255.372222222, display: '°F' },
  // data (base: byte) — decimal & binary
  b: { dimension: 'data', factor: 1, display: 'B' },
  kb: { dimension: 'data', factor: 1e3, display: 'KB' },
  mb: { dimension: 'data', factor: 1e6, display: 'MB' },
  gb: { dimension: 'data', factor: 1e9, display: 'GB' },
  tb: { dimension: 'data', factor: 1e12, display: 'TB' },
  kib: { dimension: 'data', factor: 1024, display: 'KiB' },
  mib: { dimension: 'data', factor: 1024 ** 2, display: 'MiB' },
  gib: { dimension: 'data', factor: 1024 ** 3, display: 'GiB' },
  tib: { dimension: 'data', factor: 1024 ** 4, display: 'TiB' },
  // time (base: second)
  ms: { dimension: 'time', factor: 0.001, display: 'ms' },
  s: { dimension: 'time', factor: 1, display: 's' },
  min: { dimension: 'time', factor: 60, display: 'min' },
  h: { dimension: 'time', factor: 3600, display: 'h' },
  day: { dimension: 'time', factor: 86400, display: 'day' },
  week: { dimension: 'time', factor: 604800, display: 'week' },
  // speed (base: m/s)
  mps: { dimension: 'speed', factor: 1, display: 'm/s' },
  kmh: { dimension: 'speed', factor: 1000 / 3600, display: 'km/h' },
  mph: { dimension: 'speed', factor: 1609.344 / 3600, display: 'mph' },
  // area (base: m²)
  sqm: { dimension: 'area', factor: 1, display: 'm²' },
  sqkm: { dimension: 'area', factor: 1e6, display: 'km²' },
  sqft: { dimension: 'area', factor: 0.09290304, display: 'ft²' },
  acre: { dimension: 'area', factor: 4046.8564224, display: 'acre' },
  hectare: { dimension: 'area', factor: 10000, display: 'ha' },
  // volume (base: litre)
  ml: { dimension: 'volume', factor: 0.001, display: 'ml' },
  l: { dimension: 'volume', factor: 1, display: 'l' },
  gal: { dimension: 'volume', factor: 3.785411784, display: 'gal' },
  pt: { dimension: 'volume', factor: 0.473176473, display: 'pt' },
  cup: { dimension: 'volume', factor: 0.2365882365, display: 'cup' },
};

const ALIASES: Readonly<Record<string, string>> = {
  millimetre: 'mm', millimeter: 'mm', millimetres: 'mm', millimeters: 'mm',
  centimetre: 'cm', centimeter: 'cm', centimetres: 'cm', centimeters: 'cm', cms: 'cm',
  metre: 'm', meter: 'm', metres: 'm', meters: 'm',
  kilometre: 'km', kilometer: 'km', kilometres: 'km', kilometers: 'km', kms: 'km',
  inch: 'in', inches: 'in', '"': 'in',
  foot: 'ft', feet: 'ft', "'": 'ft',
  yard: 'yd', yards: 'yd',
  mile: 'mi', miles: 'mi',
  milligram: 'mg', milligrams: 'mg',
  gram: 'g', grams: 'g', gramme: 'g',
  kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  tonne: 't', tonnes: 't', ton: 't',
  ounce: 'oz', ounces: 'oz',
  pound: 'lb', pounds: 'lb', lbs: 'lb',
  stone: 'st', stones: 'st',
  celsius: 'c', centigrade: 'c', '°c': 'c',
  fahrenheit: 'f', '°f': 'f',
  kelvin: 'k',
  byte: 'b', bytes: 'b',
  kilobyte: 'kb', kilobytes: 'kb',
  megabyte: 'mb', megabytes: 'mb',
  gigabyte: 'gb', gigabytes: 'gb',
  terabyte: 'tb', terabytes: 'tb',
  millisecond: 'ms', milliseconds: 'ms', msec: 'ms',
  second: 's', seconds: 's', sec: 's', secs: 's',
  minute: 'min', minutes: 'min', mins: 'min',
  hour: 'h', hours: 'h', hr: 'h', hrs: 'h',
  days: 'day', d: 'day',
  weeks: 'week', wk: 'week',
  'm/s': 'mps',
  'km/h': 'kmh', kph: 'kmh',
  'mi/h': 'mph',
  litre: 'l', liter: 'l', litres: 'l', liters: 'l',
  millilitre: 'ml', milliliter: 'ml',
  gallon: 'gal', gallons: 'gal',
  pint: 'pt', pints: 'pt',
  cups: 'cup',
};

export function resolveUnit(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (key in UNITS) return key;
  if (key in ALIASES) return ALIASES[key]!;
  return null;
}

export interface ConversionResult {
  readonly value: number;
  readonly fromDisplay: string;
  readonly toDisplay: string;
  readonly dimension: Dimension;
}

/** Convert `value` from one unit to another. Returns null if incompatible. */
export function convert(value: number, fromRaw: string, toRaw: string): ConversionResult | null {
  const fromKey = resolveUnit(fromRaw);
  const toKey = resolveUnit(toRaw);
  if (!fromKey || !toKey) return null;
  const from = UNITS[fromKey]!;
  const to = UNITS[toKey]!;
  if (from.dimension !== to.dimension) return null;

  let result: number;
  if (from.dimension === 'temperature') {
    // value→kelvin: F uses K = (F-32)*5/9 + 273.15 ; we model via factor+offset
    const kelvin =
      fromKey === 'f' ? ((value - 32) * 5) / 9 + 273.15 : value * from.factor + (from.offset ?? 0);
    result =
      toKey === 'f' ? ((kelvin - 273.15) * 9) / 5 + 32 : (kelvin - (to.offset ?? 0)) / to.factor;
  } else {
    const base = value * from.factor;
    result = base / to.factor;
  }
  return {
    value: result,
    fromDisplay: from.display,
    toDisplay: to.display,
    dimension: from.dimension,
  };
}

export const ALL_UNIT_KEYS = Object.freeze(Object.keys(UNITS));
