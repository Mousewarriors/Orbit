import type { Preferences } from "./preferences.js";
import type { ToastStyle } from "./protocol.js";
import type { LocalStorage } from "./storage.js";
import { useContext } from "./runtime.js";

/**
 * Module-level convenience helpers (Raycast-style globals). Each resolves the
 * active command context via {@link useContext}, so they only work *inside* a
 * running handler and throw otherwise — they never silently no-op.
 */

/** Shows a toast after the handler returns. See {@link EffectSink.showToast}. */
export function showToast(style: ToastStyle, title: string, message?: string): void {
  useContext().effects.showToast(style, title, message);
}

/** Copies `text` to the clipboard (brokered `copy` effect). */
export function copyToClipboard(text: string): void {
  useContext().effects.copyToClipboard(text);
}

/** Opens `url` in the default browser (brokered `open-url` effect). */
export function openUrl(url: string): void {
  useContext().effects.openUrl(url);
}

/** Reveals/opens `path` in the OS file manager (brokered `open-path` effect). */
export function openPath(path: string): void {
  useContext().effects.openPath(path);
}

/** Returns the typed preferences for the active invocation. */
export function getPreferences(): Preferences {
  return useContext().preferences;
}

/** Returns the namespaced local storage for the active invocation. */
export function getLocalStorage(): LocalStorage {
  return useContext().storage;
}

/**
 * @experimental — NOT FAITHFULLY SUPPORTED on protocol v1.
 *
 * Raycast's `showHUD` dismisses the window and flashes an overlay. The v1
 * one-shot protocol has no HUD channel, so this is mapped to a `success`
 * **toast** with the same text. This is the closest supported primitive; the
 * window-dismiss behaviour is NOT reproduced. Prefer {@link showToast} directly
 * so the mapping is explicit in your code. This helper will be upgraded to a
 * real HUD effect if/when the protocol gains one.
 */
export function showHUD(text: string): void {
  const ctx = useContext();
  ctx.log.warn("showHUD-mapped-to-toast", {
    note: "v1 has no HUD; showing a success toast instead.",
  });
  ctx.effects.showToast("success", text);
}

/**
 * @notSupported on protocol v1.
 *
 * Live navigation (`pushView`/`popView`) requires a stateful, multi-message
 * session between host and extension. v1 is strictly request → response, so a
 * handler cannot push a view and then keep running. Calling this throws a clear
 * error rather than pretending to navigate.
 *
 * The supported alternative: model each "view" as its own command and return
 * a {@link List} whose item actions are `open-*` effects, or return a
 * {@link Detail}. See EXTENSION_SDK.md ("Deferred surface").
 */
export function pushView(): never {
  throw new Error(
    "pushView() is not supported on protocol v1 (one-shot). " +
      "Model each view as a separate command, or return a List/Detail. See EXTENSION_SDK.md.",
  );
}

/**
 * @notSupported on protocol v1. See {@link pushView}.
 */
export function popView(): never {
  throw new Error(
    "popView() is not supported on protocol v1 (one-shot). See EXTENSION_SDK.md.",
  );
}
