/**
 * OllamaProvider — a local-model adapter for a running Ollama endpoint.
 *
 * Processing stays on-device (`local: true`). The provider takes an injected
 * `fetch` so it is fully testable without a network, and never pulls models
 * automatically (download consent is a separate, explicit flow). It maps Ollama
 * errors to typed `AiError`s and parses streaming NDJSON via web streams.
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

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  readonly body?: ReadableStream<Uint8Array> | null;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export interface OllamaProviderOptions {
  /** Base URL of the Ollama server. */
  readonly baseUrl?: string;
  /** Injected fetch (defaults to the global). */
  readonly fetch?: FetchLike;
  /** Default model when a request omits one. */
  readonly defaultModel?: string;
}

const DEFAULT_BASE = 'http://127.0.0.1:11434';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export class OllamaProvider implements AiProvider {
  readonly id = 'ollama' as const;
  readonly local = true;
  private readonly base: string;
  private readonly fetch: FetchLike;
  private readonly defaultModel: string;

  constructor(opts: OllamaProviderOptions = {}) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new AiError('not_configured', 'No fetch implementation available');
    this.fetch = f;
    this.defaultModel = opts.defaultModel ?? 'llama3.1';
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
    const res = await this.request('GET', '/api/tags', undefined, signal);
    if (!res.ok) throw new AiError('unreachable', `Ollama /api/tags returned ${res.status}`);
    const body = asRecord(await res.json());
    const models = Array.isArray(body['models']) ? body['models'] : [];
    return models.flatMap((m): AiModelInfo[] => {
      const rec = asRecord(m);
      const id = typeof rec['name'] === 'string' ? rec['name'] : null;
      if (!id) return [];
      const details = asRecord(rec['details']);
      const families = Array.isArray(details['families']) ? details['families'] : [];
      const info: AiModelInfo = {
        id,
        label: id,
        vision: families.includes('clip'),
      };
      return [info];
    });
  }

  async complete(req: AiRequest, signal?: AbortSignal): Promise<AiResponse> {
    throwIfAborted(signal);
    const res = await this.request('POST', '/api/chat', this.chatBody(req, false), signal);
    if (!res.ok) throw new AiError('bad_response', `Ollama /api/chat returned ${res.status}`);
    const body = asRecord(await res.json());
    const message = asRecord(body['message']);
    const content = typeof message['content'] === 'string' ? message['content'] : '';
    return {
      content,
      model: typeof body['model'] === 'string' ? body['model'] : req.model ?? this.defaultModel,
      provider: this.id,
      local: true,
      usage: {
        ...(numberOr(body['prompt_eval_count']) !== undefined
          ? { promptTokens: numberOr(body['prompt_eval_count'])! }
          : {}),
        ...(numberOr(body['eval_count']) !== undefined
          ? { completionTokens: numberOr(body['eval_count'])! }
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
    const res = await this.request('POST', '/api/chat', this.chatBody(req, true), signal);
    if (!res.ok || !res.body) {
      throw new AiError('bad_response', `Ollama stream returned ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let model = req.model ?? this.defaultModel;
    let usage: AiResponse['usage'];

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const obj = asRecord(JSON.parse(trimmed));
      const message = asRecord(obj['message']);
      const delta = typeof message['content'] === 'string' ? message['content'] : '';
      if (delta) {
        content += delta;
        onChunk({ delta, done: false });
      }
      if (typeof obj['model'] === 'string') model = obj['model'];
      if (obj['done'] === true) {
        const prompt = numberOr(obj['prompt_eval_count']);
        const completion = numberOr(obj['eval_count']);
        usage = {
          ...(prompt !== undefined ? { promptTokens: prompt } : {}),
          ...(completion !== undefined ? { completionTokens: completion } : {}),
        };
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
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) handleLine(buffer);
    onChunk({ delta: '', done: true });
    return { content, model, provider: this.id, local: true, ...(usage ? { usage } : {}) };
  }

  private chatBody(req: AiRequest, stream: boolean): string {
    const body: Record<string, unknown> = {
      model: req.model ?? this.defaultModel,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
    };
    if (req.json) body['format'] = 'json';
    const options: Record<string, unknown> = {};
    if (req.temperature !== undefined) options['temperature'] = req.temperature;
    if (req.maxTokens !== undefined) options['num_predict'] = req.maxTokens;
    if (Object.keys(options).length > 0) body['options'] = options;
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
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      if (signal?.aborted) throw new AiError('cancelled', 'Request was cancelled');
      throw new AiError('unreachable', e instanceof Error ? e.message : String(e));
    }
  }
}
