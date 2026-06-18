/**
 * A `FetchLike` backed by the native HTTP bridge.
 *
 * This is what finally connects the already-built `OllamaProvider` (and any
 * HTTP-based adapter) to a real server: the provider keeps its injected-fetch
 * shape, and here we satisfy it by routing through Rust — a one-shot request for
 * non-streaming calls, and an event-fed `ReadableStream<Uint8Array>` for token
 * streaming (so the provider's streaming TextDecoder handles byte boundaries).
 *
 * The transport is injected as an `HttpBridge` so the streaming assembly is
 * unit-tested with no Tauri.
 */
import type { FetchLike, FetchResponseLike } from '@orbit/ai-runtime';
import * as native from '../native.js';

export interface HttpBridge {
  request(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; body: string }>;
  streamOpen(
    id: string,
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<void>;
  streamCancel(id: string): Promise<void>;
  onStream(handler: (ev: native.HttpStreamEvent) => void): Promise<() => void>;
}

/** The production bridge over `native.*`. */
export function nativeBridge(): HttpBridge {
  return {
    request: (method, url, headers, body) => native.httpRequest(method, url, headers, body),
    streamOpen: (id, method, url, headers, body) =>
      native.httpStreamOpen(id, method, url, headers, body),
    streamCancel: (id) => native.httpStreamCancel(id),
    onStream: (handler) => native.onHttpStream(handler),
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Does this request body ask Ollama to stream? */
function wantsStream(body: string | undefined): boolean {
  return !!body && /"stream"\s*:\s*true/.test(body);
}

let counter = 0;

/**
 * Build an event-backed `ReadableStream<Uint8Array>` for a streamed request.
 * Subscribes *before* opening the request so no early chunk is missed.
 */
async function openStreamBody(
  bridge: HttpBridge,
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  signal: AbortSignal | undefined,
): Promise<ReadableStream<Uint8Array>> {
  const id = `req-${++counter}-${Date.now()}`;
  const queue: Uint8Array[] = [];
  let ended = false;
  let error: string | null = null;
  let wake: (() => void) | null = null;

  const unlisten = await bridge.onStream((ev) => {
    if (ev.id !== id) return;
    if (ev.kind === 'chunk') queue.push(base64ToBytes(ev.data));
    else if (ev.kind === 'end') ended = true;
    else {
      error = ev.data || 'stream error';
      ended = true;
    }
    wake?.();
  });

  if (signal) {
    if (signal.aborted) void bridge.streamCancel(id);
    else signal.addEventListener('abort', () => void bridge.streamCancel(id), { once: true });
  }

  try {
    await bridge.streamOpen(id, method, url, headers, body);
  } catch (e) {
    await unlisten();
    throw e;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const next = queue.shift();
        if (next) {
          controller.enqueue(next);
          return;
        }
        if (error) {
          await unlisten();
          controller.error(new Error(error));
          return;
        }
        if (ended) {
          await unlisten();
          controller.close();
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
    async cancel() {
      await bridge.streamCancel(id);
      await unlisten();
    },
  });
}

/** Create a `FetchLike` over the given bridge (defaults to the native one). */
export function createNativeFetch(bridge: HttpBridge = nativeBridge()): FetchLike {
  return async (input, init): Promise<FetchResponseLike> => {
    const method = init?.method ?? 'GET';
    const headers = init?.headers ?? {};
    const body = init?.body;

    if (wantsStream(body)) {
      const stream = await openStreamBody(bridge, method, input, headers, body, init?.signal);
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
        body: stream,
      };
    }

    const res = await bridge.request(method, input, headers, body);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: () => Promise.resolve(JSON.parse(res.body)),
      text: () => Promise.resolve(res.body),
      body: null,
    };
  };
}
