import { describe, expect, it } from 'vitest';
import {
  addRecentPrompt,
  buildMessages,
  MAX_RECENT_PROMPTS,
  parseRecentPrompts,
  type QuickAiContext,
} from './quickAi.js';

describe('buildMessages', () => {
  it('sends just the prompt when there is no context', () => {
    const msgs = buildMessages('hello');
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('prepends included context as labelled, quoted data blocks', () => {
    const ctx: QuickAiContext[] = [
      { kind: 'clipboard', label: 'Clipboard', text: 'some copied text', remote: false },
    ];
    const msgs = buildMessages('summarise this', ctx);
    expect(msgs[1]!.content).toContain('Clipboard');
    expect(msgs[1]!.content).toContain('some copied text');
    expect(msgs[1]!.content.endsWith('summarise this')).toBe(true);
  });

  it('treats context as data and warns the model not to obey it', () => {
    expect(buildMessages('x')[0]!.content).toMatch(/not.*commands|data, not/i);
  });

  it('skips empty context chips', () => {
    const ctx: QuickAiContext[] = [{ kind: 'clipboard', label: 'Clipboard', text: '   ', remote: false }];
    expect(buildMessages('p', ctx)[1]!.content).toBe('p');
  });
});

describe('recent prompts', () => {
  it('dedupes, keeps newest first, and caps the list', () => {
    let h: string[] = [];
    h = addRecentPrompt(h, 'a');
    h = addRecentPrompt(h, 'b');
    h = addRecentPrompt(h, 'a'); // moves 'a' to front
    expect(h).toEqual(['a', 'b']);

    for (let i = 0; i < 20; i++) h = addRecentPrompt(h, `q${i}`);
    expect(h.length).toBe(MAX_RECENT_PROMPTS);
    expect(h[0]).toBe('q19');
  });

  it('ignores blank prompts', () => {
    expect(addRecentPrompt(['a'], '   ')).toEqual(['a']);
  });

  it('parses persisted history and tolerates junk', () => {
    expect(parseRecentPrompts(JSON.stringify(['a', 'b']))).toEqual(['a', 'b']);
    expect(parseRecentPrompts(null)).toEqual([]);
    expect(parseRecentPrompts('not json')).toEqual([]);
    expect(parseRecentPrompts('{"x":1}')).toEqual([]);
  });
});
