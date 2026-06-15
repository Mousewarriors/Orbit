/**
 * Extension manifest types (the `manifest.json` shape the host reads).
 *
 * These are the single source of truth shared by the SDK and the `orbit` CLI
 * validator. They mirror the permission/command rules the host enforces.
 */

/** Permission a command may declare; gates the matching effect kind. */
export type Permission = "open-url" | "copy" | "open-path";

/** Preference kinds the host can render in Settings. */
export type PreferenceType = "string" | "boolean" | "number" | "password";

/** A user-configurable preference declared in the manifest. */
export interface PreferenceSpec {
  readonly name: string;
  readonly type: PreferenceType;
  readonly title: string;
  readonly description?: string | undefined;
  readonly required?: boolean | undefined;
  readonly default?: string | number | boolean | undefined;
}

/** The mode a command renders in (informs how the host treats the result). */
export type CommandMode = "no-view" | "list" | "detail";

/** A command declared by the extension. */
export interface CommandSpec {
  readonly name: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly mode: CommandMode;
  /** Effect kinds this command is allowed to request. */
  readonly permissions?: readonly Permission[] | undefined;
}

/** The full extension manifest. */
export interface ExtensionManifest {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly version: string;
  readonly icon?: string | undefined;
  /** Relative path to the entry module the host spawns with `node`. */
  readonly main: string;
  readonly commands: readonly CommandSpec[];
  readonly preferences?: readonly PreferenceSpec[] | undefined;
}
