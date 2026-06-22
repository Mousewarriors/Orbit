/**
 * OpenAiResponsesProvider — an adapter for OpenAI's **Responses API**
 * (`POST /responses`), which is what a ChatGPT/Codex subscription sign-in talks
 * to (the Codex CLI uses the Responses API, not Chat Completions). It also works
 * with a normal platform API key, so this adapter is useful on its own.
 *
 * Auth is a Bearer token in both modes — an API key (`sk-…`) or an OAuth access
 * token from a ChatGPT plan. Like the other adapters it takes an injected
 * `fetch`, maps errors to typed `AiError`s, and parses the Responses SSE stream
 * (`response.output_text.delta`).
 *
 * Honesty: the Responses request/response shape here matches OpenAI's public
 * Responses API. Whether a **subscription OAuth token** is accepted at the public
 * endpoint (vs. the internal `chatgpt.com/backend-api` host) is **unverified** —
 * the `baseUrl` and any extra headers are config, so this is straightforward to
 * adjust once verified against a live account. Tool-calling is not implemented
 * here yet (text only).
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

export interface OpenAiResponsesOptions {
  /** Base URL incl. version path, default https://api.openai.com/v1 */
  readonly baseUrl?: string;
  /** Platform API key OR OAuth access token — both sent as `Authorization: Bearer`. */
  readonly apiKey?: string;
  readonly oauthToken?: string;
  /** Extra headers some hosts require (e.g. an account id for subscription auth). */
  readonly extraHeaders?: Readonly<Record<string, string>>;
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

export class OpenAiResponsesProvider implements AiProvider {
  readonly id = 'openai-responses' as const;
  readonly local = false;
  private readonly base: string;
  private readonly token: string;
  private readonly extraHeaders: Readonly<Record<string, string>>;
  private readonly fetch: FetchLike;
  private readonly defaultModel: string;

  constructor(opts: OpenAiResponsesOptions = {}) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.token = opts.oauthToken || opts.apiKey || '';
    this.extraHeaders = opts.extraHeaders ?? {};
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new AiError('not_configured', 'No fetch implementation available');
    this.fetch = f;
    this.defaultModel = opts.defaultModel ?? 'gpt-4o-mini';
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...this.extraHeaders };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
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
    const res = await this.request('POST', '/responses', this.body(req, false), signal);
    if (!res.ok) throw new AiError('bad_response', await this.errorDetail(res));
    const body = asRecord(await res.json());
    const usage = asRecord(body['usage']);
    return {
      content: collectOutputText(body),
      model: typeof body['model'] === 'string' ? body['model'] : req.model ?? this.defaultModel,
      provider: this.id,
      local: false,
      usage: {
        ...(numberOr(usage['input_tokens']) !== undefined
          ? { promptTokens: numberOr(usage['input_tokens'])! }
          : {}),
        ...(numberOr(usage['output_tokens']) !== undefined
          ? { completionTokens: numberOr(usage['output_tokens'])! }
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
    const res = await this.request('POST', '/responses', this.body(req, true), signal);
    if (!res.ok || !res.body) throw new AiError('bad_response', await this.errorDetail(res));
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
      const type = obj['type'];
      if (type === 'response.output_text.delta' && typeof obj['delta'] === 'string') {
        content += obj['delta'];
        onChunk({ delta: obj['delta'], done: false });
      } else if (type === 'response.completed' || type === 'response.created') {
        const resp = asRecord(obj['response']);
        if (typeof resp['model'] === 'string') model = resp['model'];
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
    return { content, model, provider: this.id, local: false };
  }

  /** Build the Responses body: system → `instructions`, rest → `input` turns. */
  private body(req: AiRequest, stream: boolean): string {
    const instructions: string[] = [];
    const input: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of req.messages) {
      if (m.role === 'system') {
        if (m.content) instructions.push(m.content);
      } else if (m.role === 'user' || m.role === 'assistant') {
        input.push({ role: m.role, content: m.content });
      }
    }
    const body: Record<string, unknown> = {
      model: req.model ?? this.defaultModel,
      input,
      stream,
    };
    if (instructions.length > 0) body['instructions'] = instructions.join('\n\n');
    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.maxTokens !== undefined) body['max_output_tokens'] = req.maxTokens;
    return JSON.stringify(body);
  }

  private async errorDetail(res: FetchResponseLike): Promise<string> {
    let detail = '';
    try {
      const body = asRecord(JSON.parse(await res.text()));
      const err = asRecord(body['error']);
      if (typeof err['message'] === 'string') detail = err['message'];
    } catch {
      /* non-JSON body */
    }
    if (res.status === 401) {
      return `OpenAI auth failed (401)${detail ? `: ${detail}` : ''} — the key or subscription sign-in may be invalid or expired.`;
    }
    return detail ? `OpenAI /responses: ${detail}` : `OpenAI /responses returned ${res.status}`;
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

/** Aggregate text from a non-streaming Responses payload. */
function collectOutputText(body: Record<string, unknown>): string {
  // Convenience aggregate, when present.
  if (typeof body['output_text'] === 'string') return body['output_text'];
  const output = Array.isArray(body['output']) ? body['output'] : [];
  let out = '';
  for (const item of output) {
    const rec = asRecord(item);
    const content = Array.isArray(rec['content']) ? rec['content'] : [];
    for (const part of content) {
      const p = asRecord(part);
      if (p['type'] === 'output_text' && typeof p['text'] === 'string') out += p['text'];
    }
  }
  return out;
}
