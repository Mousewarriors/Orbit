/**
 * Search providers for the launcher slice: applications (from the native index)
 * and the calculator. Both conform to the shared SearchProvider contract so the
 * orchestrator can run them alongside the command provider.
 */
import type { SearchItem, SearchProvider } from '@orbit/shared-types';
import { calculate, FALLBACK_RATES } from '@orbit/calculator';
import { resolveTemplate } from '@orbit/placeholders';
import * as native from './native.js';
import type { NativeApp } from './native.js';

/** First non-empty line of `text`, trimmed and bounded for a subtitle. */
function snippetPreview(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

/** Build an application provider over an already-loaded native app list. */
export function createAppProvider(getApps: () => ReadonlyArray<NativeApp>): SearchProvider {
  return {
    id: 'applications',
    source: 'application',
    canHandle: () => true,
    async search(): Promise<SearchItem[]> {
      return getApps().map((app) => ({
        id: app.id,
        title: app.name,
        subtitle: 'Application',
        category: 'Applications',
        source: 'application' as const,
        icon: { kind: 'letter' as const, text: app.name.slice(0, 1).toUpperCase() },
        confidence: 0.6,
        primaryAction: {
          id: `${app.id}.launch`,
          title: 'Open',
          run: { kind: 'open-path' as const, path: app.path },
          requires: ['apps.launch' as const],
        },
        secondaryActions: [
          {
            id: `${app.id}.copy-path`,
            title: 'Copy Path',
            run: { kind: 'copy' as const, text: app.path },
          },
        ],
      }));
    },
  };
}

/**
 * Snippet provider. Surfaces stored snippets while typing (gated to ≥2 chars so
 * it doesn't crowd the root). Placeholders that need no user input ({date},
 * {time}, {uuid}, …) are resolved at search time so the pasted text is final;
 * the primary action injects it into the active app via paste-injection.
 */
export function createSnippetProvider(): SearchProvider {
  return {
    id: 'snippets',
    source: 'snippet',
    canHandle: (q) => native.isTauri() && q.trim().length >= 2,
    async search(query): Promise<SearchItem[]> {
      const snippets = await native.snippetList(query, 20);
      const now = new Date();
      return snippets.map((s) => {
        const resolved = resolveTemplate(s.content, { now }).text;
        const subtitle = s.keyword
          ? `⌨ ${s.keyword} · ${snippetPreview(resolved)}`
          : snippetPreview(resolved);
        return {
          id: `snippet.${s.id}`,
          title: s.name,
          subtitle,
          category: 'Snippets',
          source: 'snippet' as const,
          icon: { kind: 'letter' as const, text: s.name.slice(0, 1).toUpperCase() },
          confidence: 0.6,
          primaryAction: {
            id: `snippet.${s.id}.paste`,
            title: 'Paste Snippet',
            run: { kind: 'paste' as const, text: resolved, snippetId: s.id },
          },
          secondaryActions: [
            {
              id: `snippet.${s.id}.copy`,
              title: 'Copy to Clipboard',
              run: { kind: 'copy' as const, text: resolved },
            },
          ],
        };
      });
    },
  };
}

/**
 * Calculator provider. Returns a single high-confidence result when the query
 * parses as a calculation, otherwise nothing (so it never pollutes results).
 */
export function createCalculatorProvider(): SearchProvider {
  return {
    id: 'calculator',
    source: 'calculator',
    canHandle: (q) => /\d/.test(q) || /\bin\b|\bto\b|%|of/.test(q),
    async search(query): Promise<SearchItem[]> {
      const result = calculate(query, { rates: FALLBACK_RATES });
      if (!result) return [];
      const value = String(result.value);
      const display = result.formatted;
      return [
        {
          id: 'calc.result',
          title: display,
          subtitle: result.expression + (result.stale ? '  ·  rates may be out of date' : ''),
          // The result text never matches the typed query, so carry the query
          // as a keyword to keep the item in the ranked set and at the top.
          keywords: [query],
          category: 'Calculator',
          source: 'calculator' as const,
          icon: { kind: 'builtin' as const, name: 'calculator' },
          // Calculator results are near-certain; rank at the top.
          confidence: 1,
          primaryAction: {
            id: 'calc.copy',
            title: 'Copy Result',
            run: { kind: 'copy' as const, text: display },
          },
          secondaryActions: [
            {
              id: 'calc.copy-value',
              title: 'Copy Value',
              run: { kind: 'copy' as const, text: value },
            },
            {
              id: 'calc.copy-equation',
              title: 'Copy Equation',
              run: { kind: 'copy' as const, text: `${result.expression} = ${display}` },
            },
          ],
        },
      ];
    },
  };
}
