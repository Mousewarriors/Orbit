import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropic.js';
import type { FetchLike, FetchResponseLike } from './ollama.js';
import type { AiStreamChunk } from './types.js';

function jsonResponse(body: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(enc.encode(e));
      controller.close();
    },
  });
}

describe('AnthropicProvider', () => {
  it('completes via /v1/messages, sends x-api-key, separates system, surfaces usage', async () => {
    const fetchFn = vi.fn<FetchLike>(async (url, init) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init?.headers?.['x-api-key']).toBe('sk-ant-1');
      expect(init?.headers?.['anthropic-version']).toBe('2023-06-01');
      expect(init?.headers?.['authorization']).toBeUndefined();
      const sent = JSON.parse(init!.body!);
      expect(sent.system).toBe('be terse'); // string form for API-key auth
      expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }]);
      expect(sent.max_tokens).toBeGreaterThan(0);
      return jsonResponse({
        model: 'claude-3-5-sonnet-latest',
        content: [{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      });
    });
    const res = await new AnthropicProvider({ fetch: fetchFn, apiKey: 'sk-ant-1' }).complete({
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(res.content).toBe('hello world');
    expect(res.local).toBe(false);
    expect(res.usage).toEqual({ promptTokens: 5, completionTokens: 2 });
  });

  it('OAuth mode sends Bearer + beta header and prepends the Claude Code identity', async () => {
    const fetchFn = vi.fn<FetchLike>(async (_url, init) => {
      expect(init?.headers?.['authorization']).toBe('Bearer oauth-tok');
      expect(init?.headers?.['anthropic-beta']).toBe('oauth-2025-04-20');
      expect(init?.headers?.['x-api-key']).toBeUndefined();
      const sent = JSON.parse(init!.body!);
      expect(Array.isArray(sent.system)).toBe(true);
      expect(sent.system[0].text).toMatch(/^You are Claude Code/);
      expect(sent.system[1].text).toBe('extra');
      return jsonResponse({ content: [{ type: 'text', text: 'ok' }] });
    });
    const res = await new AnthropicProvider({ fetch: fetchFn, oauthToken: 'oauth-tok' }).complete({
      messages: [
        { role: 'system', content: 'extra' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(res.content).toBe('ok');
  });

  it('parses the Messages SSE stream into deltas', async () => {
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      body: sseStream([
        'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-x","usage":{"input_tokens":3}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n',
        'data: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]),
    });
    const chunks: AiStreamChunk[] = [];
    const res = await new AnthropicProvider({ fetch: fetchFn, oauthToken: 't' }).stream(
      { messages: [{ role: 'user', content: 'hi' }] },
      (c) => chunks.push(c),
    );
    expect(res.content).toBe('Hello');
    expect(res.model).toBe('claude-x');
    expect(res.usage).toEqual({ promptTokens: 3, completionTokens: 7 });
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it('lists models from /v1/models', async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({ data: [{ id: 'claude-3-5-sonnet-latest', display_name: 'Sonnet' }] });
    const models = await new AnthropicProvider({ fetch: fetchFn, apiKey: 'k' }).listModels();
    expect(models[0]).toMatchObject({ id: 'claude-3-5-sonnet-latest', label: 'Sonnet' });
  });

  it('maps a 401 to an actionable error', async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({ error: { message: 'invalid token' } }, false, 401);
    await expect(
      new AnthropicProvider({ fetch: fetchFn, oauthToken: 'bad' }).complete({
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/auth failed \(401\)/i);
  });
});
