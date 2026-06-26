import { runSearch, type SearchUpdate } from '@orbit/search-engine';
import type { RankedItem, RankingSignals, SearchProvider } from '@orbit/shared-types';
import { needsConfirmation } from './confirm.js';
import type { ExecuteOutcome } from './execute.js';
import type { OrbitCommandPayload } from './native.js';

type Unlisten = () => void;

export interface OrbitCommandBridgeDeps {
  isTauri(): boolean;
  takePendingOrbitCommands(): Promise<ReadonlyArray<OrbitCommandPayload>>;
  onOrbitCommandAvailable(handler: (payload: OrbitCommandPayload) => void): Promise<Unlisten>;
}

export interface ExternalOrbitCommandResult {
  status: 'ignored' | 'no-results' | 'needs-confirmation' | 'executed';
  query: string;
  itemId?: string;
  outcome?: ExecuteOutcome;
}

export interface RunExternalOrbitCommandDeps {
  providers: ReadonlyArray<SearchProvider>;
  signals: RankingSignals;
  execute: (ranked: RankedItem, query: string) => Promise<ExecuteOutcome>;
  requestConfirmation: (ranked: RankedItem) => void;
  onUpdate?: (update: SearchUpdate) => void;
  signal?: AbortSignal;
}

/**
 * Drain native-supplied Orbit commands exactly once. The native side stores
 * commands in a queue and emits `orbit-command-available` only as a wake-up
 * signal; this bridge is responsible for draining the queue on startup and
 * after each signal without double-executing payloads.
 */
export async function startOrbitCommandBridge(
  deps: OrbitCommandBridgeDeps,
  handle: (payload: OrbitCommandPayload) => Promise<void> | void,
): Promise<Unlisten> {
  if (!deps.isTauri()) return () => {};

  let stopped = false;
  let draining = false;
  let drainAgain = false;

  const drain = async (): Promise<void> => {
    if (stopped) return;
    if (draining) {
      drainAgain = true;
      return;
    }

    draining = true;
    try {
      do {
        drainAgain = false;
        const batch = await deps.takePendingOrbitCommands();
        for (const payload of batch) {
          if (stopped) return;
          await handle(payload);
        }
      } while (drainAgain && !stopped);
    } finally {
      draining = false;
    }
  };

  const unlisten = await deps.onOrbitCommandAvailable(() => {
    void drain();
  });
  await drain();

  return () => {
    stopped = true;
    unlisten();
  };
}

/**
 * Resolve and run a natural-language command received from PowerShell / OS
 * launch. It deliberately uses the same provider list, ranking, confirmation
 * policy, and action executor as a typed Root Search query.
 */
export async function runExternalOrbitCommand(
  payload: OrbitCommandPayload,
  deps: RunExternalOrbitCommandDeps,
): Promise<ExternalOrbitCommandResult> {
  const query = payload.query.trim();
  if (!query) return { status: 'ignored', query };

  const final = await runSearch(
    query,
    deps.providers,
    { signals: deps.signals, limit: 50 },
    (update) => deps.onUpdate?.(update),
    deps.signal,
  );

  if (deps.signal?.aborted) return { status: 'ignored', query };

  const top = final.results[0];
  if (!top) return { status: 'no-results', query };

  const action = top.item.primaryAction;
  if (needsConfirmation(action)) {
    deps.requestConfirmation(top);
    return { status: 'needs-confirmation', query, itemId: top.item.id };
  }

  const outcome = await deps.execute(top, query);
  return { status: 'executed', query, itemId: top.item.id, outcome };
}
