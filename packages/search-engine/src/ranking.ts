import type {
  RankedItem,
  RankingSignals,
  ScoreExplanation,
  SearchItem,
} from '@orbit/shared-types';
import { match, matchNormalized, normalize, type MatchResult } from './fuzzy.js';

/** Tunable weights for the ranking blend. Centralised for easy diagnostics. */
export interface RankingWeights {
  readonly text: number;
  readonly usage: number;
  readonly recency: number;
  readonly pinned: number;
  readonly favourite: number;
  readonly confidence: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  text: 1,
  usage: 0.35,
  recency: 0.25,
  pinned: 0.6,
  favourite: 0.4,
  confidence: 0.3,
};

/** Half-life (ms) for recency decay — ~3 days. */
const RECENCY_HALF_LIFE = 3 * 24 * 60 * 60 * 1000;

/** Saturating usage boost: log-scaled so a few uses matter, many plateau. */
function usageBoost(count: number | undefined): number {
  if (!count || count <= 0) return 0;
  return Math.min(1, Math.log10(count + 1) / 2); // ~1.0 around 99 uses
}

function recencyBoost(lastUsed: number | undefined, now: number): number {
  if (!lastUsed) return 0;
  const age = Math.max(0, now - lastUsed);
  return Math.pow(0.5, age / RECENCY_HALF_LIFE); // 1.0 now → 0.5 at half-life
}

/** Best textual match across an item's searchable fields. */
function bestTextMatch(
  normQuery: string,
  item: SearchItem,
): { result: MatchResult; field: ScoreExplanation['matchedField'] } {
  let best: MatchResult = matchNormalized(normQuery, normalize(item.title));
  let field: ScoreExplanation['matchedField'] = 'title';

  const consider = (text: string, f: ScoreExplanation['matchedField']) => {
    const r = matchNormalized(normQuery, normalize(text));
    if (r.score > best.score) {
      best = r;
      field = f;
    }
  };

  for (const a of item.aliases ?? []) consider(a, 'alias');
  for (const k of item.keywords ?? []) consider(k, 'keyword');
  if (item.subtitle) consider(item.subtitle, 'subtitle');

  return { result: best, field };
}

function explanationFor(
  m: MatchResult,
  field: ScoreExplanation['matchedField'],
  signals: RankingSignals,
  item: SearchItem,
  weights: RankingWeights,
): { score: number; explanation: ScoreExplanation } {
  const exact = m.kind === 'exact' ? 0.15 : 0;
  const prefix = m.kind === 'prefix' ? 0.1 : 0;
  const acronym = m.kind === 'acronym' ? 0.05 : 0;
  const editPenalty = m.kind === 'typo' ? -0.1 : 0;

  const usage = usageBoost(signals.usage.get(item.id)) * weights.usage;
  const recency = recencyBoost(signals.lastUsed.get(item.id), signals.now) * weights.recency;
  const pinned = signals.pinned.has(item.id) ? weights.pinned : 0;
  const favourite = signals.favourites.has(item.id) ? weights.favourite : 0;
  const confidence = (item.confidence ?? 0) * weights.confidence;

  const textRelevance = m.score * weights.text;

  const score =
    textRelevance +
    exact +
    prefix +
    acronym +
    editPenalty +
    usage +
    recency +
    pinned +
    favourite +
    confidence;

  const explanation: ScoreExplanation = {
    textRelevance,
    exactBonus: exact,
    prefixBonus: prefix,
    acronymBonus: acronym,
    editDistancePenalty: editPenalty,
    usageBoost: usage,
    recencyBoost: recency,
    pinnedBoost: pinned,
    favouriteBoost: favourite,
    confidenceWeight: confidence,
    matchedField: field,
  };
  return { score, explanation };
}

/**
 * Rank a set of candidate items for a query. Returns items sorted descending by
 * blended score, with explanations for the diagnostics view. Items that do not
 * match textually are dropped (unless the query is empty, in which case usage &
 * recency drive the "recent commands" ordering).
 */
export function rank(
  query: string,
  items: ReadonlyArray<SearchItem>,
  signals: RankingSignals,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): RankedItem[] {
  const normQuery = normalize(query.trim());
  const emptyQuery = normQuery.length === 0;
  const out: RankedItem[] = [];

  for (const item of items) {
    if (emptyQuery) {
      // No query: surface recent/frequent/pinned items only.
      const usage = usageBoost(signals.usage.get(item.id));
      const recency = recencyBoost(signals.lastUsed.get(item.id), signals.now);
      const pinned = signals.pinned.has(item.id) ? 1 : 0;
      const favourite = signals.favourites.has(item.id) ? 0.6 : 0;
      const score = usage * 0.4 + recency * 0.4 + pinned * 1 + favourite;
      if (score <= 0) continue;
      out.push({
        item,
        score,
        explanation: {
          textRelevance: 0,
          exactBonus: 0,
          prefixBonus: 0,
          acronymBonus: 0,
          editDistancePenalty: 0,
          usageBoost: usage * 0.4,
          recencyBoost: recency * 0.4,
          pinnedBoost: pinned,
          favouriteBoost: favourite,
          confidenceWeight: 0,
          matchedField: 'none',
        },
      });
      continue;
    }

    const { result, field } = bestTextMatch(normQuery, item);
    if (result.kind === 'none') continue;
    const { score, explanation } = explanationFor(result, field, signals, item, weights);
    out.push({ item, score, explanation });
  }

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable tie-break: shorter titles, then alphabetical.
    if (a.item.title.length !== b.item.title.length) {
      return a.item.title.length - b.item.title.length;
    }
    return a.item.title.localeCompare(b.item.title);
  });

  return out;
}

/** Score a single (query, target) pair — exposed for callers & tests. */
export { match, normalize };
