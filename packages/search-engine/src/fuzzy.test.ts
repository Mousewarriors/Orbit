import { describe, expect, it } from 'vitest';
import { boundedEditDistance, match, matchNormalized, normalize } from './fuzzy.js';

describe('normalize', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalize('Café')).toBe('cafe');
    expect(normalize('NAÏVE')).toBe('naive');
  });
});

describe('boundedEditDistance', () => {
  it('computes small distances', () => {
    expect(boundedEditDistance('chrome', 'chrome', 2)).toBe(0);
    expect(boundedEditDistance('chrme', 'chrome', 2)).toBe(1);
    expect(boundedEditDistance('kitten', 'sitting', 3)).toBe(3);
  });
  it('early-exits past the ceiling', () => {
    expect(boundedEditDistance('abcdef', 'uvwxyz', 2)).toBe(3); // max+1
  });
});

describe('match kinds', () => {
  it('detects exact match with full score', () => {
    const r = match('chrome', 'chrome');
    expect(r.kind).toBe('exact');
    expect(r.score).toBe(1);
  });

  it('ranks prefix above substring above subsequence', () => {
    const prefix = match('chr', 'Chrome');
    const substring = match('rom', 'Chrome');
    const subseq = match('cme', 'Chrome');
    expect(prefix.kind).toBe('prefix');
    expect(substring.kind).toBe('substring');
    expect(subseq.kind).toBe('subsequence');
    expect(prefix.score).toBeGreaterThan(substring.score);
    expect(substring.score).toBeGreaterThan(subseq.score);
  });

  it('matches acronyms across word boundaries', () => {
    const r = match('vsc', 'Visual Studio Code');
    expect(r.kind).toBe('acronym');
    expect(r.indices).toEqual([0, 7, 14]);
  });

  it('matches acronyms across hyphen/underscore boundaries', () => {
    expect(match('mwl', 'move-window-left').kind).toBe('acronym');
    expect(match('cdt', 'create_daily_task').kind).toBe('acronym');
  });

  it('tolerates a single substitution typo (not a subsequence)', () => {
    // 'chrime' is NOT an ordered subsequence of 'chrome' (no 'i'), so this
    // exercises the bounded edit-distance rescue path specifically.
    const r = match('chrime', 'Chrome');
    expect(r.kind).toBe('typo');
    expect(r.score).toBeGreaterThan(0);
  });

  it('catches a dropped character as a subsequence', () => {
    // Deletions remain subsequences and are handled before the typo path.
    expect(match('chrme', 'Chrome').kind).toBe('subsequence');
  });

  it('returns no match for unrelated text', () => {
    expect(match('xyzzy', 'Chrome').kind).toBe('none');
  });

  it('treats empty query as a faint universal match', () => {
    const r = matchNormalized('', 'anything');
    expect(r.score).toBeGreaterThan(0);
  });
});

describe('real-world launcher behaviour', () => {
  const apps = ['Google Chrome', 'Visual Studio Code', 'Calculator', 'Slack', 'Discord'];

  function bestFor(query: string): string {
    return [...apps]
      .map((a) => ({ a, s: match(query, a).score }))
      .sort((x, y) => y.s - x.s)[0]!.a;
  }

  it('"chr" → Google Chrome', () => expect(bestFor('chr')).toBe('Google Chrome'));
  it('"vsc" → Visual Studio Code', () => expect(bestFor('vsc')).toBe('Visual Studio Code'));
  it('"calc" → Calculator', () => expect(bestFor('calc')).toBe('Calculator'));
  it('"disc" → Discord', () => expect(bestFor('disc')).toBe('Discord'));
});
