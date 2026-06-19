import { describe, expect, it } from 'vitest';
import { OpenAiCompatProvider } from './openaiCompat.js';
import type { FetchLike, FetchResponseLike } from './ollama.js';

function jsonResponse(body: unknown, ok = true): FetchResponseLike {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(body), text: () => Promise.resolve('') };
}

function sseResponse(frames: string[]): FetchResponseLike {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return { ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve(''), body: stream };
}

describe('OpenAiCompatProvider', () => {
  it('sends a Bearer key and parses a completion', async () => {
    let sentAuth: string | undefined;
    let sentBody: string | undefined;
    const fetch: FetchLike = (_url, init) => {
      sentAuth = init?.headers?.['Authorization'];
      sentBody = init?.body;
      return Promise.resolve(
        jsonResponse({ model: 'gpt-4o-mini', choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
      );
    };
    const p = new OpenAiCompatProvider({ apiKey: 'secret-key', fetch, defaultModel: 'gpt-4o-mini' });
    const res = await p.complete({ messages: [{ role: 'user', content: 'hi' }], temperature: 0.2 });
    expect(res.content).toBe('hello');
    expect(res.usage?.promptTokens).toBe(3);
    expect(sentAuth).toBe('Bearer secret-key');
    expect(sentBody).toContain('"temperature":0.2');
  });

  it('streams SSE deltas and stops on [DONE]', async () => {
    const fetch: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      );
    const p = new OpenAiCompatProvider({ apiKey: 'k', fetch });
    const pieces: string[] = [];
    const res = await p.stream({ messages: [{ role: 'user', content: 'hi' }] }, (c) => {
      if (c.delta) pieces.push(c.delta);
    });
    expect(pieces.join('')).toBe('Hello');
    expect(res.content).toBe('Hello');
  });

  it('lists models and flags a remote vs local base', async () => {
    const fetch: FetchLike = () => Promise.resolve(jsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }));
    const remote = new OpenAiCompatProvider({ apiKey: 'k', fetch });
    expect(remote.local).toBe(false);
    expect((await remote.listModels()).map((m) => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini']);
    const local = new OpenAiCompatProvider({ baseUrl: 'http://127.0.0.1:1234/v1', fetch });
    expect(local.local).toBe(true);
  });

  it('maps a non-2xx completion to a typed error', async () => {
    const fetch: FetchLike = () => Promise.resolve(jsonResponse({}, false));
    const p = new OpenAiCompatProvider({ apiKey: 'k', fetch });
    await expect(p.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      code: 'bad_response',
    });
  });
});
