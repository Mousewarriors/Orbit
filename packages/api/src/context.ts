import type { EffectSink } from "./effects.js";
import type { Logger } from "./logging.js";
import type { Preferences } from "./preferences.js";
import type { WireListItem } from "./protocol.js";
import type { LocalStorage } from "./storage.js";

/**
 * The context handed to a command handler for a single invocation. It bundles
 * the parsed request plus the ergonomic helpers (storage, preferences, effects,
 * logging). Everything is per-invocation; nothing is shared across runs because
 * v1 spawns a fresh process each time.
 */
export interface CommandContext {
  /** The command being invoked. */
  readonly command: string;
  /** The user's current search text (possibly empty). */
  readonly query: string;
  /** Namespaced local storage (read snapshot + buffered writes). */
  readonly storage: LocalStorage;
  /** Typed preference accessors. */
  readonly preferences: Preferences;
  /** stderr structured logger, namespaced to the command. */
  readonly log: Logger;
  /** Buffered effects + toast (copy/openUrl/openPath/showToast). */
  readonly effects: EffectSink;
}

/**
 * A command handler. Return the rows to render (use {@link List}/{@link Detail}
 * builders), or `void`/empty for an action-only command. Side effects and the
 * toast are taken from `ctx.effects`; storage writes from `ctx.storage`. Throwing
 * produces a protocol `error` response.
 */
export type CommandHandler = (
  ctx: CommandContext,
) => readonly WireListItem[] | void | Promise<readonly WireListItem[] | void>;
