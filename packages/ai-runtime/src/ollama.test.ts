import { describe, expect, it, vi } from 'vitest';
import { OllamaProvider, type FetchLike, type FetchResponseLike } from './ollama.js';
import { AiError, type AiStreamChunk } from './types.js';

function jsonResponse(body: unknown): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(enc.encode(line));
      controller.close();
    },
  });
}

describe('OllamaProvider', () => {
  it('lists models from /api/tags', async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({
        models: [
          { name: 'llama3.1', details: { families: ['llama'] } },
          { name: 'llava', details: { families: ['clip', 'llama'] } },
        ],
      });
    const models = await new OllamaProvider({ fetch: fetchFn }).listModels();
    expect(models.map((m) => m.id)).toEqual(['llama3.1', 'llava']);
    expect(models.find((m) => m.id === 'llava')?.vision).toBe(true);
  });

  it('completes a chat request and surfaces usage', async () => {
    const fetchFn = vi.fn<FetchLike>(async (_url, init) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init!.body!).stream).toBe(false);
      return jsonResponse({
        model: 'llama3.1',
        message: { role: 'assistant', content: 'hello there' },
        prompt_eval_count: 7,
        eval_count: 3,
      });
    });
    const res = await new OllamaProvider({ fetch: fetchFn }).complete({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toBe('hello there');
    expect(res.local).toBe(true);
    expect(res.usage).toEqual({ promptTokens: 7, completionTokens: 3 });
  });

  it('passes format:json when json is requested', async () => {
    const fetchFn = vi.fn<FetchLike>(async (_url, init) => {
      expect(JSON.parse(init!.body!).format).toBe('json');
      return jsonResponse({ message: { content: '{}' } });
    });
    await new OllamaProvider({ fetch: fetchFn }).complete({
      messages: [{ role: 'user', content: 'x' }],
      json: true,
    });
    expect(fetchFn).toHaveBeenCalled();
  });

  it('streams NDJSON deltas and assembles the final content', async () => {
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      body: ndjsonStream([
        '{"message":{"content":"Hel"},"done":false}\n',
        '{"message":{"content":"lo"},"done":false}\n',
        '{"done":true,"model":"llama3.1","prompt_eval_count":2,"eval_count":2}\n',
      ]),
    });
    const chunks: AiStreamChunk[] = [];
    const res = await new OllamaProvider({ fetch: fetchFn }).stream(
      { messages: [{ role: 'user', content: 'hi' }] },
      (c) => chunks.push(c),
    );
    expect(res.content).toBe('Hello');
    expect(res.usage).toEqual({ promptTokens: 2, completionTokens: 2 });
    expect(chunks.at(-1)!.done).toBe(true);
  });

  it('reports unreachable health when the server cannot be reached', async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const health = await new OllamaProvider({ fetch: fetchFn }).health();
    expect(health.status).toBe('unreachable');
    expect(health.detail).toMatch(/ECONNREFUSED/);
  });

  it('maps an aborted request to a typed cancellation', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchFn: FetchLike = async () => {
      throw new Error('aborted');
    };
    await expect(
      new OllamaProvider({ fetch: fetchFn }).complete(
        { messages: [{ role: 'user', content: 'x' }] },
        ctrl.signal,
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(AiError).toBeDefined();
  });
});
