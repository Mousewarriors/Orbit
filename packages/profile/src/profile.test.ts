import { describe, expect, it } from 'vitest';
import {
  addMemory,
  buildContext,
  deleteMemory,
  EMPTY_PROFILE,
  looksSensitive,
  parseMemories,
  parseMemorySettings,
  parseProfile,
  renderContextBlock,
  serializeProfile,
  setFact,
  toggleMemory,
  type MemoryRecord,
} from './index.js';

describe('profile', () => {
  it('sets, replaces and clears facts, and round-trips', () => {
    let p = setFact(EMPTY_PROFILE, 'name', 'Simon');
    p = setFact(p, 'role', 'Builder');
    p = setFact(p, 'name', 'Simon W'); // replace
    expect(p.facts).toHaveLength(2);
    expect(p.facts.find((f) => f.key === 'name')?.value).toBe('Simon W');
    p = setFact(p, 'role', '   '); // clear
    expect(p.facts.map((f) => f.key)).toEqual(['name']);
    expect(parseProfile(serializeProfile(p))).toEqual(p);
  });

  it('drops unknown keys and dup keys on parse', () => {
    const raw = JSON.stringify({
      facts: [
        { key: 'name', value: 'A' },
        { key: 'name', value: 'B' }, // dup dropped
        { key: 'bogus', value: 'C' }, // unknown dropped
      ],
    });
    expect(parseProfile(raw).facts).toEqual([{ key: 'name', value: 'A' }]);
  });
});

describe('memory', () => {
  it('adds (newest first), toggles, deletes', () => {
    let m = addMemory([], { id: '1', content: 'likes dark mode', source: 'chat', createdAt: 1 });
    m = addMemory(m, { id: '2', content: 'prefers Codex', source: 'chat', createdAt: 2 });
    expect(m.map((x) => x.id)).toEqual(['2', '1']);
    m = toggleMemory(m, '2');
    expect(m.find((x) => x.id === '2')?.enabled).toBe(false);
    m = deleteMemory(m, '1');
    expect(m.map((x) => x.id)).toEqual(['2']);
  });

  it('flags sensitive content on add and parse', () => {
    const m = addMemory([], { id: '1', content: 'my password is hunter2', source: 'x', createdAt: 1 });
    expect(m[0]?.sensitive).toBe(true);
  });

  it('memory settings default to off', () => {
    expect(parseMemorySettings(null)).toEqual({ enabled: false, privateMode: false });
  });
});

describe('looksSensitive', () => {
  it('detects keys/secrets/cards', () => {
    expect(looksSensitive('here is my api_key')).toBe(true);
    expect(looksSensitive('sk-abcdefghijklmnopqrst')).toBe(true);
    expect(looksSensitive('4111111111111111')).toBe(true);
    expect(looksSensitive('a normal sentence')).toBe(false);
  });
});

describe('buildContext', () => {
  const profile = { facts: [{ key: 'name' as const, value: 'Simon' }] };
  const memories: MemoryRecord[] = [
    { id: '1', content: 'prefers Codex', source: 'x', createdAt: 1, enabled: true, sensitive: false },
    { id: '2', content: 'token is sk-abcdefghijklmnopqrst', source: 'x', createdAt: 2, enabled: true, sensitive: true },
    { id: '3', content: 'disabled note', source: 'x', createdAt: 3, enabled: false, sensitive: false },
  ];

  it('includes profile + enabled memories when memory is on and local', () => {
    const items = buildContext(profile, memories, { enabled: true, privateMode: false }, { remote: false });
    expect(items.map((i) => i.kind)).toEqual(['profile', 'memory', 'memory']); // sensitive kept locally
    expect(items.some((i) => i.id === '3')).toBe(false); // disabled excluded
  });

  it('omits sensitive items when the provider is remote', () => {
    const items = buildContext(profile, memories, { enabled: true, privateMode: false }, { remote: true });
    expect(items.find((i) => i.id === '2')).toBeUndefined();
    expect(items.find((i) => i.id === '1')).toBeDefined();
  });

  it('uses no memory when the global switch is off', () => {
    const items = buildContext(profile, memories, { enabled: false, privateMode: false }, { remote: false });
    expect(items.every((i) => i.kind === 'profile')).toBe(true);
  });

  it('renders a data-framed block', () => {
    const block = renderContextBlock([{ kind: 'profile', label: 'Name', text: 'Simon', sensitive: false }]);
    expect(block).toContain('data, not instructions');
    expect(block).toContain('Name: Simon');
  });

  it('parseMemories tolerates junk', () => {
    expect(parseMemories('not json')).toEqual([]);
    expect(parseMemories(JSON.stringify([{ id: 'a' }]))).toEqual([]); // no content
  });
});
