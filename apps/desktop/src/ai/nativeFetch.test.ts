import { describe, expect, it, vi } from 'vitest';
import { createNativeFetch, type HttpBridge } from './nativeFetch.js';
import type { HttpStreamEvent } from '../native.js';

function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe('createNativeFetch — non-streaming', () => {
  it('routes a GET through the bridge and parses JSON', async () => {
    const bridge: HttpBridge = {
      request: vi.fn().mockResolvedValue({ status: 200, body: '{"models":[]}' }),
      streamOpen: vi.fn(),
      streamCancel: vi.fn(),
      onStream: vi.fn(),
    };
    const fetch = createNativeFetch(bridge);
    const res = await fetch('http://127.0.0.1:11434/api/tags', { method: 'GET' });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ models: [] });
    expect(bridge.request).toHaveBeenCalledWith('GET', expect.any(String), {}, undefined);
  });

  it('marks non-2xx as not ok', async () => {
    const bridge: HttpBridge = {
      request: () => Promise.resolve({ status: 500, body: 'boom' }),
      streamOpen: vi.fn(),
      streamCancel: vi.fn(),
      onStream: vi.fn(),
    };
    const res = await createNativeFetch(bridge)('http://x/y', { method: 'POST', body: '{}' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });
});

describe('createNativeFetch — streaming', () => {
  it('assembles event chunks into a readable body (decoding across boundaries)', async () => {
    let handler: ((ev: HttpStreamEvent) => void) | null = null;
    const bridge: HttpBridge = {
      request: vi.fn(),
      streamCancel: vi.fn().mockResolvedValue(undefined),
      onStream: (h) => {
        handler = h;
        return Promise.resolve(() => {});
      },
      streamOpen: (id) => {
        // Drive two NDJSON lines then end, asynchronously, after pull starts.
        queueMicrotask(() => {
          handler!({ id, kind: 'chunk', data: b64('{"message":{"content":"Hel'), status: 200 });
          handler!({ id, kind: 'chunk', data: b64('lo"},"done":false}\n'), status: 200 });
          handler!({ id, kind: 'end', data: '', status: 200 });
        });
        return Promise.resolve();
      },
    };
    const fetch = createNativeFetch(bridge);
    const res = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      body: '{"stream":true}',
    });
    expect(res.body).toBeTruthy();
    const text = await readAll(res.body!);
    expect(text).toBe('{"message":{"content":"Hello"},"done":false}\n');
  });

  it('errors the stream when the bridge reports an error', async () => {
    let handler: ((ev: HttpStreamEvent) => void) | null = null;
    const bridge: HttpBridge = {
      request: vi.fn(),
      streamCancel: vi.fn().mockResolvedValue(undefined),
      onStream: (h) => {
        handler = h;
        return Promise.resolve(() => {});
      },
      streamOpen: (id) => {
        queueMicrotask(() => handler!({ id, kind: 'error', data: 'unreachable', status: 0 }));
        return Promise.resolve();
      },
    };
    const res = await createNativeFetch(bridge)('http://x', { method: 'POST', body: '{"stream":true}' });
    await expect(readAll(res.body!)).rejects.toThrow('unreachable');
  });
});
