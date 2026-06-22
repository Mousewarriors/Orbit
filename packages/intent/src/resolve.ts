/**
 * Pure entity resolution: rank candidate projects and applications against a
 * slot string. The renderer supplies the live lists; this module just scores
 * and orders them deterministically so the provider can pick the best match.
 */
import { match, normalize } from '@orbit/search-engine';

/** Minimal project shape the resolver needs (a subset of native ProjectMeta). */
export interface ProjectCandidate {
  readonly path: string;
  readonly name: string | null;
}

/** Minimal application shape the resolver needs. */
export interface AppCandidate {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export interface Scored<T> {
  readonly item: T;
  readonly score: number;
}

/** The leaf folder name of a path (Windows or POSIX separators). */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

/** A project's best display name: explicit name, else its folder name. */
export function projectDisplayName(p: ProjectCandidate): string {
  return p.name && p.name.trim().length > 0 ? p.name : basename(p.path);
}

/**
 * Score a query against a target across the name and (for projects) the path,
 * taking the strongest signal. Returns 0 when nothing matches.
 */
function scoreText(query: string, ...targets: string[]): number {
  const q = normalize(query);
  let best = 0;
  for (const target of targets) {
    if (!target) continue;
    const r = match(q, normalize(target));
    if (r.score > best) best = r.score;
  }
  return best;
}

/**
 * Rank projects by relevance to `query` (matched against name, folder name and
 * full path). Returns only positive matches, strongest first. An empty query
 * returns the candidates unchanged (callers use that for "latest project").
 */
export function rankProjects(
  query: string | undefined,
  projects: readonly ProjectCandidate[],
): Array<Scored<ProjectCandidate>> {
  const q = (query ?? '').trim();
  if (!q) return projects.map((item) => ({ item, score: 0 }));
  const normalizedQuery = normalize(q);
  const out: Array<Scored<ProjectCandidate>> = [];
  for (const item of projects) {
    const displayName = projectDisplayName(item);
    let score = scoreText(q, displayName, basename(item.path), item.path);
    const canonicalWorkspaceName = normalize(displayName)
      .replace(/[\s_-]*(?:monorepo|workspace|repository|project)$/, '')
      .trim();
    if (canonicalWorkspaceName === normalizedQuery) {
      score = Math.max(score, 0.999);
    }
    if (score > 0) out.push({ item, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** The single best project match, or null when nothing scores. */
export function bestProject(
  query: string | undefined,
  projects: readonly ProjectCandidate[],
): ProjectCandidate | null {
  const ranked = rankProjects(query, projects);
  return ranked[0]?.item ?? null;
}

/** A confident single match, an ambiguous shortlist, or nothing. */
export type ProjectResolution =
  | { readonly kind: 'match'; readonly project: ProjectCandidate }
  | { readonly kind: 'choices'; readonly projects: readonly ProjectCandidate[] }
  | { readonly kind: 'none' };

/**
 * Resolve a query against candidate projects/folders, distinguishing a confident
 * single match from an *ambiguous* set — several near-equally-strong matches,
 * e.g. folders with the same name in different locations. Callers with an
 * interactive loop (Chat) can ask the user to choose from `choices`; deterministic
 * callers (Mission) can fall back to `bestProject` and take the top match.
 *
 * "Ambiguous" = more than one candidate within `margin` of the top score.
 */
export function resolveProjectMatch(
  query: string,
  candidates: readonly ProjectCandidate[],
  opts: { readonly margin?: number; readonly maxChoices?: number } = {},
): ProjectResolution {
  const margin = opts.margin ?? 0.05;
  const maxChoices = opts.maxChoices ?? 5;
  const ranked = rankProjects(query, candidates);
  const top = ranked[0];
  if (!top || top.score <= 0) return { kind: 'none' };
  const contenders = ranked.filter((r) => r.score >= top.score - margin);
  if (contenders.length > 1) {
    return { kind: 'choices', projects: contenders.slice(0, maxChoices).map((c) => c.item) };
  }
  return { kind: 'match', project: top.item };
}

/**
 * Rank applications by relevance to `query` (matched against the app name).
 * Returns positive matches strongest first.
 */
export function rankApps(
  query: string,
  apps: readonly AppCandidate[],
): Array<Scored<AppCandidate>> {
  const q = query.trim();
  if (!q) return [];
  const out: Array<Scored<AppCandidate>> = [];
  for (const item of apps) {
    const score = scoreText(q, item.name);
    if (score > 0) out.push({ item, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
