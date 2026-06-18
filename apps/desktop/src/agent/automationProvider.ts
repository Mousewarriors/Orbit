/**
 * Root Search provider for saved automations. Each automation opens Orbit Agent
 * with a prebuilt, validated plan (arg `auto:<id>`), landing straight on the
 * preview so the user approves any consequential step before it runs.
 */
import type { SearchItem, SearchProvider } from '@orbit/shared-types';
import { AUTOMATIONS } from '@orbit/automations';

const PREFIX = 'auto:';

/** Encode/decode the Orbit Agent arg that selects a prebuilt automation. */
export function encodeAutomationArg(id: string): string {
  return `${PREFIX}${id}`;
}
export function decodeAutomationArg(arg: string | undefined): string | null {
  return arg && arg.startsWith(PREFIX) ? arg.slice(PREFIX.length) : null;
}

export function createAutomationProvider(): SearchProvider {
  return {
    id: 'automations',
    source: 'command',
    canHandle: (q) => q.trim().length >= 2,
    search(query): Promise<SearchItem[]> {
      const q = query.trim().toLowerCase();
      const items = AUTOMATIONS.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.keywords.some((k) => k.includes(q) || q.includes(k)) ||
          'automation'.includes(q),
      ).map<SearchItem>((a) => ({
        id: `automation.${a.id}`,
        title: a.title,
        subtitle: a.description,
        keywords: [...a.keywords, 'automation'],
        category: 'Automations',
        source: 'command',
        icon: { kind: 'builtin', name: a.icon },
        confidence: 0.7,
        primaryAction: {
          id: `automation.${a.id}.run`,
          title: 'Open in Orbit Agent',
          run: { kind: 'push-view', viewId: 'orbit-agent', args: { id: encodeAutomationArg(a.id) } },
        },
      }));
      return Promise.resolve(items);
    },
  };
}
