/**
 * `@orbit/api` — the Orbit Extension SDK.
 *
 * A typed, ergonomic layer over the v1 one-shot extension protocol. Import this
 * from an extension `index.mjs` exactly like `@orbit/extension-sdk`:
 *
 * ```js
 * import { defineExtension, List, Action, showToast } from "@orbit/api";
 *
 * const ext = defineExtension({
 *   commands: {
 *     search: (ctx) => List(
 *       List.Item({ title: "Hello", actions: [Action.CopyToClipboard("hi")] }),
 *     ),
 *   },
 * });
 *
 * await ext.run();
 * ```
 *
 * See docs/architecture/EXTENSION_SDK.md for the full surface, what protocol v1
 * supports vs. defers, and a first-extension walkthrough.
 */

// Protocol (wire contract).
export {
  PROTOCOL_VERSION,
  isInvokeRequest,
} from "./protocol.js";
export type {
  EffectKind,
  Effect,
  ToastStyle,
  Toast,
  WireListItem,
  WireAction,
  WireDetail,
  StorageWrite,
  InvokeRequest,
  ResultResponse,
  ErrorResponse,
  Response,
} from "./protocol.js";

// Runtime + registration.
export { defineExtension, useContext } from "./runtime.js";
export type {
  Extension,
  DefineExtensionOptions,
  CommandRegistration,
  RunIo,
} from "./runtime.js";

// Handler context.
export type { CommandContext, CommandHandler } from "./context.js";

// UI builders.
export { List, Detail, ActionPanel, Action } from "./ui.js";
export type {
  ListBuilder,
  ListItemProps,
  ListSectionProps,
  DetailProps,
  ActionSpec,
} from "./ui.js";

// Module-level helpers.
export {
  showToast,
  copyToClipboard,
  openUrl,
  openPath,
  getPreferences,
  getLocalStorage,
  showHUD,
  pushView,
  popView,
} from "./helpers.js";

// Effects / toast.
export { createEffectSink } from "./effects.js";
export type { EffectSink } from "./effects.js";

// Preferences.
export { createPreferences } from "./preferences.js";
export type { Preferences } from "./preferences.js";

// Storage.
export { createStorage } from "./storage.js";
export type { LocalStorage } from "./storage.js";

// Logging.
export { createLogger } from "./logging.js";
export type { Logger, LogLevel, LogRecord, LoggerOptions } from "./logging.js";

// Manifest + validation.
export type {
  Permission,
  PreferenceType,
  PreferenceSpec,
  CommandMode,
  CommandSpec,
  ExtensionManifest,
} from "./manifest.js";
export {
  validateManifest,
  listCommandNames,
  listPreferenceNames,
} from "./validation.js";
export type { ValidationIssue, ValidationResult } from "./validation.js";
