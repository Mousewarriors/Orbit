/**
 * Natural-language intent provider for Root Search.
 *
 * This is the deterministic-first bridge between what the user *types in plain
 * language* and Orbit's existing safe actions. It:
 *   1. recognises an intent + slots from the query (pure, @orbit/intent),
 *   2. resolves the referenced entity against cached/native data, and
 *   3. emits a SearchItem whose primaryAction is an existing, audited ActionToken
 *      (navigate the Control Center, open a path, run a narrow built-in, …).
 *
 * Known local requests never call a model. AI-assisted intents are recognised
 * but returned honestly as "not available yet" with a useful web fallback —
 * never as a fake success. The provider is thin glue over the pure pipeline so
 * all routing decisions stay unit-tested in @orbit/intent.
 */
import type {
  SearchItem,
  SearchProvider,
  ActionToken,
  IconSource,
  SearchSource,
} from '@orbit/shared-types';
import {
  bestProject,
  proposeIntent,
  rankApps,
  recogniseIntent,
  type IntentProposal,
  type ProjectCandidate,
} from '@orbit/intent';
import { encodeControlCenterArg } from './controlCenterState.js';

/** App shape the provider needs (subset of native.NativeApp). */
export interface IntentApp {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

/** Project shape the provider needs (subset of native.ProjectMeta). */
export interface IntentProject {
  readonly path: string;
  readonly name: string | null;
}

/** A file hit shape (subset of native.FileRecord). */
export interface IntentFile {
  readonly path: string;
  readonly name: string;
  readonly parent: string;
  readonly kind: string;
}

/** A note hit shape (subset of native.Note). */
export interface IntentNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export interface IntentProviderDeps {
  /** Cached installed-application list (resolved synchronously). */
  readonly getApps: () => ReadonlyArray<IntentApp>;
  /** Cached recent ∪ favourite projects (resolved synchronously). */
  readonly getProjects: () => ReadonlyArray<IntentProject>;
  /** Search the local file index (only called for find-file intents). */
  readonly fileSearch: (query: string, limit: number) => Promise<ReadonlyArray<IntentFile>>;
  /** Search notes (only called for find-notes intents). */
  readonly noteSearch: (query: string, limit: number) => Promise<ReadonlyArray<IntentNote>>;
  /** Default-browser web search URL builder for the AI fallback. */
  readonly webSearchUrl: (q: string) => string;
}

const SOURCE = 'agentos' as const;

function icon(name: string) {
  return { kind: 'builtin' as const, name };
}

/**
 * Make every intent item survive (and lead) the ranker: the title rarely
 * matches the natural-language query verbatim, so we carry the raw query as a
 * keyword (exact match) exactly like the calculator provider does.
 */
interface BaseFields {
  readonly title: string;
  readonly subtitle: string;
  readonly category: string;
  readonly icon: IconSource;
  readonly source: SearchSource;
  readonly confidence?: number;
}

function baseItem(id: string, query: string, fields: BaseFields): Omit<SearchItem, 'primaryAction'> {
  return {
    id,
    title: fields.title,
    subtitle: fields.subtitle,
    keywords: [query],
    category: fields.category,
    source: fields.source,
    icon: fields.icon,
    confidence: fields.confidence ?? 0.95,
  };
}

function controlCenterAction(arg: Parameters<typeof encodeControlCenterArg>[0]): ActionToken {
  return { kind: 'push-view', viewId: 'control-center', args: { id: encodeControlCenterArg(arg) } };
}

/**
 * Build the items for a recognised + proposed intent. Async because find-file /
 * find-notes query native; everything else resolves from cached lists.
 */
async function buildItems(
  query: string,
  recognised: NonNullable<ReturnType<typeof recogniseIntent>>,
  proposal: IntentProposal,
  deps: IntentProviderDeps,
): Promise<SearchItem[]> {
  const { plan, display } = proposal;
  const { slots } = recognised;

  switch (plan.kind) {
    case 'run-builtin': {
      // 'restart-relay' reuses the existing narrow Relay command (keepOpen).
      const action: ActionToken = {
        kind: 'builtin',
        handler: 'run-command',
        args: { commandId: 'builtin.cc.restart' },
      };
      return [
        {
          ...baseItem(`intent.${recognised.intent}`, query, {
            title: display.title,
            subtitle: display.subtitle,
            category: 'Control Center',
            source: 'command',
            icon: icon(display.icon),
          }),
          primaryAction: {
            id: 'intent.restart-relay.run',
            title: 'Restart Relay',
            run: action,
            dangerous: true,
          },
        },
      ];
    }

    case 'control-center': {
      const candidates = deps.getProjects() as readonly ProjectCandidate[];
      let project: ProjectCandidate | null = null;
      if (plan.needsProject) {
        // "latest project" resolves to the most recent (lists are recency-ordered).
        project =
          recognised.intent === 'open_latest_project'
            ? (candidates[0] ?? null)
            : bestProject(slots.projectQuery, candidates);
        if (!project) {
          // Honest fallback: couldn't resolve — offer the Projects tab to scan.
          return [
            {
              ...baseItem(`intent.${recognised.intent}.unresolved`, query, {
                title: display.title,
                subtitle: slots.projectQuery
                  ? `No known project matching "${slots.projectQuery}" — open Projects to scan`
                  : 'No recent projects yet — open Projects to scan',
                category: 'Control Center',
                source: SOURCE,
                icon: icon('agentos'),
                confidence: 0.8,
              }),
              primaryAction: {
                id: `intent.${recognised.intent}.scan`,
                title: 'Open Projects',
                run: controlCenterAction({ tab: 'projects' }),
              },
            },
          ];
        }
      }

      const arg = {
        tab: plan.target.tab,
        ...(plan.target.selectProject && project ? { project: project.path } : {}),
        ...(plan.target.sessionStatus ? { sessionStatus: plan.target.sessionStatus } : {}),
      };
      const subtitle = project ? `${display.subtitle} · ${project.name ?? project.path}` : display.subtitle;
      return [
        {
          ...baseItem(`intent.${recognised.intent}`, query, {
            title: display.title,
            subtitle,
            category: 'Control Center',
            source: SOURCE,
            icon: icon(display.icon),
          }),
          primaryAction: {
            id: `intent.${recognised.intent}.open`,
            title: 'Open',
            run: controlCenterAction(arg),
          },
        },
      ];
    }

    case 'open-project-folder': {
      const project = bestProject(slots.projectQuery, deps.getProjects() as readonly ProjectCandidate[]);
      if (!project) {
        return [
          {
            ...baseItem('intent.open-project-folder.unresolved', query, {
              title: display.title,
              subtitle: `No known project matching "${slots.projectQuery ?? ''}"`,
              category: 'Control Center',
              source: SOURCE,
              icon: icon('folder'),
              confidence: 0.8,
            }),
            primaryAction: {
              id: 'intent.open-project-folder.scan',
              title: 'Open Projects',
              run: controlCenterAction({ tab: 'projects' }),
            },
          },
        ];
      }
      return [
        {
          ...baseItem('intent.open-project-folder', query, {
            title: `Open ${project.name ?? project.path} Folder`,
            subtitle: project.path,
            category: 'Projects',
            source: 'file',
            icon: icon('folder'),
          }),
          primaryAction: {
            id: 'intent.open-project-folder.reveal',
            title: 'Open Folder',
            run: { kind: 'reveal-path', path: project.path },
            requires: ['files.read'],
          },
        },
      ];
    }

    case 'open-application': {
      const q = slots.applicationQuery ?? '';
      const ranked = rankApps(q, deps.getApps());
      if (ranked.length === 0) {
        return [
          {
            ...baseItem('intent.open-application.none', query, {
              title: display.title,
              subtitle: `No installed application matching "${q}"`,
              category: 'Applications',
              source: 'application',
              icon: icon('app'),
              confidence: 0.75,
            }),
            primaryAction: {
              id: 'intent.open-application.none.noop',
              title: 'No match',
              run: { kind: 'copy', text: q },
            },
          },
        ];
      }
      return ranked.slice(0, 3).map((scored, i) => {
        const app = scored.item;
        return {
          ...baseItem(`intent.open-app.${app.id}`, query, {
            title: `Open ${app.name}`,
            subtitle: 'Application',
            category: 'Applications',
            source: 'application',
            icon: { kind: 'letter' as const, text: app.name.slice(0, 1).toUpperCase() },
            confidence: 0.95 - i * 0.03,
          }),
          primaryAction: {
            id: `intent.open-app.${app.id}.launch`,
            title: 'Open',
            run: { kind: 'open-path', path: app.path },
            requires: ['apps.launch'],
          },
        };
      });
    }

    case 'find-files': {
      const term = (slots.fileQuery ?? '').trim();
      if (!term) return [];
      const files = await deps.fileSearch(term, 20);
      if (files.length === 0) {
        return [
          {
            ...baseItem('intent.find-files.none', query, {
              title: `No files matching "${term}"`,
              subtitle: 'The file index returned no results (enable indexing in Settings → Files)',
              category: 'Files',
              source: 'file',
              icon: icon('file'),
              confidence: 0.8,
            }),
            primaryAction: {
              id: 'intent.find-files.none.noop',
              title: 'OK',
              run: { kind: 'copy', text: term },
            },
          },
        ];
      }
      return files.map((f, i) => {
        const isDir = f.kind === 'dir';
        return {
          ...baseItem(`intent.find-file.${f.path}`, query, {
            title: f.name,
            subtitle: `${isDir ? 'Folder' : 'File'} — ${f.parent}`,
            category: isDir ? 'Folders' : 'Files',
            source: 'file',
            icon: icon(isDir ? 'folder' : 'file'),
            confidence: Math.max(0.5, 0.95 - i * 0.02),
          }),
          primaryAction: {
            id: `intent.find-file.${f.path}.open`,
            title: isDir ? 'Open Folder' : 'Open',
            run: { kind: 'open-path', path: f.path },
            requires: ['files.read'],
          },
        };
      });
    }

    case 'find-notes': {
      const term = (slots.noteQuery ?? '').trim();
      if (!term) return [];
      const notes = await deps.noteSearch(term, 15);
      if (notes.length === 0) {
        return [
          {
            ...baseItem('intent.find-notes.none', query, {
              title: `No notes matching "${term}"`,
              subtitle: 'None of your notes mention that',
              category: 'Notes',
              source: 'note',
              icon: icon('file-text'),
              confidence: 0.8,
            }),
            primaryAction: {
              id: 'intent.find-notes.none.noop',
              title: 'OK',
              run: { kind: 'copy', text: term },
            },
          },
        ];
      }
      return notes.map((n, i) => ({
        ...baseItem(`intent.find-note.${n.id}`, query, {
          title: n.title || 'Untitled',
          subtitle: n.body.split('\n')[0]?.slice(0, 80) || 'Empty note',
          category: 'Notes',
          source: 'note',
          icon: icon('file-text'),
          confidence: Math.max(0.5, 0.95 - i * 0.02),
        }),
        primaryAction: {
          id: `intent.find-note.${n.id}.open`,
          title: 'Open Note',
          run: { kind: 'push-view', viewId: 'notes', args: { id: n.id } },
        },
      }));
    }

    case 'unsupported-ai': {
      // Honest: Quick AI isn't wired yet. Offer a real web-search fallback for
      // the captured question rather than pretending the model ran.
      const question = (slots.question ?? query).trim();
      return [
        {
          ...baseItem(`intent.${recognised.intent}`, query, {
            title: display.title,
            subtitle: display.subtitle,
            category: 'Quick AI',
            source: 'ai',
            icon: icon('ai'),
            confidence: 0.85,
          }),
          primaryAction: {
            id: `intent.${recognised.intent}.web`,
            title: 'Search the web',
            run: { kind: 'open-url', url: deps.webSearchUrl(question) },
          },
        },
      ];
    }

    default:
      return [];
  }
}

/**
 * Create the natural-language intent provider. `canHandle` is a cheap length
 * gate; recognition (regex-only, no I/O) runs in `search` and returns [] when
 * the text isn't a recognised request, so Root Search behaves exactly as before
 * for entity/exact queries.
 */
export function createIntentProvider(deps: IntentProviderDeps): SearchProvider {
  return {
    id: 'intent',
    source: SOURCE,
    canHandle: (q) => q.trim().length >= 3,
    async search(query): Promise<SearchItem[]> {
      const recognised = recogniseIntent(query);
      if (!recognised) return [];
      const proposal = proposeIntent(recognised);
      return buildItems(query, recognised, proposal, deps);
    },
  };
}
