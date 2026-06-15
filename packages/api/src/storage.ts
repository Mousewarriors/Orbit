import type { StorageWrite } from "./protocol.js";

/**
 * Namespaced local storage over the v1 protocol.
 *
 * Reads come from the immutable `ctx.storage` snapshot the host passed in;
 * writes are *buffered* and flushed by the runtime into the response's
 * `storageWrites` array. Because v1 is one-shot, writes are not visible to
 * subsequent `get` calls within the same handler unless you read them back
 * via {@link LocalStorage.getPending} — the snapshot does not mutate.
 */
export interface LocalStorage {
  /** Returns the typed value for `key`, or `undefined` if unset. */
  get<T = unknown>(key: string): T | undefined;
  /** Returns the value for `key`, or `fallback` if unset. */
  getOr<T>(key: string, fallback: T): T;
  /** Buffers a write of `value` to `key` (applied by the host post-handler). */
  set(key: string, value: unknown): void;
  /** Buffers a deletion of `key`. */
  remove(key: string): void;
  /** Returns the keys present in the original host snapshot. */
  keys(): readonly string[];
  /** Returns the value buffered for `key` this handler, if any. */
  getPending<T = unknown>(key: string): T | undefined;
  /** Returns the accumulated writes to flush into the response. Internal use. */
  collect(): readonly StorageWrite[];
}

class BufferedStorage implements LocalStorage {
  readonly #snapshot: Readonly<Record<string, unknown>>;
  readonly #writes = new Map<string, unknown>();

  constructor(snapshot: Readonly<Record<string, unknown>>) {
    this.#snapshot = snapshot;
  }

  get<T = unknown>(key: string): T | undefined {
    if (!Object.prototype.hasOwnProperty.call(this.#snapshot, key)) return undefined;
    return this.#snapshot[key] as T | undefined;
  }

  getOr<T>(key: string, fallback: T): T {
    const value = this.get<T>(key);
    return value === undefined ? fallback : value;
  }

  set(key: string, value: unknown): void {
    this.#writes.set(key, value);
  }

  remove(key: string): void {
    // `null` is the protocol's delete sentinel.
    this.#writes.set(key, null);
  }

  keys(): readonly string[] {
    return Object.keys(this.#snapshot);
  }

  getPending<T = unknown>(key: string): T | undefined {
    if (!this.#writes.has(key)) return undefined;
    return this.#writes.get(key) as T | undefined;
  }

  collect(): readonly StorageWrite[] {
    const out: StorageWrite[] = [];
    for (const [key, value] of this.#writes) {
      out.push({ key, value });
    }
    return out;
  }
}

/** Creates a buffered LocalStorage bound to the host's storage snapshot. */
export function createStorage(snapshot: Readonly<Record<string, unknown>>): LocalStorage {
  return new BufferedStorage(snapshot);
}
