/**
 * Typed access to extension preferences.
 *
 * The host resolves preference values (from defaults + user overrides defined
 * in the manifest) and passes them in `ctx.preferences`. This helper provides
 * coercing accessors so handlers don't have to hand-validate `unknown`.
 */
export interface Preferences {
  /** Raw value for `name`, or `undefined` if absent. */
  get<T = unknown>(name: string): T | undefined;
  /** String preference, or `fallback` if unset/empty. */
  getString(name: string, fallback?: string): string;
  /** Boolean preference; accepts real booleans and the strings "true"/"false". */
  getBoolean(name: string, fallback?: boolean): boolean;
  /** Numeric preference; coerces numeric strings, else `fallback`. */
  getNumber(name: string, fallback?: number): number;
  /** The raw, read-only preferences record. */
  all(): Readonly<Record<string, unknown>>;
}

class PreferenceReader implements Preferences {
  readonly #values: Readonly<Record<string, unknown>>;

  constructor(values: Readonly<Record<string, unknown>>) {
    this.#values = values;
  }

  get<T = unknown>(name: string): T | undefined {
    if (!Object.prototype.hasOwnProperty.call(this.#values, name)) return undefined;
    return this.#values[name] as T | undefined;
  }

  getString(name: string, fallback = ""): string {
    const value = this.get(name);
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
  }

  getBoolean(name: string, fallback = false): boolean {
    const value = this.get(name);
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }

  getNumber(name: string, fallback = 0): number {
    const value = this.get(name);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

  all(): Readonly<Record<string, unknown>> {
    return this.#values;
  }
}

/** Wraps the host-provided preferences record in a typed reader. */
export function createPreferences(values: Readonly<Record<string, unknown>>): Preferences {
  return new PreferenceReader(values);
}
