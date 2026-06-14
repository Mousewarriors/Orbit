import { describe, expect, it, vi } from 'vitest';
import type { RankingSignals, SearchItem, SearchProvider } from '@orbit/shared-types';
import { runSearch } from './orchestrator.js';

function item(id: string, title: string): SearchItem {
  return {
    id,
    title,
    category: 'Test',
    source: 'command',
    primaryAction: { id: `${id}.x`, title: 'X', run: { kind: 'builtin', handler: 'noop' } },
  };
}

function signals(): RankingSignals {
  return {
    usage: new Map(),
    lastUsed: new Map(),
    pinned: new Set(),
    favourites: new Set(),
    now: Date.now(),
  };
}

function provider(
  id: string,
  items: SearchItem[],
  opts: { delay?: number; fail?: boolean } = {},
): SearchProvider {
  return {
    id,
    source: 'command',
    canHandle: () => true,
    async search(_q, signal) {
      if (opts.delay) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, opts.delay);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        });
      }
      if (opts.fail) throw new Error('boom');
      return items;
    },
  };
}

describe('runSearch', () => {
  it('merges results from multiple providers', async () => {
    const final = await runSearch(
      'a',
      [provider('p1', [item('1', 'Apple')]), provider('p2', [item('2', 'Apricot')])],
      { signals: signals() },
      () => {},
    );
    expect(final.done).toBe(true);
    expect(final.results).toHaveLength(2);
  });

  it('delivers fast providers before slow ones complete', async () => {
    const updates: number[] = [];
    await runSearch(
      'a',
      [provider('fast', [item('1', 'Apple')]), provider('slow', [item('2', 'Apricot')], { delay: 50 })],
      { signals: signals() },
      (u) => updates.push(u.results.length),
    );
    // An update should have shown the fast result (1) before both (2).
    expect(updates).toContain(1);
    expect(updates[updates.length - 1]).toBe(2);
  });

  it('isolates a failing provider and records the error', async () => {
    const final = await runSearch(
      'a',
      [provider('ok', [item('1', 'Apple')]), provider('bad', [], { fail: true })],
      { signals: signals() },
      () => {},
    );
    expect(final.results).toHaveLength(1);
    expect(final.errors.get('bad')).toBe('boom');
  });

  it('times out a slow provider without losing fast results', async () => {
    const final = await runSearch(
      'a',
      [provider('ok', [item('1', 'Apple')]), provider('hang', [item('2', 'X')], { delay: 5000 })],
      { signals: signals(), providerTimeoutMs: 20 },
      () => {},
    );
    expect(final.results).toHaveLength(1);
    expect(final.errors.get('hang')).toBe('timed out');
  });

  it('can be cancelled via signal', async () => {
    const controller = new AbortController();
    const onUpdate = vi.fn();
    const p = runSearch(
      'a',
      [provider('slow', [item('1', 'Apple')], { delay: 100 })],
      { signals: signals() },
      onUpdate,
      controller.signal,
    );
    controller.abort();
    const final = await p;
    expect(final.results).toHaveLength(0);
  });

  it('only runs providers that can handle the query', async () => {
    const gated: SearchProvider = {
      id: 'gated',
      source: 'file',
      canHandle: (q) => q.length >= 3,
      search: async () => [item('f', 'File')],
    };
    const final = await runSearch('ab', [gated], { signals: signals() }, () => {});
    expect(final.results).toHaveLength(0);
    expect(final.pendingProviders).toHaveLength(0);
  });
});
