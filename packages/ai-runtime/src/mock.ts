/**
 * MockProvider — a deterministic, fully local AI provider for tests and offline
 * development. It never reaches the network. The reply is scriptable so callers
 * can drive specific behaviour (e.g. a canned classification JSON) without a
 * real model, and streaming chunks the reply word-by-word so streaming UIs can
 * be exercised offline.
 */
import {
  AiError,
  throwIfAborted,
  type AiModelInfo,
  type AiProvider,
  type AiRequest,
  type AiResponse,
  type AiStreamChunk,
  type AiToolCall,
  type ProviderHealth,
} from './types.js';

export interface MockProviderOptions {
  /** The reply text, or a function of the request. Defaults to an echo. */
  readonly reply?: string | ((req: AiRequest) => string);
  readonly models?: readonly AiModelInfo[];
  /** Force health to report unconfigured/unreachable, for UI testing. */
  readonly status?: ProviderHealth['status'];
  /**
   * Scriptable tool calls. Returns the tool calls the model should "request"
   * for this request (empty/undefined ⇒ a normal text reply). The function sees
   * the full message history so it can return calls on the first round and a
   * text answer once the tool results are present — exercising the agent loop.
   */
  readonly toolScript?: (req: AiRequest) => readonly AiToolCall[] | undefined;
}

const DEFAULT_MODELS: readonly AiModelInfo[] = [
  { id: 'mock-small', label: 'Mock Small', contextLength: 8192 },
  { id: 'mock-large', label: 'Mock Large', contextLength: 32768, tools: true },
];

/** Last user message content, or '' when there is none. */
function lastUserMessage(req: AiRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role === 'user') return m.content;
  }
  return '';
}

export class MockProvider implements AiProvider {
  readonly id = 'mock' as const;
  readonly local = true;
  private readonly opts: MockProviderOptions;

  constructor(opts: MockProviderOptions = {}) {
    this.opts = opts;
  }

  private replyFor(req: AiRequest): string {
    const { reply } = this.opts;
    if (typeof reply === 'function') return reply(req);
    if (typeof reply === 'string') return reply;
    // Default: a deterministic, obviously-synthetic echo.
    return `Mock reply to: ${lastUserMessage(req)}`;
  }

  health(): Promise<ProviderHealth> {
    const status = this.opts.status ?? 'ready';
    return Promise.resolve({
      status,
      ...(status === 'ready' ? { models: this.opts.models ?? DEFAULT_MODELS } : {}),
    });
  }

  listModels(): Promise<readonly AiModelInfo[]> {
    return Promise.resolve(this.opts.models ?? DEFAULT_MODELS);
  }

  async complete(req: AiRequest, signal?: AbortSignal): Promise<AiResponse> {
    throwIfAborted(signal);
    // A model only emits tool calls when it was actually offered tools.
    const toolCalls = (req.tools && req.tools.length > 0 ? this.opts.toolScript?.(req) : undefined) ?? [];
    if (toolCalls.length > 0) {
      return {
        content: '',
        model: req.model ?? 'mock-small',
        provider: this.id,
        local: true,
        toolCalls,
      };
    }
    const content = this.replyFor(req);
    return {
      content,
      model: req.model ?? 'mock-small',
      provider: this.id,
      local: true,
      usage: { promptTokens: lastUserMessage(req).length, completionTokens: content.length },
    };
  }

  async stream(
    req: AiRequest,
    onChunk: (chunk: AiStreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<AiResponse> {
    throwIfAborted(signal);
    const content = this.replyFor(req);
    const tokens = content.match(/\S+\s*/g) ?? [];
    for (const token of tokens) {
      if (signal?.aborted) throw new AiError('cancelled', 'Request was cancelled');
      onChunk({ delta: token, done: false });
    }
    onChunk({ delta: '', done: true });
    return {
      content,
      model: req.model ?? 'mock-small',
      provider: this.id,
      local: true,
      usage: { promptTokens: lastUserMessage(req).length, completionTokens: content.length },
    };
  }
}
