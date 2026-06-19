/**
 * OpenAiCompatProvider — an adapter for any OpenAI-compatible Chat Completions
 * endpoint (OpenAI, OpenRouter, Azure-style gateways, and local servers such as
 * LM Studio / llama.cpp / vLLM). Like the Ollama adapter it takes an injected
 * `fetch`, so it is fully testable without a network, maps errors to typed
 * `AiError`s, and parses SSE streaming. The API key is supplied by the caller
 * (loaded from OS secure storage) and only ever sent as an `Authorization`
 * header — never logged or persisted by this package.
 */
import {
  AiError,
  throwIfAborted,
  type AiModelInfo,
  type AiProvider,
  type AiRequest,
  type AiResponse,
  type AiStreamChunk,
  type ProviderHealth,
} from './types.js';
import type { FetchLike, FetchResponseLike } from './ollama.js';

export interface OpenAiCompatOptions {
  /** Base URL including the version path, e.g. https://api.openai.com/v1 */
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly fetch?: FetchLike;
  readonly defaultModel?: string;
}

const DEFAULT_BASE = 'https://api.openai.com/v1';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** True when the endpoint is a loopback host (processing stays on-device). */
function isLocalBase(base: string): boolean {
  try {
    const host = new URL(base).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export class OpenAiCompatProvider implements AiProvider {
  readonly id = 'openai-compat' as const;
  readonly local: boolean;
  private readonly base: string;
  private readonly fetch: FetchLike;
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(opts: OpenAiCompatOptions = {}) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.local = isLocalBase(this.base);
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new AiError('not_configured', 'No fetch implementation available');
    this.fetch = f;
    this.apiKey = opts.apiKey ?? '';
    this.defaultModel = opts.defaultModel ?? 'gpt-4o-mini';
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const models = await this.listModels(signal);
      return { status: 'ready', models };
    } catch (e) {
      if (e instanceof AiError && e.code === 'cancelled') throw e;
      return { status: 'unreachable', detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async listModels(signal?: AbortSignal): Promise<readonly AiModelInfo[]> {
    throwIfAborted(signal);
    const res = await this.request('GET', '/models', undefined, signal);
    if (!res.ok) throw new AiError('unreachable', `GET /models returned ${res.status}`);
    const body = asRecord(await res.json());
    const data = Array.isArray(body['data']) ? body['data'] : [];
    return data.flatMap((m): AiModelInfo[] => {
      const rec = asRecord(m);
      const id = typeof rec['id'] === 'string' ? rec['id'] : null;
      return id ? [{ id, label: id }] : [];
    });
  }

  async complete(req: AiRequest, signal?: AbortSignal): Promise<AiResponse> {
    throwIfAborted(signal);
    const res = await this.request('POST', '/chat/completions', this.body(req, false), signal);
    if (!res.ok) throw new AiError('bad_response', `chat/completions returned ${res.status}`);
    const body = asRecord(await res.json());
    const choices = Array.isArray(body['choices']) ? body['choices'] : [];
    const message = asRecord(asRecord(choices[0])['message']);
    const usage = asRecord(body['usage']);
    return {
      content: typeof message['content'] === 'string' ? message['content'] : '',
      model: typeof body['model'] === 'string' ? body['model'] : req.model ?? this.defaultModel,
      provider: this.id,
      local: this.local,
      usage: {
        ...(numberOr(usage['prompt_tokens']) !== undefined
          ? { promptTokens: numberOr(usage['prompt_tokens'])! }
          : {}),
        ...(numberOr(usage['completion_tokens']) !== undefined
          ? { completionTokens: numberOr(usage['completion_tokens'])! }
          : {}),
      },
    };
  }

  async stream(
    req: AiRequest,
    onChunk: (chunk: AiStreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<AiResponse> {
    throwIfAborted(signal);
    const res = await this.request('POST', '/chat/completions', this.body(req, true), signal);
    if (!res.ok || !res.body) throw new AiError('bad_response', `stream returned ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let model = req.model ?? this.defaultModel;

    const handleData = (payload: string): void => {
      if (payload === '[DONE]') return;
      let obj: Record<string, unknown>;
      try {
        obj = asRecord(JSON.parse(payload));
      } catch {
        return;
      }
      if (typeof obj['model'] === 'string') model = obj['model'];
      const choices = Array.isArray(obj['choices']) ? obj['choices'] : [];
      const delta = asRecord(asRecord(choices[0])['delta']);
      const piece = typeof delta['content'] === 'string' ? delta['content'] : '';
      if (piece) {
        content += piece;
        onChunk({ delta: piece, done: false });
      }
    };

    for (;;) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new AiError('cancelled', 'Request was cancelled');
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) handleData(line.slice(5).trim());
        nl = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) handleData(tail.slice(5).trim());
    onChunk({ delta: '', done: true });
    return { content, model, provider: this.id, local: this.local };
  }

  private body(req: AiRequest, stream: boolean): string {
    const body: Record<string, unknown> = {
      model: req.model ?? this.defaultModel,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
    };
    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.maxTokens !== undefined) body['max_tokens'] = req.maxTokens;
    if (req.json) body['response_format'] = { type: 'json_object' };
    return JSON.stringify(body);
  }

  private async request(
    method: string,
    path: string,
    body: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<FetchResponseLike> {
    try {
      return await this.fetch(`${this.base}${path}`, {
        method,
        headers: this.headers(),
        ...(body !== undefined ? { body } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      if (signal?.aborted) throw new AiError('cancelled', 'Request was cancelled');
      throw new AiError('unreachable', e instanceof Error ? e.message : String(e));
    }
  }
}
