/**
 * Currency conversion against a cached rate table. Rates are injected (fetched
 * by the native layer and cached), never fetched here, so the calculator stays
 * synchronous and offline-capable. A staleness flag lets the UI warn the user.
 */

export interface RateTable {
  /** ISO 4217 base currency for the rates (e.g. 'USD'). */
  readonly base: string;
  /** Map of currency code → units per 1 base. */
  readonly rates: Readonly<Record<string, number>>;
  /** Epoch ms the rates were fetched. */
  readonly fetchedAt: number;
}

export interface CurrencyResult {
  readonly value: number;
  readonly from: string;
  readonly to: string;
  readonly stale: boolean;
}

const COMMON = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY', 'INR',
  'SEK', 'NOK', 'DKK', 'PLN', 'BRL', 'ZAR', 'SGD', 'HKD', 'MXN', 'KRW',
]);

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isCurrencyCode(code: string): boolean {
  return COMMON.has(code.toUpperCase());
}

export function convertCurrency(
  value: number,
  fromRaw: string,
  toRaw: string,
  table: RateTable,
  now: number = Date.now(),
): CurrencyResult | null {
  const from = fromRaw.toUpperCase();
  const to = toRaw.toUpperCase();
  if (!isCurrencyCode(from) || !isCurrencyCode(to)) return null;

  const rateFrom = from === table.base ? 1 : table.rates[from];
  const rateTo = to === table.base ? 1 : table.rates[to];
  if (rateFrom == null || rateTo == null) return null;

  // value in base = value / rateFrom; then × rateTo.
  const inBase = value / rateFrom;
  const result = inBase * rateTo;
  return {
    value: result,
    from,
    to,
    stale: now - table.fetchedAt > STALE_AFTER_MS,
  };
}

/** A small offline fallback table (illustrative; flagged stale in the UI). */
export const FALLBACK_RATES: RateTable = {
  base: 'USD',
  rates: {
    USD: 1, EUR: 0.92, GBP: 0.79, JPY: 157.0, CHF: 0.89, CAD: 1.37,
    AUD: 1.51, NZD: 1.64, CNY: 7.24, INR: 83.4, SEK: 10.6, NOK: 10.8,
    DKK: 6.87, PLN: 3.95, BRL: 5.43, ZAR: 18.3, SGD: 1.34, HKD: 7.81,
    MXN: 17.1, KRW: 1370.0,
  },
  fetchedAt: 0, // epoch → always stale until the native layer refreshes it
};
