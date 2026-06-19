/**
 * @orbit/ai-runtime — provider-agnostic contracts for AI completion.
 *
 * This is the foundation the later Quick AI / Chat / mission surfaces build on.
 * It deliberately does NOT decide which model is best (the Model Intelligence
 * Gateway owns routing) and never executes anything on the host: a provider just
 * turns messages into text (optionally streamed), reports its models/health, and
 * carries usage + a clear local-vs-remote flag so the UI can show where data went.
 */

export type AiRole = 'system' | 'user' | 'assistant' | 'tool';

/** A tool call the model wants to make (assistant turn). */
export interface AiToolCall {
  /** Provider-supplied id (OpenAI); optional for providers that key by name. */
  readonly id?: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface AiMessage {
  readonly role: AiRole;
  readonly content: string;
  /** assistant turn: the tool calls it requested. */
  readonly toolCalls?: readonly AiToolCall[];
  /** tool turn: which call this result answers (id and/or name). */
  readonly toolCallId?: string;
  readonly toolName?: string;
}

/** A tool the model may call: name + description + JSON-schema parameters. */
export interface AiToolDef {
  readonly name: string;
  readonly description?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** Known provider adapters. Auto mode routes through the AgentOS Gateway. */
export type AiProviderId =
  | 'mock'
  | 'ollama'
  | 'agentos-auto'
  | 'openai-compat'
  | 'anthropic';

export interface AiUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface AiModelInfo {
  readonly id: string;
  readonly label?: string;
  readonly contextLength?: number;
  readonly vision?: boolean;
  readonly tools?: boolean;
}

export interface AiRequest {
  /** Explicit model id; the provider uses its default when omitted. */
  readonly model?: string;
  readonly messages: readonly AiMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Best-effort hint that the response must be valid JSON. */
  readonly json?: boolean;
  /** Tools the model may call this turn (function-calling). */
  readonly tools?: readonly AiToolDef[];
}

export interface AiResponse {
  readonly content: string;
  readonly model: string;
  readonly provider: AiProviderId;
  readonly usage?: AiUsage;
  /** True when processing stayed on-device (no data left the machine). */
  readonly local: boolean;
  /** Tool calls the model requested instead of (or alongside) a final answer. */
  readonly toolCalls?: readonly AiToolCall[];
}

export interface AiStreamChunk {
  /** Incremental text since the previous chunk. */
  readonly delta: string;
  readonly done: boolean;
}

export type ProviderStatus = 'ready' | 'unreachable' | 'unconfigured';

export interface ProviderHealth {
  readonly status: ProviderStatus;
  readonly detail?: string;
  readonly models?: readonly AiModelInfo[];
}

export type AiErrorCode =
  | 'cancelled'
  | 'unreachable'
  | 'bad_response'
  | 'not_configured'
  | 'unsupported';

/** A typed AI failure so callers can branch on cause (e.g. cancellation). */
export class AiError extends Error {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

/**
 * A provider turns a request into a completion. Adapters handle auth, model
 * discovery, streaming and error mapping — never model *selection* in Auto mode.
 */
export interface AiProvider {
  readonly id: AiProviderId;
  /** Whether processing stays on-device (true for a local Ollama endpoint). */
  readonly local: boolean;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  listModels(signal?: AbortSignal): Promise<readonly AiModelInfo[]>;
  complete(req: AiRequest, signal?: AbortSignal): Promise<AiResponse>;
  /** Stream deltas via `onChunk`; resolves with the fully assembled response. */
  stream(
    req: AiRequest,
    onChunk: (chunk: AiStreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<AiResponse>;
}

/** Throw a typed cancellation error if the signal is already aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AiError('cancelled', 'Request was cancelled');
}
