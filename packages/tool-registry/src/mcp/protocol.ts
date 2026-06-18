/**
 * Minimal Model Context Protocol (MCP) framing.
 *
 * MCP is JSON-RPC 2.0 over a transport (stdio or HTTP/SSE). This module defines
 * the request/response envelope and the handful of method names Orbit uses for
 * discovery + invocation. We deliberately model only what we need; the
 * *transport* is injected (see `McpTransport`) so the client is fully testable
 * against an in-memory server and a real stdio/HTTP bridge can be supplied later
 * without touching this logic.
 */

/** MCP protocol revision Orbit advertises. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** The JSON-RPC methods Orbit issues. */
export type McpMethod =
  | 'initialize'
  | 'tools/list'
  | 'tools/call'
  | 'resources/list'
  | 'resources/read'
  | 'prompts/list'
  | 'prompts/get';

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: McpMethod;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

/**
 * A transport carries one JSON-RPC request to a server and resolves its
 * response. Implementations must honour `signal` for cancellation and must not
 * throw for protocol-level errors — those belong in `response.error`. They may
 * reject only for transport failures (connection lost, timeout).
 */
export interface McpTransport {
  /** A stable identifier for the backing server (for ids + diagnostics). */
  readonly serverId: string;
  /** Whether this transport keeps processing on-device (stdio) or leaves it. */
  readonly local: boolean;
  send(request: JsonRpcRequest, signal?: AbortSignal): Promise<JsonRpcResponse>;
  /** Optional teardown for long-lived transports. */
  close?(): Promise<void>;
}

/** An MCP tool as returned by `tools/list`. */
export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  /**
   * Behaviour hints (MCP `annotations`). Used to infer side effects/risk.
   * `readOnlyHint` → no writes; `destructiveHint` → may delete/overwrite;
   * `openWorldHint` → talks to external systems (network).
   */
  readonly annotations?: {
    readonly title?: string;
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
}

export interface McpResourceDescriptor {
  readonly uri: string;
  readonly name?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpPromptDescriptor {
  readonly name: string;
  readonly description?: string;
}

export interface McpServerInfo {
  readonly name: string;
  readonly version: string;
  readonly protocolVersion: string;
  readonly capabilities: Readonly<Record<string, unknown>>;
}
