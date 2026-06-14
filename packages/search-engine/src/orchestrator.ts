import type {
  RankedItem,
  RankingSignals,
  SearchItem,
  SearchProvider,
} from '@orbit/shared-types';
import { rank, type RankingWeights, DEFAULT_WEIGHTS } from './ranking.js';

export interface SearchUpdate {
  /** Ranked results available so far (may grow as providers report in). */
  readonly results: ReadonlyArray<RankedItem>;
  /** Providers that have finished (success or error). */
  readonly settledProviders: ReadonlyArray<string>;
  /** Providers still running. */
  readonly pendingProviders: ReadonlyArray<string>;
  /** Errors keyed by provider id. */
  readonly errors: ReadonlyMap<string, string>;
  /** True once every provider has settled. */
  readonly done: boolean;
}

export interface SearchOptions {
  readonly signals: RankingSignals;
  readonly weights?: RankingWeights;
  readonly limit?: number;
  /** Per-provider timeout in ms; a provider exceeding it is abandoned. */
  readonly providerTimeoutMs?: number;
}

/**
 * Run a query across providers. Results are delivered incrementally via
 * `onUpdate` so the renderer can paint instant local providers (apps/commands)
 * while slow ones (files/AI) are still running. Cancellable via `signal`.
 */
export async function runSearch(
  query: string,
  providers: ReadonlyArray<SearchProvider>,
  options: SearchOptions,
  onUpdate: (update: SearchUpdate) => void,
  signal?: AbortSignal,
): Promise<SearchUpdate> {
  const { signals, weights = DEFAULT_WEIGHTS, limit = 100, providerTimeoutMs = 2000 } = options;

  const active = providers.filter((p) => p.canHandle(query));
  const collected = new Map<string, ReadonlyArray<SearchItem>>();
  const settled = new Set<string>();
  const errors = new Map<string, string>();

  const buildUpdate = (done: boolean): SearchUpdate => {
    const merged: SearchItem[] = [];
    for (const items of collected.values()) merged.push(...items);
    const ranked = rank(query, merged, signals, weights).slice(0, limit);
    return {
      results: ranked,
      settledProviders: [...settled],
      pendingProviders: active.map((p) => p.id).filter((id) => !settled.has(id)),
      errors,
      done,
    };
  };

  const runOne = async (provider: SearchProvider): Promise<void> => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
    try {
      const items = await provider.search(query, controller.signal);
      if (!signal?.aborted) collected.set(provider.id, items);
    } catch (err) {
      if (controller.signal.aborted && !signal?.aborted) {
        errors.set(provider.id, 'timed out');
      } else if (!signal?.aborted) {
        errors.set(provider.id, err instanceof Error ? err.message : String(err));
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      settled.add(provider.id);
      if (!signal?.aborted) onUpdate(buildUpdate(settled.size === active.length));
    }
  };

  // Emit an initial empty update so the UI can show pending state immediately.
  if (!signal?.aborted) onUpdate(buildUpdate(active.length === 0));

  await Promise.all(active.map(runOne));
  return buildUpdate(true);
}
