import { describe, expect, it, vi } from 'vitest';
import { MockProvider, type AiRequest } from '@orbit/ai-runtime';
import type { ToolRecord } from '@orbit/tool-registry';
import { runToolLoop, toolRecordToDef, type ToolCallCard } from './toolLoop.js';

function tool(partial: Partial<ToolRecord> & { name: string }): ToolRecord {
  return {
    id: `mcp:agentos:${partial.name}`,
    title: partial.name,
    description: '',
    source: 'mcp',
    serverId: 'agentos',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    risk: 'safe',
    sideEffects: ['read'],
    requiresConfirmation: false,
    approvalScopes: [],
    availability: 'available',
    health: 'healthy',
    ...partial,
  };
}

/** A toolScript that calls `name` once, then answers on the next round. */
function callOnce(name: string, args: Record<string, unknown>) {
  return (req: AiRequest) => {
    const alreadyCalled = req.messages.some((m) => m.role === 'tool');
    return alreadyCalled ? undefined : [{ name, arguments: args }];
  };
}

describe('toolRecordToDef', () => {
  it('exposes name, description and JSON-schema parameters', () => {
    const def = toolRecordToDef(tool({ name: 'search_vault', description: 'Search the vault' }));
    expect(def.name).toBe('search_vault');
    expect(def.description).toBe('Search the vault');
    expect(def.parameters).toMatchObject({ type: 'object', properties: { query: { type: 'string' } } });
  });
});

describe('runToolLoop', () => {
  it('executes a safe tool call without confirmation and feeds the result back', async () => {
    const provider = new MockProvider({
      reply: 'Your battle plan is ready.',
      toolScript: callOnce('get_battle_plan', {}),
    });
    const execute = vi.fn(async () => ({ ok: true, content: 'PLAN: ship Orbit' }));
    const confirm = vi.fn(async () => true);
    const cards: ToolCallCard[] = [];

    const result = await runToolLoop([{ role: 'user', content: 'what should I do today?' }], {
      provider,
      tools: [tool({ name: 'get_battle_plan' })],
      execute,
      confirm,
      onCard: (c) => cards.push(c),
    });

    expect(result.content).toBe('Your battle plan is ready.');
    expect(result.executed).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled(); // safe tool
    expect(cards.at(-1)?.status).toBe('done');
    expect(cards.at(-1)?.result).toBe('PLAN: ship Orbit');
  });

  it('requires confirmation for a consequential tool and skips it when denied', async () => {
    const provider = new MockProvider({
      reply: 'I did not save anything.',
      toolScript: callOnce('save_memory', { title: 'x', summary: 'y' }),
    });
    const execute = vi.fn(async () => ({ ok: true, content: 'saved' }));
    const confirm = vi.fn(async () => false); // user denies
    const cards: ToolCallCard[] = [];

    const result = await runToolLoop([{ role: 'user', content: 'remember this' }], {
      provider,
      tools: [tool({ name: 'save_memory', risk: 'medium', requiresConfirmation: true, sideEffects: ['write-file'] })],
      execute,
      confirm,
      onCard: (c) => cards.push(c),
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(result.executed).toBe(0);
    expect(cards.at(-1)?.status).toBe('denied');
    expect(result.content).toBe('I did not save anything.');
  });

  it('refuses an unknown tool name without inventing a capability', async () => {
    const provider = new MockProvider({
      reply: 'Sorry, I cannot do that.',
      toolScript: callOnce('rm_rf_everything', {}),
    });
    const execute = vi.fn();
    const cards: ToolCallCard[] = [];

    const result = await runToolLoop([{ role: 'user', content: 'delete everything' }], {
      provider,
      tools: [tool({ name: 'get_battle_plan' })],
      execute,
      confirm: async () => true,
      onCard: (c) => cards.push(c),
    });

    expect(execute).not.toHaveBeenCalled();
    expect(cards.at(-1)?.status).toBe('unknown-tool');
    expect(result.content).toBe('Sorry, I cannot do that.');
  });

  it('stops at the round budget and still returns a final answer', async () => {
    // A pathological model that always calls a tool: the loop must terminate.
    const provider = new MockProvider({
      reply: 'Final summary.',
      toolScript: () => [{ name: 'get_battle_plan', arguments: {} }],
    });
    const result = await runToolLoop([{ role: 'user', content: 'loop forever' }], {
      provider,
      tools: [tool({ name: 'get_battle_plan' })],
      execute: async () => ({ ok: true, content: 'again' }),
      confirm: async () => true,
      onCard: () => {},
      maxRounds: 2,
    });
    expect(result.content).toBe('Final summary.');
    expect(result.executed).toBe(2);
  });
});
