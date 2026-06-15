/**
 * Orbit Extension Protocol — v1 (one-shot).
 *
 * The host launches an extension with `node <main>`, writes exactly ONE JSON
 * request to the child's stdin, then reads exactly ONE JSON response from the
 * child's stdout. stdout is therefore a reserved channel: anything an extension
 * prints to stdout that is not the response will corrupt the protocol. Use
 * {@link module:logging} (which writes to stderr) for diagnostics.
 *
 * These types are the *wire* contract. The ergonomic builders in this package
 * (List, Detail, ActionPanel, …) all compile down to these shapes.
 */

/** The only protocol version currently spoken by the host. */
export const PROTOCOL_VERSION = 1 as const;

/** Wire kinds for effects that the host can broker against the manifest. */
export type EffectKind = "open-url" | "copy" | "open-path";

/**
 * A single side effect requested by the extension. The host validates each
 * effect against the manifest's declared `permissions` before performing it;
 * an undeclared effect is rejected by the host, not by this SDK.
 */
export interface Effect {
  readonly kind: EffectKind;
  /**
   * For `open-url`: the URL. For `copy`: the text to place on the clipboard.
   * For `open-path`: the filesystem path to reveal/open.
   */
  readonly value: string;
}

/** Toast severity understood by the host UI. */
export type ToastStyle = "success" | "failure" | "info";

/** A transient toast notification rendered by the host after the handler returns. */
export interface Toast {
  readonly style: ToastStyle;
  readonly title: string;
  readonly message: string | undefined;
}

/**
 * One row of a result list. `subtitle`, `icon`, `detail`, and `actions` are
 * optional and typed as `T | undefined` (never `prop?:`) to satisfy
 * `exactOptionalPropertyTypes`.
 */
export interface WireListItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | undefined;
  readonly icon: string | undefined;
  /** Markdown rendered in the host's detail pane when the row is focused. */
  readonly detail: string | undefined;
  /** Per-item actions surfaced in the host's action panel. */
  readonly actions: readonly WireAction[] | undefined;
  /** Section label used by the host to group rows under a heading. */
  readonly section: string | undefined;
}

/**
 * An action the user can trigger from the host's action panel. Because v1 is
 * one-shot, an action cannot run further extension code; it can only carry one
 * of the brokered effects. The host performs the effect directly.
 */
export interface WireAction {
  readonly title: string;
  readonly effect: Effect;
  /** Optional keyboard shortcut hint shown by the host, e.g. "cmd+c". */
  readonly shortcut: string | undefined;
}

/**
 * A markdown detail view. In v1 this is delivered as a single item carrying
 * `detail`; there is no separate render channel.
 */
export interface WireDetail {
  readonly markdown: string;
  readonly actions: readonly WireAction[] | undefined;
}

/** A namespaced storage write applied by the host after the handler returns. */
export interface StorageWrite {
  readonly key: string;
  /** `null` deletes the key; any other JSON value sets it. */
  readonly value: unknown;
}

/** The request the host writes to stdin. */
export interface InvokeRequest {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: "invoke";
  /** The command name being invoked (must match a manifest command). */
  readonly command: string;
  /** The user's current query text (may be empty). */
  readonly query: string;
  /** Snapshot of this extension's namespaced storage at invocation time. */
  readonly storage: Readonly<Record<string, unknown>>;
  /** Resolved preference values, keyed by preference name. */
  readonly preferences: Readonly<Record<string, unknown>>;
}

/** The success response the extension writes to stdout. */
export interface ResultResponse {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: "result";
  readonly items: readonly WireListItem[];
  readonly effects: readonly Effect[];
  readonly storageWrites: readonly StorageWrite[];
  readonly toast: Toast | undefined;
}

/** The error response the extension writes to stdout when a handler throws. */
export interface ErrorResponse {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: "error";
  readonly message: string;
}

/** Either response shape the host may read back. */
export type Response = ResultResponse | ErrorResponse;

/** Narrowing guard for the request the host sends. */
export function isInvokeRequest(value: unknown): value is InvokeRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record["v"] === PROTOCOL_VERSION &&
    record["type"] === "invoke" &&
    typeof record["command"] === "string" &&
    typeof record["query"] === "string" &&
    typeof record["storage"] === "object" &&
    record["storage"] !== null &&
    typeof record["preferences"] === "object" &&
    record["preferences"] !== null
  );
}
