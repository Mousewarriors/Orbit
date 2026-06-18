/**
 * MCP client — typed discovery + invocation over an injected transport.
 *
 * Responsibilities (spec §13.1): initialise, discover tools/resources/prompts,
 * invoke approved tools, support cancellation, *bound* tool output, and isolate
 * failures (a misbehaving server yields a typed error, never an exception that
 * escapes into the caller). It does no permission checking itself — the Tool
 * Registry + Approval Centre own that; the client only moves bytes safely.
 */
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpMethod,
  type McpPromptDescriptor,
  type McpResourceDescriptor,
  type McpServerInfo,
  type McpToolDescriptor,
  type McpTransport,
  MCP_PROTOCOL_VERSION,
} from './protocol.js';

/** Typed MCP failure with a coarse cause the UI can branch on. */
export class McpError extends Error {
  constructor(
    message: string,
    readonly code: 'unreachable' | 'protocol' | 'cancelled' | 'bad_response' | 'tool_error',
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/** Default ceiling for a single tool's textual output, in characters. */
export const DEFAULT_OUTPUT_BOUND = 16_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Flatten an MCP `tools/call` content array (text/blocks) into a single bounded
 * string. Non-text blocks are summarised rather than dumped, and the whole is
 * clamped so a hostile server cannot flood the renderer.
 */
export function flattenContent(
  result: unknown,
  bound = DEFAULT_OUTPUT_BOUND,
): { text: string; truncated: boolean; isError: boolean } {
  const record = asRecord(result);
  const isError = record?.['isError'] === true;
  const blocks = asArray(record?.['content']);
  const parts: string[] = [];
  for (const block of blocks) {
    const b = asRecord(block);
    if (!b) continue;
    if (b['type'] === 'text' && typeof b['text'] === 'string') {
      parts.push(b['text']);
    } else if (typeof b['type'] === 'string') {
      parts.push(`[${b['type']} content]`);
    }
  }
  const joined = parts.join('\n').trim();
  if (joined.length <= bound) return { text: joined, truncated: false, isError };
  return { text: joined.slice(0, bound), truncated: true, isError };
}

export class McpClient {
  private nextId = 1;
  private info: McpServerInfo | null = null;

  constructor(
    private readonly transport: McpTransport,
    private readonly outputBound = DEFAULT_OUTPUT_BOUND,
  ) {}

  get serverId(): string {
    return this.transport.serverId;
  }

  get local(): boolean {
    return this.transport.local;
  }

  get serverInfo(): McpServerInfo | null {
    return this.info;
  }

  private async call(
    method: McpMethod,
    params: Record<string, unknown> | undefined,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const request: JsonRpcRequest = params
      ? { jsonrpc: '2.0', id: this.nextId++, method, params }
      : { jsonrpc: '2.0', id: this.nextId++, method };
    let response: JsonRpcResponse;
    try {
      response = await this.transport.send(request, signal);
    } catch (err) {
      if (signal?.aborted) throw new McpError('Request cancelled', 'cancelled');
      throw new McpError(`MCP server unreachable: ${stringifyErr(err)}`, 'unreachable', err);
    }
    if (response.error) {
      throw new McpError(response.error.message, 'protocol', response.error.data);
    }
    return response.result;
  }

  /** Handshake: returns server identity + capabilities, cached for later reads. */
  async initialize(signal?: AbortSignal): Promise<McpServerInfo> {
    const result = await this.call(
      'initialize',
      { protocolVersion: MCP_PROTOCOL_VERSION, clientInfo: { name: 'orbit', version: '0.1.0' } },
      signal,
    );
    const record = asRecord(result);
    const serverInfo = asRecord(record?.['serverInfo']);
    this.info = {
      name: stringOr(serverInfo?.['name'], this.transport.serverId),
      version: stringOr(serverInfo?.['version'], '0.0.0'),
      protocolVersion: stringOr(record?.['protocolVersion'], MCP_PROTOCOL_VERSION),
      capabilities: asRecord(record?.['capabilities']) ?? {},
    };
    return this.info;
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]> {
    const result = await this.call('tools/list', undefined, signal);
    return asArray(asRecord(result)?.['tools']).flatMap((t) => {
      const record = asRecord(t);
      if (!record || typeof record['name'] !== 'string') return [];
      return [record as unknown as McpToolDescriptor];
    });
  }

  async listResources(signal?: AbortSignal): Promise<McpResourceDescriptor[]> {
    const result = await this.call('resources/list', undefined, signal);
    return asArray(asRecord(result)?.['resources']).flatMap((r) => {
      const record = asRecord(r);
      if (!record || typeof record['uri'] !== 'string') return [];
      return [record as unknown as McpResourceDescriptor];
    });
  }

  async listPrompts(signal?: AbortSignal): Promise<McpPromptDescriptor[]> {
    const result = await this.call('prompts/list', undefined, signal);
    return asArray(asRecord(result)?.['prompts']).flatMap((p) => {
      const record = asRecord(p);
      if (!record || typeof record['name'] !== 'string') return [];
      return [record as unknown as McpPromptDescriptor];
    });
  }

  /**
   * Invoke a tool with arguments. Returns bounded output. A tool that reports
   * `isError` resolves with `ok:false` (it is a tool-level failure, not a
   * transport failure) so the caller can show it without a try/catch.
   */
  async callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; content: string; truncated: boolean }> {
    const result = await this.call('tools/call', { name, arguments: args }, signal);
    const { text, truncated, isError } = flattenContent(result, this.outputBound);
    return { ok: !isError, content: text, truncated };
  }
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function stringifyErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
