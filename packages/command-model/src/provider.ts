import type {
  RankingSignals,
  SearchItem,
  SearchProvider,
} from '@orbit/shared-types';
import type { CommandRegistry } from './registry.js';

/** Convert a registry's enabled commands into normalised SearchItems. */
export function commandsToSearchItems(registry: CommandRegistry): SearchItem[] {
  return registry.listEnabled().map((cmd) => {
    const custom = registry.getCustomisation(cmd.id);
    const aliases = custom?.alias ? [custom.alias] : [];
    return {
      id: cmd.id,
      title: cmd.title,
      ...(cmd.subtitle !== undefined ? { subtitle: cmd.subtitle } : {}),
      ...(cmd.keywords !== undefined ? { keywords: [...cmd.keywords, ...(cmd.synonyms ?? [])] } : {}),
      aliases,
      ...(cmd.icon !== undefined ? { icon: cmd.icon } : {}),
      category: cmd.category,
      source: 'command' as const,
      primaryAction: {
        id: `${cmd.id}.run`,
        title: 'Run Command',
        run: { kind: 'builtin' as const, handler: 'run-command', args: { commandId: cmd.id } },
        ...(cmd.permissions !== undefined
          ? { requires: cmd.permissions.map((p) => p.id) }
          : {}),
      },
      ...(cmd.permissions !== undefined ? { permissions: cmd.permissions } : {}),
    } satisfies SearchItem;
  });
}

/**
 * A SearchProvider backed by the command registry. Always runs (commands are
 * cheap and local) so they appear instantly in Root Search.
 */
export function createCommandProvider(registry: CommandRegistry): SearchProvider {
  return {
    id: 'commands',
    source: 'command',
    canHandle: () => true,
    async search() {
      return commandsToSearchItems(registry);
    },
  };
}

/** Build RankingSignals from the registry's usage/customisation state. */
export function buildSignalsFromRegistry(registry: CommandRegistry, now: number): RankingSignals {
  const usage = new Map<string, number>();
  const lastUsed = new Map<string, number>();
  const pinned = new Set<string>();
  const favourites = new Set<string>();
  for (const cmd of registry.list()) {
    const u = registry.getUsage(cmd.id);
    if (u) {
      usage.set(cmd.id, u.useCount);
      lastUsed.set(cmd.id, u.lastUsedAt);
    }
    const c = registry.getCustomisation(cmd.id);
    if (c?.pinned) pinned.add(cmd.id);
    if (c?.favourite) favourites.add(cmd.id);
  }
  return { usage, lastUsed, pinned, favourites, now };
}
