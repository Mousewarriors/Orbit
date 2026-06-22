/**
 * AnthropicProvider — a native adapter for Anthropic's **Messages API**
 * (`/v1/messages`), supporting two auth modes:
 *   - **API key** (`x-api-key`) — a console key (`sk-ant-…`), billed per token;
 *   - **OAuth subscription** (`Authorization: Bearer` + `anthropic-beta:
 *     oauth-2025-04-20`) — a Claude Pro/Max plan signed in via the public Claude
 *     Code client.
 *
 * Like the other adapters it takes an injected `fetch` (so it's fully testable
 * with no network), maps errors to typed `AiError`s, and parses the Messages SSE
 * stream. The Messages API shape (system separated out, `max_tokens` required,
 * content blocks) differs from OpenAI Chat Completions, hence a dedicated adapter
 * rather than the OpenAI-compatible one.
 *
 * Honesty: the OAuth path is **experimental**. Anthropic requires OAuth requests
 * to identify as Claude Code (the first system block is the fixed identity
 * string below); this is a documented constraint of that client and may change.
 * Tool-calling is not implemented here yet (text only).
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

export interface AnthropicProviderOptions {
  /** Base URL (no version path), default https://api.anthropic.com */
  readonly baseUrl?: string;
  /** Console API key — sent as `x-api-key`. */
  readonly apiKey?: string;
  /** OAuth access token — sent as `Authorization: Bearer` (+ oauth beta header). */
  readonly oauthToken?: string;
  readonly fetch?: FetchLike;
  readonly defaultModel?: string;
  /** Anthropic requires an explicit cap; default when a request omits one. */
  readonly maxTokens?: number;
}

const DEFAULT_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const OAUTH_BETA = 'oauth-2025-04-20';
/** OAuth tokens are scoped to the Claude Code client and require this identity. */
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const;
  readonly local = false;
  private readonly base: string;
  private readonly apiKey: string;
  private readonly oauthToken: string;
  private readonly fetch: FetchLike;
  private readonly defaultModel: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.apiKey = opts.apiKey ?? '';
    this.oauthToken = opts.oauthToken ?? '';
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new AiError('not_configured', 'No fetch implementation available');
    this.fetch = f;
    this.defaultModel = opts.defaultModel ?? 'claude-3-5-sonnet-latest';
    this.maxTokens = opts.maxTokens ?? 4096;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
    };
    if (this.oauthToken) {
      h['authorization'] = `Bearer ${this.oauthToken}`;
      h['anthropic-beta'] = OAUTH_BETA;
    } else if (this.apiKey) {
      h['x-api-key'] = this.apiKey;
    }
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
    const res = await this.request('GET', '/v1/models', undefined, signal);
    if (!res.ok) throw new AiError('unreachable', `GET /v1/models returned ${res.status}`);
    const body = asRecord(await res.json());
    const data = Array.isArray(body['data']) ? body['data'] : [];
    return data.flatMap((m): AiModelInfo[] => {
      const rec = asRecord(m);
      const id = typeof rec['id'] === 'string' ? rec['id'] : null;
      if (!id) return [];
      const label = typeof rec['display_name'] === 'string' ? rec['display_name'] : id;
      return [{ id, label, tools: true }];
    });
  }

  async complete(req: AiRequest, signal?: AbortSignal): Promise<AiResponse> {
    throwIfAborted(signal);
    const res = await this.request('POST', '/v1/messages', this.body(req, false), signal);
    if (!res.ok) throw new AiError('bad_response', await this.errorDetail(res));
    const body = asRecord(await res.json());
    const content = collectText(body['content']);
    const usage = asRecord(body['usage']);
    return {
      content,
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
    const res = await this.request('POST', '/v1/messages', this.body(req, true), signal);
    if (!res.ok || !res.body) throw new AiError('bad_response', await this.errorDetail(res));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let model = req.model ?? this.defaultModel;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    const handleData = (payload: string): void => {
      let obj: Record<string, unknown>;
      try {
        obj = asRecord(JSON.parse(payload));
      } catch {
        return;
      }
      const type = obj['type'];
      if (type === 'content_block_delta') {
        const delta = asRecord(obj['delta']);
        if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
          content += delta['text'];
          onChunk({ delta: delta['text'], done: false });
        }
      } else if (type === 'message_start') {
        const msg = asRecord(obj['message']);
        if (typeof msg['model'] === 'string') model = msg['model'];
        const usage = asRecord(msg['usage']);
        promptTokens = numberOr(usage['input_tokens']) ?? promptTokens;
      } else if (type === 'message_delta') {
        const usage = asRecord(obj['usage']);
        completionTokens = numberOr(usage['output_tokens']) ?? completionTokens;
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
    return {
      content,
      model,
      provider: this.id,
      local: false,
      ...(promptTokens !== undefined || completionTokens !== undefined
        ? {
            usage: {
              ...(promptTokens !== undefined ? { promptTokens } : {}),
              ...(completionTokens !== undefined ? { completionTokens } : {}),
            },
          }
        : {}),
    };
  }

  /** Build the Messages request body: system separated out, text-only turns. */
  private body(req: AiRequest, stream: boolean): string {
    const systemParts: string[] = [];
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of req.messages) {
      if (m.role === 'system') {
        if (m.content) systemParts.push(m.content);
      } else if (m.role === 'user' || m.role === 'assistant') {
        messages.push({ role: m.role, content: m.content });
      }
      // 'tool' turns are ignored (tool-calling is a follow-up for this adapter).
    }

    const body: Record<string, unknown> = {
      model: req.model ?? this.defaultModel,
      max_tokens: req.maxTokens ?? this.maxTokens,
      messages,
      stream,
    };
    if (req.temperature !== undefined) body['temperature'] = req.temperature;

    // OAuth (Claude Code client) requires the identity as the first system block.
    if (this.oauthToken) {
      const blocks = [{ type: 'text', text: CLAUDE_CODE_IDENTITY }];
      for (const p of systemParts) blocks.push({ type: 'text', text: p });
      body['system'] = blocks;
    } else if (systemParts.length > 0) {
      body['system'] = systemParts.join('\n\n');
    }
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
      return `Anthropic auth failed (401)${detail ? `: ${detail}` : ''} — the key or subscription sign-in may be invalid or expired.`;
    }
    return detail ? `Anthropic /v1/messages: ${detail}` : `Anthropic /v1/messages returned ${res.status}`;
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

/** Concatenate the text of an Anthropic `content` block array. */
function collectText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    const rec = asRecord(block);
    if (rec['type'] === 'text' && typeof rec['text'] === 'string') out += rec['text'];
  }
  return out;
}
