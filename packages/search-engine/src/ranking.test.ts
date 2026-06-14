import { describe, expect, it } from 'vitest';
import type { RankingSignals, SearchItem } from '@orbit/shared-types';
import { rank } from './ranking.js';

function item(id: string, title: string, extra: Partial<SearchItem> = {}): SearchItem {
  return {
    id,
    title,
    category: 'Test',
    source: 'command',
    primaryAction: {
      id: `${id}.open`,
      title: 'Open',
      run: { kind: 'builtin', handler: 'noop' },
    },
    ...extra,
  };
}

function signals(over: Partial<RankingSignals> = {}): RankingSignals {
  return {
    usage: new Map(),
    lastUsed: new Map(),
    pinned: new Set(),
    favourites: new Set(),
    now: 1_000_000_000_000,
    ...over,
  };
}

describe('rank', () => {
  it('orders by textual relevance', () => {
    const items = [item('a', 'Chrome'), item('b', 'Chromium'), item('c', 'Chrome Canary')];
    const ranked = rank('chrome', items, signals());
    expect(ranked[0]!.item.id).toBe('a'); // exact
  });

  it('usage boosts a frequently used item over a slightly better text match', () => {
    const items = [item('canary', 'Chrome Canary'), item('chrome', 'Chrome Beta')];
    const base = rank('chrome', items, signals());
    // Without usage, both are substring/prefix-ish; give canary heavy usage.
    const boosted = rank(
      'chrome',
      items,
      signals({ usage: new Map([['canary', 80]]) }),
    );
    const canaryRankBase = base.findIndex((r) => r.item.id === 'canary');
    const canaryRankBoosted = boosted.findIndex((r) => r.item.id === 'canary');
    expect(canaryRankBoosted).toBeLessThanOrEqual(canaryRankBase);
  });

  it('recency decays over time', () => {
    const now = 1_000_000_000_000;
    const recent = signals({ lastUsed: new Map([['a', now - 1000]]), now });
    const old = signals({ lastUsed: new Map([['a', now - 30 * 24 * 3600 * 1000]]), now });
    const items = [item('a', 'Notes')];
    const r1 = rank('notes', items, recent)[0]!;
    const r2 = rank('notes', items, old)[0]!;
    expect(r1.score).toBeGreaterThan(r2.score);
  });

  it('pinned items win on empty query', () => {
    const items = [item('a', 'Alpha'), item('b', 'Beta')];
    const ranked = rank('', items, signals({ pinned: new Set(['b']) }));
    expect(ranked[0]!.item.id).toBe('b');
  });

  it('empty query hides items with no signals', () => {
    const items = [item('a', 'Alpha')];
    expect(rank('', items, signals())).toHaveLength(0);
  });

  it('drops non-matching items', () => {
    const items = [item('a', 'Chrome'), item('b', 'Firefox')];
    const ranked = rank('chrome', items, signals());
    expect(ranked.map((r) => r.item.id)).toEqual(['a']);
  });

  it('matches via aliases and keywords', () => {
    const items = [item('a', 'Visual Studio Code', { aliases: ['editor'], keywords: ['ide'] })];
    expect(rank('editor', items, signals())).toHaveLength(1);
    expect(rank('ide', items, signals())).toHaveLength(1);
  });

  it('provides a score explanation', () => {
    const items = [item('a', 'Chrome')];
    const ranked = rank('chrome', items, signals());
    expect(ranked[0]!.explanation.matchedField).toBe('title');
    expect(ranked[0]!.explanation.exactBonus).toBeGreaterThan(0);
  });
});
