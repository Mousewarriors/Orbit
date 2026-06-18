import { describe, expect, it } from 'vitest';
import {
  buildChatMessages,
  conversationToMarkdown,
  deriveTitle,
  parseMarkdownBlocks,
  type ConversationMessage,
} from './index.js';

describe('buildChatMessages', () => {
  it('prepends the system prompt and preserves order', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'how are you' },
    ];
    const msgs = buildChatMessages(history);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs.slice(1).map((m) => m.content)).toEqual(['hi', 'hello', 'how are you']);
  });

  it('drops the oldest turns to fit the char budget but keeps the newest', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: 'A'.repeat(100) },
      { role: 'assistant', content: 'B'.repeat(100) },
      { role: 'user', content: 'C'.repeat(100) },
    ];
    const msgs = buildChatMessages(history, 'sys', 150);
    const contents = msgs.slice(1).map((m) => m.content[0]);
    expect(contents).toContain('C'); // newest always kept
    expect(contents).not.toContain('A'); // oldest dropped
  });
});

describe('deriveTitle', () => {
  it('uses the first line, collapses whitespace, truncates', () => {
    expect(deriveTitle('  Help me   write\nmore ')).toBe('Help me write');
    expect(deriveTitle('')).toBe('New chat');
    expect(deriveTitle('x'.repeat(80)).endsWith('…')).toBe(true);
  });
});

describe('parseMarkdownBlocks', () => {
  it('separates fenced code from text', () => {
    const md = 'Here is code:\n```ts\nconst x = 1;\n```\nDone.';
    const blocks = parseMarkdownBlocks(md);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ kind: 'text', text: 'Here is code:' });
    expect(blocks[1]).toEqual({ kind: 'code', lang: 'ts', text: 'const x = 1;' });
    expect(blocks[2]).toEqual({ kind: 'text', text: 'Done.' });
  });

  it('treats an unterminated fence (mid-stream) as code to the end', () => {
    const blocks = parseMarkdownBlocks('```py\nprint(1)');
    expect(blocks).toEqual([{ kind: 'code', lang: 'py', text: 'print(1)' }]);
  });

  it('returns a single text block for plain prose', () => {
    expect(parseMarkdownBlocks('just words')).toEqual([{ kind: 'text', text: 'just words' }]);
  });
});

describe('conversationToMarkdown', () => {
  it('exports a transcript excluding system messages', () => {
    const md = conversationToMarkdown('My chat', [
      { role: 'system', content: 'secret prompt' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(md).toContain('# My chat');
    expect(md).toContain('**You:**');
    expect(md).toContain('**Assistant:**');
    expect(md).not.toContain('secret prompt');
  });
});
