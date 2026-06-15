import type { Effect, Toast, ToastStyle } from "./protocol.js";

/**
 * Buffers the side effects and toast a handler requests. The runtime drains
 * this after the handler returns and folds the result into the response.
 *
 * Only the three protocol-supported effect kinds are exposed
 * (`open-url`, `copy`, `open-path`). There is intentionally no API for any
 * other kind — the host would reject it.
 */
export interface EffectSink {
  /** Requests the host copy `text` to the clipboard. */
  copyToClipboard(text: string): void;
  /** Requests the host open `url` in the default browser. */
  openUrl(url: string): void;
  /** Requests the host reveal/open `path` in the OS file manager. */
  openPath(path: string): void;
  /**
   * Shows a toast after the handler returns. Calling this more than once keeps
   * the LAST toast (the protocol carries a single `toast`); earlier calls are
   * overwritten. A warning is logged when this happens via the runtime.
   */
  showToast(style: ToastStyle, title: string, message?: string): void;
  /** Returns the buffered effects. Internal use by the runtime. */
  collectEffects(): readonly Effect[];
  /** Returns the buffered toast, if any. Internal use by the runtime. */
  collectToast(): Toast | undefined;
  /** Whether {@link showToast} was called more than once. */
  toastWasOverwritten(): boolean;
}

class BufferedEffects implements EffectSink {
  readonly #effects: Effect[] = [];
  #toast: Toast | undefined = undefined;
  #toastCalls = 0;

  copyToClipboard(text: string): void {
    this.#effects.push({ kind: "copy", value: text });
  }

  openUrl(url: string): void {
    this.#effects.push({ kind: "open-url", value: url });
  }

  openPath(path: string): void {
    this.#effects.push({ kind: "open-path", value: path });
  }

  showToast(style: ToastStyle, title: string, message?: string): void {
    this.#toastCalls += 1;
    this.#toast = { style, title, message: message ?? undefined };
  }

  collectEffects(): readonly Effect[] {
    return this.#effects;
  }

  collectToast(): Toast | undefined {
    return this.#toast;
  }

  toastWasOverwritten(): boolean {
    return this.#toastCalls > 1;
  }
}

/** Creates an empty effect sink for a single handler invocation. */
export function createEffectSink(): EffectSink {
  return new BufferedEffects();
}
