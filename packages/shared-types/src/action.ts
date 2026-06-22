import type { IconSource } from './icon.js';
import type { PermissionId } from './permission.js';

/** A keyboard shortcut descriptor (platform-neutral). */
export interface Shortcut {
  /** Primary key, e.g. "Enter", "K", "ArrowDown", "1". */
  readonly key: string;
  readonly modifiers: ReadonlyArray<'mod' | 'shift' | 'alt' | 'ctrl' | 'meta'>;
}

/** Visual emphasis for an action in the Action Panel. */
export type ActionStyle = 'default' | 'destructive' | 'primary';

/**
 * An action is something the user can do to a result. Actions are declarative:
 * the `run` token identifies a handler registered in the command engine, so
 * actions can cross the renderer↔native and host↔extension boundaries safely
 * without passing closures.
 */
export interface ActionDescriptor {
  readonly id: string;
  readonly title: string;
  readonly icon?: IconSource;
  readonly style?: ActionStyle;
  readonly shortcut?: Shortcut;
  /** Opaque handler token resolved by the action registry. */
  readonly run: ActionToken;
  /** Permissions that must be granted before this action can execute. */
  readonly requires?: ReadonlyArray<PermissionId>;
  /** When true, the UI must confirm before executing. */
  readonly dangerous?: boolean;
  /** Optional nested submenu of actions. */
  readonly submenu?: ReadonlyArray<ActionDescriptor>;
  /** If set, action is shown disabled with this explanation. */
  readonly disabledReason?: string;
}

/**
 * A serialisable reference to an action handler plus its bound arguments.
 * `kind` namespaces the handler so the engine can route to built-ins,
 * extensions, deeplinks, etc.
 */
export type ActionToken =
  | { readonly kind: 'builtin'; readonly handler: string; readonly args?: Readonly<Record<string, unknown>> }
  | { readonly kind: 'extension'; readonly extensionId: string; readonly handler: string; readonly args?: Readonly<Record<string, unknown>> }
  | { readonly kind: 'deeplink'; readonly url: string }
  | { readonly kind: 'open-url'; readonly url: string }
  | { readonly kind: 'open-path'; readonly path: string }
  | {
      readonly kind: 'open-project-in-application';
      readonly applicationId: string;
      readonly projectPath: string;
    }
  | { readonly kind: 'reveal-path'; readonly path: string }
  | { readonly kind: 'copy'; readonly text: string }
  | {
      readonly kind: 'paste';
      readonly text: string;
      /** When set, the snippet whose usage should be recorded after pasting. */
      readonly snippetId?: string;
    }
  | { readonly kind: 'push-view'; readonly viewId: string; readonly args?: Readonly<Record<string, unknown>> }
  | { readonly kind: 'run-extension'; readonly extId: string; readonly command: string };
