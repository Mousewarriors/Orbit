/**
 * The action executor — the single place that turns a declarative ActionToken
 * into a real effect. Keeping this centralised means every result, regardless
 * of provider, executes through one audited switch.
 */
import type { ActionDescriptor } from '@orbit/shared-types';
import * as native from './native.js';

/** What an effect may ask the launcher to do after running. */
export interface EffectResult {
  /** Push a named view onto the navigation stack instead of closing. */
  readonly pushView?: string;
  /** Keep the launcher open (default is to hide after a successful action). */
  readonly keepOpen?: boolean;
}

export interface ExecuteContext {
  readonly query: string;
  readonly effects: ReadonlyMap<
    string,
    (query: string) => Promise<EffectResult | void> | EffectResult | void
  >;
}

export interface ExecuteOutcome {
  readonly hide: boolean;
  readonly pushView?: string;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

/** Execute an action and report what the launcher should do next. */
export async function executeAction(
  action: ActionDescriptor,
  ctx: ExecuteContext,
): Promise<ExecuteOutcome> {
  const run = action.run;
  switch (run.kind) {
    case 'open-path':
      await native.launchPath(run.path);
      return { hide: true };
    case 'open-url':
      await native.openUrl(run.url);
      return { hide: true };
    case 'copy':
      await copyText(run.text);
      return { hide: true };
    case 'paste':
      // Real paste injects keystrokes into the previously-focused window. Hide
      // the launcher first so focus returns there, then type. Outside Tauri
      // (browser preview) fall back to copying to the clipboard.
      if (native.isTauri()) {
        await native.hideLauncher().catch(() => {});
        await native.pasteText(run.text);
        if (run.snippetId) void native.snippetRecordUse(run.snippetId).catch(() => {});
      } else {
        await copyText(run.text);
      }
      return { hide: true };
    case 'push-view':
      return { hide: false, pushView: run.viewId };
    case 'builtin':
      if (run.handler === 'run-command') {
        const id = run.args?.['commandId'];
        if (typeof id === 'string') {
          const fx = ctx.effects.get(id);
          if (fx) {
            const result = await fx(ctx.query);
            if (result?.pushView) return { hide: false, pushView: result.pushView };
            if (result?.keepOpen) return { hide: false };
          }
        }
      }
      return { hide: true };
    default:
      return { hide: false };
  }
}
