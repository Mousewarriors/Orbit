import type { ActionDescriptor } from './action.js';
import type { IconSource } from './icon.js';
import type { PermissionRequirement } from './permission.js';

/** The provider category a result came from (drives grouping & icons). */
export type SearchSource =
  | 'application'
  | 'command'
  | 'extension'
  | 'file'
  | 'folder'
  | 'quicklink'
  | 'snippet'
  | 'note'
  | 'calculator'
  | 'calendar'
  | 'system'
  | 'ai'
  | 'browser'
  | 'agentos';

export type AvailabilityState = 'available' | 'permission-required' | 'unavailable' | 'loading';

/**
 * The normalised unit every search provider returns. The ranking engine
 * consumes these and produces a sorted, scored list for the renderer.
 */
export interface SearchItem {
  /** Stable id, unique within a provider+session. */
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  /** Additional text the matcher should consider (kept out of the title). */
  readonly keywords?: ReadonlyArray<string>;
  readonly aliases?: ReadonlyArray<string>;
  readonly icon?: IconSource;
  readonly category: string;
  readonly source: SearchSource;
  /** Primary action executed on Enter. */
  readonly primaryAction: ActionDescriptor;
  readonly secondaryActions?: ReadonlyArray<ActionDescriptor>;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly availability?: AvailabilityState;
  readonly permissions?: ReadonlyArray<PermissionRequirement>;
  /**
   * Provider-supplied base confidence in [0,1]. Lets a provider express that a
   * calculator result is near-certain while a fuzzy file hit is speculative.
   * The ranking engine blends this with textual relevance and usage signals.
   */
  readonly confidence?: number;
}

/** A scored item plus an explanation, for the ranking diagnostics view. */
export interface RankedItem {
  readonly item: SearchItem;
  readonly score: number;
  readonly explanation: ScoreExplanation;
}

export interface ScoreExplanation {
  readonly textRelevance: number;
  readonly exactBonus: number;
  readonly prefixBonus: number;
  readonly acronymBonus: number;
  readonly editDistancePenalty: number;
  readonly usageBoost: number;
  readonly recencyBoost: number;
  readonly pinnedBoost: number;
  readonly favouriteBoost: number;
  readonly confidenceWeight: number;
  /** The field that produced the best textual match. */
  readonly matchedField: 'title' | 'alias' | 'keyword' | 'subtitle' | 'none';
}

/** Signals the ranking engine layers on top of textual relevance. */
export interface RankingSignals {
  /** commandId/itemId -> use count. */
  readonly usage: ReadonlyMap<string, number>;
  /** commandId/itemId -> last used epoch ms. */
  readonly lastUsed: ReadonlyMap<string, number>;
  readonly pinned: ReadonlySet<string>;
  readonly favourites: ReadonlySet<string>;
  /** Current time for recency decay; injectable for deterministic tests. */
  readonly now: number;
}

/** A search provider contributes items for a query. */
export interface SearchProvider {
  readonly id: string;
  readonly source: SearchSource;
  /**
   * Whether this provider should run for the given query. Cheap providers
   * (apps, commands) always run; expensive ones (files, AI) may gate on length.
   */
  canHandle(query: string): boolean;
  /**
   * Produce candidate items. Must be cancellable via the AbortSignal so slow
   * providers never block the merged result set.
   */
  search(query: string, signal: AbortSignal): Promise<ReadonlyArray<SearchItem>>;
}
