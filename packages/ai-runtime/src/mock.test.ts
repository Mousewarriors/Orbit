import { describe, expect, it } from 'vitest';
import { MockProvider } from './mock.js';
import { AiError, type AiStreamChunk } from './types.js';

describe('MockProvider', () => {
  it('is local and reports ready health with models', async () => {
    const p = new MockProvider();
    expect(p.local).toBe(true);
    const health = await p.health();
    expect(health.status).toBe('ready');
    expect(health.models?.length).toBeGreaterThan(0);
  });

  it('echoes by default and honours a scripted reply', async () => {
    const echo = await new MockProvider().complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(echo.content).toContain('hi');
    expect(echo.local).toBe(true);

    const scripted = await new MockProvider({ reply: '{"intent":"none"}' }).complete({
      messages: [{ role: 'user', content: 'whatever' }],
    });
    expect(scripted.content).toBe('{"intent":"none"}');
  });

  it('streams the reply in chunks then a final done', async () => {
    const p = new MockProvider({ reply: 'one two three' });
    const chunks: AiStreamChunk[] = [];
    const res = await p.stream({ messages: [{ role: 'user', content: 'x' }] }, (c) => chunks.push(c));
    expect(res.content).toBe('one two three');
    expect(chunks.at(-1)!.done).toBe(true);
    expect(chunks.filter((c) => !c.done).map((c) => c.delta).join('')).toBe('one two three');
  });

  it('throws a typed cancellation error when the signal is aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      new MockProvider().complete({ messages: [{ role: 'user', content: 'x' }] }, ctrl.signal),
    ).rejects.toBeInstanceOf(AiError);
  });
});
