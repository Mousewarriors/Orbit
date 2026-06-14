import type { IconSource } from './icon.js';
import type { PermissionRequirement } from './permission.js';

/** Where a command originates. */
export type CommandSource =
  | { readonly kind: 'builtin' }
  | { readonly kind: 'extension'; readonly extensionId: string }
  | { readonly kind: 'user' }
  | { readonly kind: 'agentos' };

/** The render mode a command produces when invoked. */
export type CommandMode =
  | 'no-view'
  | 'list'
  | 'grid'
  | 'detail'
  | 'form'
  | 'menu-bar'
  | 'background'
  | 'interval'
  | 'ai-tool';

/**
 * A command is an invocable capability surfaced in Root Search. Built-in
 * commands, extension commands, user scripts and AI commands all conform to it.
 */
export interface CommandDefinition {
  /** Stable, globally-unique id, e.g. "builtin.window.left-half". */
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: IconSource;
  readonly mode: CommandMode;
  readonly source: CommandSource;
  readonly category: string;
  /** Free-form search keywords (singular/plural, abbreviations). */
  readonly keywords?: ReadonlyArray<string>;
  /** Synonyms that should match this command even if not in the title. */
  readonly synonyms?: ReadonlyArray<string>;
  readonly permissions?: ReadonlyArray<PermissionRequirement>;
  /** Whether the command is currently enabled by the user. */
  readonly enabled: boolean;
}

/** User-assigned customisations layered over a command. */
export interface CommandCustomisation {
  readonly commandId: string;
  readonly alias?: string;
  readonly hotkey?: string;
  readonly favourite?: boolean;
  readonly pinned?: boolean;
}

/** Locally-tracked usage statistics powering recency/frequency ranking. */
export interface CommandUsage {
  readonly commandId: string;
  readonly useCount: number;
  /** Epoch milliseconds of the most recent use. */
  readonly lastUsedAt: number;
}
