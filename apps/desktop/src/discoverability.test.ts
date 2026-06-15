/**
 * Root Search discoverability smoke test.
 *
 * Runs the *real* desktop providers (built-in command registry, the instant
 * developer-tools provider, and the extension provider) through the real search
 * orchestrator for each query the desktop GUI must support, asserting the
 * expected result is actually produced. This is the runnable counterpart to the
 * manual GUI checklist: it proves the providers are wired up and matchable,
 * independent of whether a window is on screen.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RankingSignals, SearchItem, SearchProvider } from '@orbit/shared-types';
import { runSearch } from '@orbit/search-engine';
import { createCommandProvider } from '@orbit/command-model';
import { createBuiltinRegistry } from './builtins.js';
import {
  createCalculatorProvider,
  createExtensionProvider,
  createToolsProvider,
} from './providers.js';
import type { ExtCommandInfo } from './native.js';

// builtins.ts → native.ts imports the Tauri API; stub it so the module graph
// loads under Node. The providers exercised here never call invoke().
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => undefined }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'launcher' }) }));

// The extension provider is gated to the Tauri shell; pretend we're inside it so
// loaded-extension commands participate in search (their data is mocked below).
beforeAll(() => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

function signals(): RankingSignals {
  return {
    usage: new Map(),
    lastUsed: new Map(),
    pinned: new Set(),
    favourites: new Set(),
    now: Date.now(),
  };
}

// Mirrors the two sample extensions shipped in extensions/examples once loaded.
const EXT_COMMANDS: ExtCommandInfo[] = [
  {
    ext_id: 'developer-utilities',
    ext_title: 'Developer Utilities',
    command: 'random-uuid',
    title: 'Generate UUID',
    mode: 'no-view',
    description: 'Generate a UUID v4 and copy it to the clipboard',
    keywords: ['uuid', 'guid', 'id'],
  },
  {
    ext_id: 'agentos-status',
    ext_title: 'AgentOS Status',
    command: 'agent-status',
    title: 'AgentOS Status',
    mode: 'list',
    description: 'List agents and their current status',
    keywords: ['agentos', 'agent', 'status'],
  },
  {
    ext_id: 'agentos-controller',
    ext_title: 'AgentOS Controller',
    command: 'list-agents',
    title: 'AgentOS Agents',
    mode: 'list',
    description: 'List agents with status, current task, last activity, project and health',
    keywords: ['agentos', 'agent', 'agents', 'status', 'health', 'agent studio', 'controller'],
  },
  {
    ext_id: 'agentos-controller',
    ext_title: 'AgentOS Controller',
    command: 'pending-approvals',
    title: 'AgentOS Pending Approvals',
    mode: 'list',
    description: 'Show actions awaiting human approval (observational; approve elsewhere)',
    keywords: ['agentos', 'approval', 'approvals', 'pending', 'review', 'agent studio'],
  },
];

function buildProviders(): SearchProvider[] {
  const { registry } = createBuiltinRegistry();
  return [
    createCommandProvider(registry),
    createToolsProvider(),
    createExtensionProvider(() => EXT_COMMANDS),
    createCalculatorProvider(),
  ];
}

async function search(query: string): Promise<SearchItem[]> {
  const final = await runSearch(query, buildProviders(), { signals: signals() }, () => {});
  return final.results.map((r) => r.item);
}

describe('Root Search discoverability', () => {
  it('finds the Settings command', async () => {
    expect((await search('Settings')).map((i) => i.id)).toContain('builtin.settings.open');
  });

  it('finds the Notes command', async () => {
    expect((await search('Notes')).map((i) => i.id)).toContain('builtin.notes.manage');
  });

  it('finds the Quicklinks command', async () => {
    expect((await search('Quicklinks')).map((i) => i.id)).toContain('builtin.quicklinks.manage');
  });

  it('finds a File Search entry point', async () => {
    expect((await search('File Search')).map((i) => i.id)).toContain('builtin.files.reindex');
  });

  it('finds "Rebuild File Index" when typing "Index Files"', async () => {
    expect((await search('Index Files')).map((i) => i.id)).toContain('builtin.files.reindex');
  });

  it('generates a UUID (uuid)', async () => {
    const uuid = (await search('uuid')).find((i) => i.id === 'tool.uuid');
    expect(uuid).toBeDefined();
    expect(uuid?.title).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('generates a 24-character password (password 24)', async () => {
    const pw = (await search('password 24')).find((i) => i.id === 'tool.password');
    expect(pw).toBeDefined();
    expect(pw?.title).toHaveLength(24);
  });

  it('converts a hex colour (#ff0000)', async () => {
    expect((await search('#ff0000')).map((i) => i.id)).toContain('tool.color.hex');
  });

  it('formats JSON (json {"hello":"world"})', async () => {
    expect((await search('json {"hello":"world"}')).map((i) => i.id)).toContain('tool.json');
  });

  it('finds the Developer Utilities extension command when loaded', async () => {
    expect((await search('Developer Utilities')).map((i) => i.title)).toContain('Generate UUID');
  });

  it('finds the AgentOS Status extension command when loaded', async () => {
    expect((await search('AgentOS Status')).map((i) => i.title)).toContain('AgentOS Status');
  });

  it('finds the AgentOS Controller agents command when loaded', async () => {
    expect((await search('AgentOS Agents')).map((i) => i.title)).toContain('AgentOS Agents');
  });

  it('finds the AgentOS Controller via the "agent studio" keyword', async () => {
    expect((await search('agent studio')).map((i) => i.title)).toContain('AgentOS Agents');
  });

  it('finds AgentOS pending approvals when loaded', async () => {
    expect((await search('approvals')).map((i) => i.title)).toContain('AgentOS Pending Approvals');
  });

  it.each([
    ['125 * 4', '500'],
    ['10 + 15', '25'],
    ['144 / 12', '12'],
    ['(25 + 5) * 3', '90'],
  ])('shows the inline calculator result for "%s"', async (query, expected) => {
    const calc = (await search(query)).find((i) => i.id === 'calc.result');
    expect(calc?.title).toBe(expected);
  });
});

describe('Root Search resilience', () => {
  it('one failing optional provider does not suppress results from the others', async () => {
    const boom: SearchProvider = {
      id: 'boom',
      source: 'extension',
      canHandle: () => true,
      search: async () => {
        throw new Error('provider exploded');
      },
    };
    const { registry } = createBuiltinRegistry();
    const final = await runSearch(
      'Settings',
      [boom, createCommandProvider(registry)],
      { signals: signals() },
      () => {},
    );
    expect(final.results.map((r) => r.item.id)).toContain('builtin.settings.open');
    expect(final.errors.get('boom')).toBe('provider exploded');
  });
});
