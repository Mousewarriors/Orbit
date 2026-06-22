import { describe, expect, it, vi } from 'vitest';
import { OpenAiResponsesProvider } from './openaiResponses.js';
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

describe('OpenAiResponsesProvider', () => {
  it('POSTs /responses with Bearer auth, system→instructions, messages→input', async () => {
    const fetchFn = vi.fn<FetchLike>(async (url, init) => {
      expect(url).toBe('https://api.openai.com/v1/responses');
      expect(init?.headers?.['Authorization']).toBe('Bearer tok-1');
      const sent = JSON.parse(init!.body!);
      expect(sent.instructions).toBe('sys');
      expect(sent.input).toEqual([{ role: 'user', content: 'hi' }]);
      return jsonResponse({
        model: 'gpt-4o-mini',
        output_text: 'answer',
        usage: { input_tokens: 4, output_tokens: 1 },
      });
    });
    const res = await new OpenAiResponsesProvider({ fetch: fetchFn, oauthToken: 'tok-1' }).complete({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(res.content).toBe('answer');
    expect(res.usage).toEqual({ promptTokens: 4, completionTokens: 1 });
  });

  it('aggregates output[] when output_text is absent', async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'a' }, { type: 'output_text', text: 'b' }] },
        ],
      });
    const res = await new OpenAiResponsesProvider({ fetch: fetchFn, apiKey: 'k' }).complete({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toBe('ab');
  });

  it('parses the Responses SSE stream into deltas', async () => {
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      body: sseStream([
        'data: {"type":"response.created","response":{"model":"gpt-x"}}\n\n',
        'data: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
        'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
        'data: {"type":"response.completed","response":{"model":"gpt-x"}}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    const chunks: AiStreamChunk[] = [];
    const res = await new OpenAiResponsesProvider({ fetch: fetchFn, apiKey: 'k' }).stream(
      { messages: [{ role: 'user', content: 'hi' }] },
      (c) => chunks.push(c),
    );
    expect(res.content).toBe('Hello');
    expect(res.model).toBe('gpt-x');
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it('maps a 401 to an actionable error', async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({ error: { message: 'bad token' } }, false, 401);
    await expect(
      new OpenAiResponsesProvider({ fetch: fetchFn, oauthToken: 'x' }).complete({
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/auth failed \(401\)/i);
  });
});
