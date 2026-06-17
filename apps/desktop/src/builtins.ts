/**
 * Built-in commands for the Phase 1 launcher slice. These are real, working
 * commands (not placeholders): each is registered in the command registry for
 * search/ranking, and has a concrete effect executed via the action executor.
 */
import type { CommandDefinition } from '@orbit/shared-types';
import { CommandRegistry } from '@orbit/command-model';
import type { EffectResult } from './execute.js';
import * as native from './native.js';

type Effect = (query: string) => Promise<EffectResult | void> | EffectResult | void;

export interface BuiltinCommand {
  readonly definition: CommandDefinition;
  /** The side effect run when the command is invoked, given the current query. */
  readonly effect: Effect;
}

function def(
  id: string,
  title: string,
  category: string,
  icon: string,
  extra: Partial<CommandDefinition> = {},
): CommandDefinition {
  return {
    id,
    title,
    mode: 'no-view',
    source: { kind: 'builtin' },
    category,
    enabled: true,
    icon: { kind: 'builtin', name: icon },
    ...extra,
  };
}

/** Quicklink-style web searches that open the default browser. */
function webSearch(
  id: string,
  title: string,
  urlFor: (q: string) => string,
  keywords: string[],
): BuiltinCommand {
  return {
    definition: def(id, title, 'Web Search', 'globe', {
      keywords,
      subtitle: 'Opens your default browser',
    }),
    effect: (query: string) => native.openUrl(urlFor(query || title)),
  };
}

/** A window-management command targeting the user's previous window. */
function windowCmd(
  layout: native.WindowLayout,
  title: string,
  keywords: string[],
): BuiltinCommand {
  return {
    definition: def(`builtin.window.${layout}`, title, 'Window Management', 'layout', {
      keywords: ['window', 'move', 'resize', ...keywords],
      subtitle: 'Move the active window',
    }),
    effect: () => native.manageWindow(layout),
  };
}

const WINDOW_COMMANDS: BuiltinCommand[] = [
  windowCmd('left-half', 'Left Half', ['left']),
  windowCmd('right-half', 'Right Half', ['right']),
  windowCmd('top-half', 'Top Half', ['top']),
  windowCmd('bottom-half', 'Bottom Half', ['bottom']),
  windowCmd('top-left', 'Top Left Quarter', ['quarter', 'corner']),
  windowCmd('top-right', 'Top Right Quarter', ['quarter', 'corner']),
  windowCmd('bottom-left', 'Bottom Left Quarter', ['quarter', 'corner']),
  windowCmd('bottom-right', 'Bottom Right Quarter', ['quarter', 'corner']),
  windowCmd('maximize', 'Maximize', ['full', 'fullscreen']),
  windowCmd('almost-maximize', 'Almost Maximize', ['large']),
  windowCmd('center', 'Center', ['centre', 'middle']),
  windowCmd('first-third', 'First Third', ['thirds']),
  windowCmd('center-third', 'Center Third', ['thirds', 'middle']),
  windowCmd('last-third', 'Last Third', ['thirds']),
  windowCmd('first-two-thirds', 'First Two Thirds', ['thirds']),
  windowCmd('last-two-thirds', 'Last Two Thirds', ['thirds']),
];

export const BUILTINS: BuiltinCommand[] = [
  ...WINDOW_COMMANDS,
  {
    definition: def('builtin.clipboard.history', 'Clipboard History', 'Clipboard', 'clipboard', {
      keywords: ['paste', 'copy', 'history'],
      subtitle: 'Browse and reuse what you copied',
    }),
    effect: (): EffectResult => ({ pushView: 'clipboard' }),
  },
  {
    definition: def('builtin.snippets.manage', 'Snippets', 'Snippets', 'clipboard', {
      keywords: ['snippet', 'expand', 'template', 'paste', 'text'],
      subtitle: 'Create, edit and paste reusable text',
    }),
    effect: (): EffectResult => ({ pushView: 'snippets' }),
  },
  {
    definition: def('builtin.quicklinks.manage', 'Quicklinks', 'Quicklinks', 'link', {
      keywords: ['quicklink', 'link', 'bookmark', 'url', 'shortcut', 'open'],
      subtitle: 'Create and open parameterised links',
    }),
    effect: (): EffectResult => ({ pushView: 'quicklinks' }),
  },
  {
    definition: def('builtin.notes.manage', 'Notes', 'Notes', 'file-text', {
      keywords: ['note', 'notes', 'scratch', 'memo', 'write', 'markdown'],
      subtitle: 'Write and search local notes',
    }),
    effect: (): EffectResult => ({ pushView: 'notes' }),
  },
  {
    definition: def('builtin.control.center', 'Control Center', 'Agents', 'agentos', {
      keywords: ['agent', 'agents', 'ai', 'codex', 'claude', 'relay', 'project', 'session', 'launch', 'control', 'center'],
      subtitle: 'Projects, agents, sessions, activity and handoffs',
    }),
    effect: (): EffectResult => ({ pushView: 'control-center' }),
  },
  {
    definition: def('builtin.agents.center', 'Agent Control Center', 'Agents', 'agentos', {
      keywords: ['agent', 'agents', 'ai', 'codex', 'claude', 'relay', 'launch'],
      subtitle: 'Launch and track local agent sessions',
    }),
    effect: (): EffectResult => ({ pushView: 'agent-center' }),
  },
  {
    definition: def('builtin.cc.projects', 'Projects', 'Control Center', 'agentos', {
      keywords: ['project', 'projects', 'repos', 'code', 'workspace'],
      subtitle: 'Browse and manage scanned projects',
    }),
    effect: (): EffectResult => ({ pushView: 'control-center', pushViewArg: 'projects' }),
  },
  {
    definition: def('builtin.cc.sessions', 'Active Sessions', 'Control Center', 'agentos', {
      keywords: ['session', 'sessions', 'running', 'agent'],
      subtitle: 'View running agent sessions',
    }),
    effect: (): EffectResult => ({ pushView: 'control-center', pushViewArg: 'sessions' }),
  },
  {
    definition: def('builtin.cc.activity', 'Activity', 'Control Center', 'agentos', {
      keywords: ['activity', 'events', 'relay', 'log', 'timeline'],
      subtitle: 'Live Relay event timeline',
    }),
    effect: (): EffectResult => ({ pushView: 'control-center', pushViewArg: 'activity' }),
  },
  {
    definition: def('builtin.cc.handoffs', 'Handoffs', 'Control Center', 'agentos', {
      keywords: ['handoff', 'handoffs', 'continuation', 'transfer'],
      subtitle: 'Agent-to-agent handoff workspace',
    }),
    effect: (): EffectResult => ({ pushView: 'control-center', pushViewArg: 'handoffs' }),
  },
  {
    definition: def('builtin.cc.approvals', 'Approvals', 'Control Center', 'agentos', {
      keywords: ['approval', 'approvals', 'approve', 'deny', 'confirm'],
      subtitle: 'Observational approval tracking',
    }),
    effect: (): EffectResult => ({ pushView: 'control-center', pushViewArg: 'approvals' }),
  },
  {
    definition: def('builtin.cc.continue', 'Continue Project', 'Control Center', 'agentos', {
      keywords: ['continue', 'resume', 'project', 'agent', 'launch', 'pick up'],
      subtitle: 'Pick up where you left off on a project',
    }),
    effect: (): EffectResult => ({ pushView: 'control-center', pushViewArg: 'launch' }),
  },
  {
    definition: def('builtin.cc.diagnostics', 'Relay Diagnostics', 'Control Center', 'agentos', {
      keywords: ['diagnostics', 'relay', 'health', 'debug', 'sidecar'],
      subtitle: 'Relay process diagnostics and status',
    }),
    effect: (): EffectResult => ({ pushView: 'control-center', pushViewArg: 'diagnostics' }),
  },
  {
    definition: def('builtin.settings.open', 'Open Settings', 'Orbit', 'settings', {
      keywords: ['preferences', 'options', 'config', 'shortcut', 'theme'],
      subtitle: 'Configure shortcut, appearance, snippets and privacy',
    }),
    effect: async () => {
      await native.openSettings();
    },
  },
  {
    definition: def('builtin.apps.reindex', 'Reindex Applications', 'Orbit', 'refresh-cw', {
      keywords: ['rescan', 'refresh', 'apps'],
      subtitle: 'Rescan installed applications',
    }),
    effect: async () => {
      await native.reindexApplications();
    },
  },
  {
    definition: def('builtin.files.reindex', 'Rebuild File Index', 'Orbit', 'refresh-cw', {
      keywords: ['files', 'index', 'index files', 'rescan', 'search'],
      subtitle: 'Re-scan indexed folders for file search (enables indexing on first use)',
    }),
    effect: async () => {
      await native.fileIndexRebuild();
    },
  },
  {
    definition: def('builtin.commands.browse', 'Browse Commands', 'Orbit', 'list', {
      keywords: ['all commands', 'commands', 'actions', 'browse', 'list'],
      subtitle: 'See every command grouped by category',
    }),
    effect: (): EffectResult => ({ pushView: 'all-commands' }),
  },
  {
    definition: def('builtin.orbit.quit', 'Quit Orbit', 'Orbit', 'power', {
      keywords: ['exit', 'close'],
    }),
    effect: () => native.quitApp(),
  },
  webSearch(
    'builtin.search.google',
    'Search Google',
    (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    ['web', 'find'],
  ),
  webSearch(
    'builtin.search.github',
    'Search GitHub',
    (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
    ['code', 'repo'],
  ),
  webSearch(
    'builtin.search.mdn',
    'Search MDN Web Docs',
    (q) => `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(q)}`,
    ['docs', 'web', 'javascript'],
  ),
];

/** Minimal shape of native.FileIndexStatus this helper depends on. */
export interface FileIndexStatusLike {
  enabled: boolean;
}

/** Native calls needed to dispatch "Rebuild File Index" / "Index Files". */
export interface FileIndexDeps {
  status: () => Promise<FileIndexStatusLike>;
  setEnabled: (enabled: boolean) => Promise<unknown>;
  rebuild: () => Promise<unknown>;
}

/**
 * Dispatch the "Rebuild File Index" command through the same indexing service
 * Settings → Files uses: if indexing has never been enabled, enable it (which
 * also kicks off the initial scan); otherwise trigger a rebuild of the existing
 * index. Returns a human-readable status message for the caller to display.
 */
export async function triggerFileIndex(deps: FileIndexDeps): Promise<string> {
  const current = await deps.status();
  if (!current.enabled) {
    await deps.setEnabled(true);
    return 'File indexing enabled — indexing started…';
  }
  await deps.rebuild();
  return 'Rebuilding file index…';
}

/** Build a registry seeded with the built-ins and a map of effects by id. */
export function createBuiltinRegistry(): {
  registry: CommandRegistry;
  effects: Map<string, Effect>;
} {
  const registry = new CommandRegistry();
  const effects = new Map<string, Effect>();
  for (const b of BUILTINS) {
    registry.register(b.definition);
    effects.set(b.definition.id, b.effect);
  }
  return { registry, effects };
}
