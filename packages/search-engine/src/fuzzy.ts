/**
 * Fuzzy text matching used by Root Search.
 *
 * Produces a normalised relevance score in [0,1] for a query against a target,
 * combining several strategies so that natural launcher behaviour emerges:
 *   - exact match            → top
 *   - prefix match           → very strong ("chr" → "Chrome")
 *   - word-boundary acronym  → strong ("vsc" → "Visual Studio Code")
 *   - contiguous substring   → strong
 *   - ordered subsequence    → moderate, weighted by contiguity & boundaries
 *   - bounded typo tolerance → weak rescue ("chrme" → "Chrome")
 *
 * Everything is allocation-light and runs per keystroke over thousands of
 * candidates, so the hot paths avoid regex and intermediate arrays.
 */

export type MatchKind =
  | 'exact'
  | 'prefix'
  | 'acronym'
  | 'substring'
  | 'subsequence'
  | 'typo'
  | 'none';

export interface MatchResult {
  readonly score: number;
  readonly kind: MatchKind;
  /** Indices in the target that matched, for highlight rendering. */
  readonly indices: ReadonlyArray<number>;
}

const NO_MATCH: MatchResult = { score: 0, kind: 'none', indices: [] };

/** Lowercase and strip combining diacritical marks (é → e). */
export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function isBoundary(ch: string): boolean {
  return ch === ' ' || ch === '-' || ch === '_' || ch === '.' || ch === '/' || ch === ':';
}

/** Collect indices of characters that begin a "word" within the target. */
function wordStartIndices(target: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < target.length; i++) {
    const ch = target[i]!;
    if (i === 0 && !isBoundary(ch)) {
      starts.push(i);
      continue;
    }
    const prev = target[i - 1]!;
    if (isBoundary(prev) && !isBoundary(ch)) starts.push(i);
    // camelCase boundary: lower→Upper using the ORIGINAL casing is handled by
    // the caller passing both; here we only see normalised text, so we rely on
    // separator-based boundaries which covers app/file names well.
  }
  return starts;
}

/** Levenshtein distance with an early-exit ceiling. */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/** Acronym match: each query char maps to a successive word-start initial. */
function acronymMatch(query: string, target: string): MatchResult {
  const starts = wordStartIndices(target);
  if (query.length > starts.length) return NO_MATCH;
  const indices: number[] = [];
  let qi = 0;
  for (const s of starts) {
    if (qi >= query.length) break;
    if (target[s] === query[qi]) {
      indices.push(s);
      qi++;
    }
  }
  if (qi !== query.length) return NO_MATCH;
  // Reward matching a higher fraction of the word starts (tighter acronym).
  const coverage = query.length / starts.length;
  return { score: 0.82 + 0.1 * coverage, kind: 'acronym', indices };
}

/** Ordered subsequence with contiguity + boundary bonuses. */
function subsequenceMatch(query: string, target: string): MatchResult {
  const indices: number[] = [];
  let ti = 0;
  let contiguous = 0;
  let maxContiguous = 0;
  let boundaryHits = 0;
  let lastIdx = -2;
  for (let qi = 0; qi < query.length; qi++) {
    const qc = query[qi]!;
    let found = -1;
    for (; ti < target.length; ti++) {
      if (target[ti] === qc) {
        found = ti;
        break;
      }
    }
    if (found === -1) return NO_MATCH;
    indices.push(found);
    if (found === lastIdx + 1) contiguous++;
    else contiguous = 1;
    if (contiguous > maxContiguous) maxContiguous = contiguous;
    if (found === 0 || isBoundary(target[found - 1]!)) boundaryHits++;
    lastIdx = found;
    ti = found + 1;
  }
  const coverage = query.length / target.length;
  const contiguityRatio = maxContiguous / query.length;
  const boundaryRatio = boundaryHits / query.length;
  const score =
    0.4 + 0.25 * contiguityRatio + 0.2 * boundaryRatio + 0.15 * coverage;
  return { score: Math.min(score, 0.79), kind: 'subsequence', indices };
}

function range(start: number, len: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < len; i++) out.push(start + i);
  return out;
}

/**
 * Score a normalised query against a normalised target. Callers should
 * normalize() once and reuse across many candidates.
 */
export function matchNormalized(query: string, target: string): MatchResult {
  if (query.length === 0) return { score: 0.0001, kind: 'subsequence', indices: [] };
  if (target.length === 0) return NO_MATCH;

  if (query === target) {
    return { score: 1, kind: 'exact', indices: range(0, target.length) };
  }
  if (target.startsWith(query)) {
    // Prefix: closer to a full prefix scores higher.
    const ratio = query.length / target.length;
    return { score: 0.9 + 0.08 * ratio, kind: 'prefix', indices: range(0, query.length) };
  }

  const substrIdx = target.indexOf(query);
  if (substrIdx !== -1) {
    const atBoundary = substrIdx === 0 || isBoundary(target[substrIdx - 1]!);
    const base = atBoundary ? 0.86 : 0.8;
    const ratio = query.length / target.length;
    return {
      score: base + 0.05 * ratio,
      kind: 'substring',
      indices: range(substrIdx, query.length),
    };
  }

  // Acronym only makes sense for multi-word targets and short-ish queries.
  if (query.length >= 2) {
    const acro = acronymMatch(query, target);
    if (acro.kind !== 'none') return acro;
  }

  const sub = subsequenceMatch(query, target);
  if (sub.kind !== 'none') return sub;

  // Typo rescue: only for comparable-length tokens, distance ≤ 2 (or 1 short).
  const maxDist = query.length <= 4 ? 1 : 2;
  const dist = boundedEditDistance(query, target, maxDist);
  if (dist <= maxDist) {
    const score = 0.5 * (1 - dist / (maxDist + 1));
    return { score, kind: 'typo', indices: [] };
  }

  return NO_MATCH;
}

/** Convenience wrapper that normalises both operands. */
export function match(query: string, target: string): MatchResult {
  return matchNormalized(normalize(query), normalize(target));
}
