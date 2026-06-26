/**
 * Application-launch journey — from a search result through the native launch
 * action. This is the runnable counterpart to the manual "press Enter to launch
 * an app" checklist: it proves the app provider emits an `open-path` action with
 * the app's launch target, that the executor dispatches it to the native
 * launcher, and that a native launch failure propagates (so App.tsx keeps the
 * launcher open and does not record usage) instead of being swallowed.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ActionDescriptor } from '@orbit/shared-types';
import { createAppProvider } from './providers.js';
import { executeAction } from './execute.js';
import * as native from './native.js';

vi.mock('./native.js', () => ({
  isTauri: () => true,
  launchPath: vi.fn(async () => {}),
  openFileInApplication: vi.fn(async () => {}),
  revealPath: vi.fn(async () => {}),
  openUrl: vi.fn(async () => {}),
  hideLauncher: vi.fn(async () => {}),
  pasteText: vi.fn(async () => {}),
  snippetRecordUse: vi.fn(async () => {}),
  extensionRun: vi.fn(async () => {}),
}));

const ctx = { query: '', effects: new Map() };
const signal = new AbortController().signal;

describe('application launch journey', () => {
  it('a classic (.lnk) app result launches its path on Enter/click', async () => {
    const provider = createAppProvider(() => [
      { id: 'app.1', name: 'Notepad++', path: 'C:\\Program Files\\Notepad++.lnk', kind: 'app' },
    ]);
    const [item] = await provider.search('note', signal);
    expect(item?.primaryAction.run).toEqual({
      kind: 'open-path',
      path: 'C:\\Program Files\\Notepad++.lnk',
    });

    const outcome = await executeAction(item!.primaryAction, ctx);
    expect(native.launchPath).toHaveBeenCalledWith('C:\\Program Files\\Notepad++.lnk');
    expect(outcome.hide).toBe(true);
  });

  it('a UWP/Store app result launches via its AppsFolder moniker', async () => {
    const moniker = 'shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App';
    const provider = createAppProvider(() => [
      { id: 'app.2', name: 'Calculator', path: moniker, kind: 'store' },
    ]);
    const [item] = await provider.search('calc', signal);
    expect(item?.primaryAction.run).toEqual({ kind: 'open-path', path: moniker });

    await executeAction(item!.primaryAction, ctx);
    expect(native.launchPath).toHaveBeenCalledWith(moniker);
  });

  it('"Copy Path" is offered as a secondary action', async () => {
    const provider = createAppProvider(() => [
      { id: 'app.3', name: 'Foo', path: 'C:\\Foo.lnk', kind: 'app' },
    ]);
    const [item] = await provider.search('foo', signal);
    const copy = item?.secondaryActions?.find((a) => a.run.kind === 'copy');
    expect(copy?.run).toEqual({ kind: 'copy', text: 'C:\\Foo.lnk' });
  });

  it('a failed launch rejects so the caller keeps the launcher open / skips usage', async () => {
    (native.launchPath as Mock).mockRejectedValueOnce(
      new Error("launch failed: 'C:\\gone.lnk' no longer exists"),
    );
    const action: ActionDescriptor = {
      id: 'x',
      title: 'Open',
      run: { kind: 'open-path', path: 'C:\\gone.lnk' },
    };
    await expect(executeAction(action, ctx)).rejects.toThrow('no longer exists');
  });

  it('an open-file-in-application action dispatches through the audited native command', async () => {
    const action: ActionDescriptor = {
      id: 'x',
      title: 'Open in Paint',
      run: {
        kind: 'open-file-in-application',
        applicationId: 'paint',
        filePath: 'C:\\docs\\map.png',
      },
    };
    const outcome = await executeAction(action, ctx);
    expect(native.openFileInApplication).toHaveBeenCalledWith('paint', 'C:\\docs\\map.png');
    expect(outcome.hide).toBe(true);
  });
});
