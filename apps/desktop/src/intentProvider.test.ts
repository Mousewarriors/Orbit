import { describe, expect, it, vi } from 'vitest';
import { createIntentProvider, type IntentProviderDeps } from './intentProvider.js';
import { decodeControlCenterArg } from './controlCenterState.js';

const APPS = [
  { id: 'calc', name: 'Calculator', path: 'C:\\Windows\\calc.exe' },
  { id: 'chrome', name: 'Google Chrome', path: 'C:\\chrome.exe' },
];

const PROJECTS = [
  { path: 'C:\\Users\\me\\Raycast Clone', name: 'Orbit' },
  { path: 'C:\\code\\website', name: null },
];

function makeDeps(over: Partial<IntentProviderDeps> = {}): IntentProviderDeps {
  return {
    getApps: () => APPS,
    getProjects: () => PROJECTS,
    fileSearch: async () => [],
    noteSearch: async () => [],
    webSearchUrl: (q) => `https://example.test/?q=${encodeURIComponent(q)}`,
    ...over,
  };
}

const signal = new AbortController().signal;

async function run(query: string, deps = makeDeps()) {
  return createIntentProvider(deps).search(query, signal);
}

describe('intent provider — fall-through', () => {
  it('returns nothing for a non-request (entity name)', async () => {
    expect(await run('Calculator')).toEqual([]);
    expect(await run('Orbit')).toEqual([]);
  });
});

describe('intent provider — applications', () => {
  it('"Open Calculator" launches the resolved app', async () => {
    const items = await run('Open Calculator');
    expect(items[0]!.primaryAction.run).toEqual({
      kind: 'open-path',
      path: 'C:\\Windows\\calc.exe',
    });
    expect(items[0]!.title).toBe('Open Calculator');
  });

  it('no installed match yields an honest "no match" item', async () => {
    const items = await run('open Photoshop');
    expect(items).toHaveLength(1);
    expect(items[0]!.subtitle).toMatch(/no installed application/i);
  });
});

describe('intent provider — control center navigation', () => {
  it('"continue Orbit" deep-links into Launch with the resolved project', async () => {
    const items = await run('continue Orbit');
    const run0 = items[0]!.primaryAction.run;
    expect(run0.kind).toBe('push-view');
    if (run0.kind === 'push-view') {
      expect(run0.viewId).toBe('control-center');
      const arg = decodeControlCenterArg(String(run0.args!['id']));
      expect(arg.tab).toBe('launch');
      expect(arg.project).toBe('C:\\Users\\me\\Raycast Clone');
    }
  });

  it('"show failed sessions" carries the status filter', async () => {
    const items = await run('show failed sessions');
    const run0 = items[0]!.primaryAction.run;
    if (run0.kind === 'push-view') {
      const arg = decodeControlCenterArg(String(run0.args!['id']));
      expect(arg.tab).toBe('sessions');
      expect(arg.sessionStatus).toBe('failed');
    } else {
      throw new Error('expected push-view');
    }
  });

  it('an unresolved project falls back to opening Projects (honest)', async () => {
    const items = await run('continue Nonexistentproject');
    expect(items[0]!.subtitle).toMatch(/no known project/i);
    const run0 = items[0]!.primaryAction.run;
    if (run0.kind === 'push-view') {
      expect(decodeControlCenterArg(String(run0.args!['id'])).tab).toBe('projects');
    } else {
      throw new Error('expected push-view');
    }
  });

  it('"open the Orbit folder" reveals the project path', async () => {
    const items = await run('open the Orbit folder');
    expect(items[0]!.primaryAction.run).toEqual({
      kind: 'reveal-path',
      path: 'C:\\Users\\me\\Raycast Clone',
    });
  });
});

describe('intent provider — direct + find', () => {
  it('"restart relay" runs the existing narrow Relay command', async () => {
    const items = await run('restart relay');
    expect(items[0]!.primaryAction.run).toEqual({
      kind: 'builtin',
      handler: 'run-command',
      args: { commandId: 'builtin.cc.restart' },
    });
  });

  it('"find the document that mentioned Leonard" searches files for "leonard"', async () => {
    const fileSearch = vi.fn(async () => [
      { path: 'C:\\docs\\leonard.txt', name: 'leonard.txt', parent: 'C:\\docs', kind: 'file' },
    ]);
    const items = await run('find the document that mentioned Leonard', makeDeps({ fileSearch }));
    expect(fileSearch).toHaveBeenCalledWith('leonard', 20);
    expect(items[0]!.title).toBe('leonard.txt');
    expect(items[0]!.primaryAction.run).toEqual({
      kind: 'open-path',
      path: 'C:\\docs\\leonard.txt',
    });
  });

  it('find notes queries the note index', async () => {
    const noteSearch = vi.fn(async () => [{ id: 'n1', title: 'Onboarding', body: 'hi' }]);
    const items = await run('find notes about onboarding', makeDeps({ noteSearch }));
    expect(noteSearch).toHaveBeenCalledWith('onboarding', 15);
    expect(items[0]!.title).toBe('Onboarding');
  });
});

describe('intent provider — AI intents are honest', () => {
  it('summarise clipboard offers a web fallback, not a fake answer', async () => {
    const items = await run('summarise the clipboard');
    expect(items[0]!.subtitle).toMatch(/not available yet/i);
    expect(items[0]!.primaryAction.run.kind).toBe('open-url');
  });
});
