import { describe, expect, it, vi } from 'vitest';
import type {
  ActionDescriptor,
  RankingSignals,
  RankedItem,
  SearchItem,
  SearchProvider,
} from '@orbit/shared-types';
import {
  runExternalOrbitCommand,
  startOrbitCommandBridge,
  type OrbitCommandBridgeDeps,
} from './orbitCommand.js';
import { createIntentProvider } from './intentProvider.js';
import { createAgentProvider } from './agent/agentProvider.js';
import { decodeQuickAiArg } from './ai/quickAi.js';
import { decodeControlCenterArg } from './controlCenterState.js';
import type { OrbitCommandPayload } from './native.js';

function payload(query: string): OrbitCommandPayload {
  return { query, source: 'argv', receivedAtMs: 1 };
}

function signals(): RankingSignals {
  return {
    usage: new Map(),
    lastUsed: new Map(),
    pinned: new Set(),
    favourites: new Set(),
    now: 1,
  };
}

function item(action: ActionDescriptor, keywords: string[]): SearchItem {
  return {
    id: 'external.result',
    title: action.title,
    keywords,
    category: 'Files',
    source: 'file',
    confidence: 1,
    primaryAction: action,
  };
}

function provider(items: ReadonlyArray<SearchItem>): SearchProvider {
  return {
    id: 'test',
    source: 'file',
    canHandle: () => true,
    search: async () => items,
  };
}

describe('Orbit command bridge', () => {
  it('drains startup commands and event-signalled commands from native exactly once', async () => {
    let pending = [payload('find kht accounts')];
    let listening = false;
    let listener: (payload: OrbitCommandPayload) => void = () => {
      throw new Error('listener not registered');
    };
    const handled: string[] = [];
    const deps: OrbitCommandBridgeDeps = {
      isTauri: () => true,
      takePendingOrbitCommands: async () => {
        const batch = pending;
        pending = [];
        return batch;
      },
      onOrbitCommandAvailable: async (handler) => {
        listener = handler;
        listening = true;
        return () => {
          listening = false;
        };
      },
    };

    const stop = await startOrbitCommandBridge(deps, (command) => {
      handled.push(command.query);
    });

    expect(handled).toEqual(['find kht accounts']);

    pending = [payload('load map in paint')];
    expect(listening).toBe(true);
    listener(payload('wake-up only'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handled).toEqual(['find kht accounts', 'load map in paint']);
    stop();
  });
});

describe('external Orbit command runner', () => {
  it('runs the top ranked result through the supplied executor with the original query', async () => {
    const action: ActionDescriptor = {
      id: 'open',
      title: 'Open in Paint',
      run: {
        kind: 'open-file-in-application',
        applicationId: 'paint',
        filePath: 'C:\\docs\\map.png',
      },
    };
    const execute = vi.fn(async () => ({ hide: true }));

    const result = await runExternalOrbitCommand(payload('load up map in paint'), {
      providers: [provider([item(action, ['load up map in paint'])])],
      signals: signals(),
      execute,
      requestConfirmation: vi.fn(),
    });

    expect(result.status).toBe('executed');
    expect(result.itemId).toBe('external.result');
    expect(execute).toHaveBeenCalledWith(expect.anything(), 'load up map in paint');
  });

  it('does not execute dangerous actions; it requests the normal confirmation gate', async () => {
    const action: ActionDescriptor = {
      id: 'restart',
      title: 'Restart Relay',
      dangerous: true,
      run: { kind: 'builtin', handler: 'run-command', args: { commandId: 'builtin.cc.restart' } },
    };
    const execute = vi.fn(async () => ({ hide: true }));
    const requestConfirmation = vi.fn();

    const result = await runExternalOrbitCommand(payload('restart relay'), {
      providers: [provider([item(action, ['restart relay'])])],
      signals: signals(),
      execute,
      requestConfirmation,
    });

    expect(result.status).toBe('needs-confirmation');
    expect(execute).not.toHaveBeenCalled();
    expect(requestConfirmation).toHaveBeenCalledWith(expect.anything());
  });

  it('reports no-results honestly when Root Search cannot resolve the command', async () => {
    const result = await runExternalOrbitCommand(payload('open missing thing'), {
      providers: [provider([])],
      signals: signals(),
      execute: vi.fn(),
      requestConfirmation: vi.fn(),
    });

    expect(result.status).toBe('no-results');
  });

  it('does not execute unavailable or disabled results from external commands', async () => {
    const execute = vi.fn(async () => ({ hide: true }));
    const result = await runExternalOrbitCommand(payload('open missing thing'), {
      providers: [
        provider([
          {
            ...item(
              {
                id: 'noop',
                title: 'No match',
                disabledReason: 'No matching item.',
                run: { kind: 'copy', text: 'missing' },
              },
              ['open missing thing'],
            ),
            availability: 'unavailable',
          },
        ]),
      ],
      signals: signals(),
      execute,
      requestConfirmation: vi.fn(),
    });

    expect(result.status).toBe('not-actionable');
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not report PowerShell unknown app fallbacks as successful execution', async () => {
    const execute = vi.fn(async () => ({ hide: true }));
    const result = await runExternalOrbitCommand(payload('open Photoshop'), {
      providers: [
        createIntentProvider({
          getApps: () => [],
          getProjects: () => [],
          fileSearch: async () => [],
          noteSearch: async () => [],
        }),
      ],
      signals: signals(),
      execute,
      requestConfirmation: vi.fn(),
    });

    expect(result.status).toBe('not-actionable');
    expect(result.itemId).toBe('intent.open-application.none');
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not execute a missing file-in-app fallback from PowerShell', async () => {
    const execute = vi.fn(async () => ({ hide: true }));
    const result = await runExternalOrbitCommand(
      payload('load up the convention attendant positions map in paint'),
      {
        providers: [
          createIntentProvider({
            getApps: () => [
              {
                id: 'paint',
                name: 'Paint',
                path: 'C:\\Windows\\System32\\mspaint.exe',
                kind: 'app',
              },
            ],
            getProjects: () => [],
            fileSearch: async () => [],
            noteSearch: async () => [],
          }),
        ],
        signals: signals(),
        execute,
        requestConfirmation: vi.fn(),
      },
    );

    expect(result.status).toBe('not-actionable');
    expect(result.itemId).toBe('intent.open-file-in-application.no-file');
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not execute unresolved project/app fallbacks from PowerShell', async () => {
    const execute = vi.fn(async () => ({ hide: true }));
    const result = await runExternalOrbitCommand(
      payload('open MissingProject in Visual Studio Code'),
      {
        providers: [
          createIntentProvider({
            getApps: () => [
              {
                id: 'vscode',
                name: 'Visual Studio Code',
                path: 'C:\\apps\\code.exe',
                kind: 'app',
              },
            ],
            getProjects: () => [],
            fileSearch: async () => [],
            noteSearch: async () => [],
          }),
        ],
        signals: signals(),
        execute,
        requestConfirmation: vi.fn(),
      },
    );

    expect(result.status).toBe('not-actionable');
    expect(result.itemId).toBe('intent.open-project-in-application.unresolved');
    expect(execute).not.toHaveBeenCalled();
  });

  it('proves a PowerShell sentence can open the convention positions map in Paint', async () => {
    const executed: RankedItem[] = [];
    const execute = vi.fn(async (ranked: RankedItem) => {
      executed.push(ranked);
      return { hide: true };
    });
    const result = await runExternalOrbitCommand(
      payload('load up the convention attendant positions map in paint'),
      {
        providers: [
          createIntentProvider({
            getApps: () => [
              {
                id: 'paint',
                name: 'Paint',
                path: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\mspaint.exe',
                kind: 'app',
              },
            ],
            getProjects: () => [],
            fileSearch: async (query, limit) => {
              expect(query).toBe('convention attendant positions map');
              expect(limit).toBe(10);
              return [
                {
                  path: 'C:\\docs\\Convention Attendant Positions Map.png',
                  name: 'Convention Attendant Positions Map.png',
                  parent: 'C:\\docs',
                  kind: 'file',
                },
              ];
            },
            noteSearch: async () => [],
          }),
        ],
        signals: signals(),
        execute,
        requestConfirmation: vi.fn(),
      },
    );

    expect(result.status).toBe('executed');
    expect(executed[0]?.item.primaryAction.run).toEqual({
      kind: 'open-file-in-application',
      applicationId: 'paint',
      filePath: 'C:\\docs\\Convention Attendant Positions Map.png',
    });
  });

  it('proves a PowerShell sentence can find KHT congregation accounts instructions', async () => {
    const executed: RankedItem[] = [];
    const execute = vi.fn(async (ranked: RankedItem) => {
      executed.push(ranked);
      return { hide: true };
    });
    const result = await runExternalOrbitCommand(
      payload('find the congregation accounts instructions for kht'),
      {
        providers: [
          createIntentProvider({
            getApps: () => [],
            getProjects: () => [],
            fileSearch: async (query, limit) => {
              expect(query).toBe('congregation accounts instructions kht');
              expect(limit).toBe(20);
              return [
                {
                  path: 'C:\\docs\\KHT Congregation Accounts Instructions.pdf',
                  name: 'KHT Congregation Accounts Instructions.pdf',
                  parent: 'C:\\docs',
                  kind: 'file',
                },
              ];
            },
            noteSearch: async () => [],
          }),
        ],
        signals: signals(),
        execute,
        requestConfirmation: vi.fn(),
      },
    );

    expect(result.status).toBe('executed');
    expect(executed[0]?.item.primaryAction.run).toEqual({
      kind: 'open-path',
      path: 'C:\\docs\\KHT Congregation Accounts Instructions.pdf',
    });
  });

  it('proves a PowerShell sentence can open AgentOS launch for an Orbit agent', async () => {
    const executed: RankedItem[] = [];
    const result = await runExternalOrbitCommand(payload('launch an agent on Orbit'), {
      providers: [
        createIntentProvider({
          getApps: () => [],
          getProjects: () => [{ path: 'C:\\Users\\me\\Raycast Clone', name: 'Orbit' }],
          fileSearch: async () => [],
          noteSearch: async () => [],
        }),
      ],
      signals: signals(),
      execute: async (ranked) => {
        executed.push(ranked);
        return { hide: false, pushView: 'control-center' };
      },
      requestConfirmation: vi.fn(),
    });

    expect(result.status).toBe('executed');
    const run = executed[0]?.item.primaryAction.run;
    expect(run?.kind).toBe('push-view');
    if (run?.kind !== 'push-view') throw new Error('expected push-view');
    expect(run.viewId).toBe('control-center');
    const arg = decodeControlCenterArg(String(run.args?.['id']));
    expect(arg.tab).toBe('launch');
    expect(arg.project).toBe('C:\\Users\\me\\Raycast Clone');
    expect(arg.agentPreference).toBe('best');
  });

  it('proves a PowerShell sentence can open Orbit Agent prefilled with an agent mission', async () => {
    const executed: RankedItem[] = [];
    const result = await runExternalOrbitCommand(payload('agent: launch an agent on Orbit'), {
      providers: [createAgentProvider()],
      signals: signals(),
      execute: async (ranked) => {
        executed.push(ranked);
        return { hide: false, pushView: 'orbit-agent' };
      },
      requestConfirmation: vi.fn(),
    });

    expect(result.status).toBe('executed');
    const run = executed[0]?.item.primaryAction.run;
    expect(run?.kind).toBe('push-view');
    if (run?.kind !== 'push-view') throw new Error('expected push-view');
    expect(run.viewId).toBe('orbit-agent');
    expect(decodeQuickAiArg(String(run.args?.['id'])).prompt).toBe('launch an agent on Orbit');
  });
});
