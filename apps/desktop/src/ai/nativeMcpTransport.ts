/**
 * An MCP transport over the native HTTP bridge (Streamable HTTP / JSON-RPC).
 *
 * This lights up real HTTP MCP servers: each `send` POSTs the JSON-RPC request
 * through Rust and parses the response, which an MCP server may return either as
 * a plain JSON body or as a single Server-Sent-Events `data:` frame. Transport
 * failures reject (the McpClient maps them to a typed `unreachable` error);
 * protocol errors come back inside the JSON-RPC `error` field.
 */
import type { JsonRpcRequest, JsonRpcResponse, McpTransport } from '@orbit/tool-registry';
import * as native from '../native.js';

let requestCounter = 0;

/** Parse an MCP HTTP response body (plain JSON or an SSE `data:` frame). */
export function parseJsonRpcBody(body: string): JsonRpcResponse | null {
  const text = body.trim();
  if (!text) return null;
  const direct = tryParse(text);
  if (direct) return direct;
  // SSE: concatenate the JSON from `data:` lines.
  const dataLines = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  for (const line of dataLines) {
    const parsed = tryParse(line);
    if (parsed) return parsed;
  }
  return null;
}

function tryParse(text: string): JsonRpcResponse | null {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (obj && obj['jsonrpc'] === '2.0') return obj as unknown as JsonRpcResponse;
  } catch {
    /* not JSON */
  }
  return null;
}

export class NativeHttpMcpTransport implements McpTransport {
  readonly local = false;

  constructor(
    readonly serverId: string,
    private readonly endpoint: string,
  ) {}

  async send(request: JsonRpcRequest, signal?: AbortSignal): Promise<JsonRpcResponse> {
    if (signal?.aborted) throw new Error('aborted');
    const requestId = `mcp-http-${++requestCounter}-${Date.now()}`;
    const cancel = () => void native.httpMcpCancel(requestId);
    signal?.addEventListener('abort', cancel, { once: true });
    let res: Awaited<ReturnType<typeof native.httpMcpRequest>>;
    try {
      res = await native.httpMcpRequest(
        'POST',
        this.endpoint,
        { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        JSON.stringify(request),
        requestId,
      );
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    if (res.status < 200 || res.status >= 300) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: res.status, message: `HTTP ${res.status}` },
      };
    }
    const parsed = parseJsonRpcBody(res.body);
    if (parsed) return parsed;
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32700, message: 'Invalid JSON-RPC response from server' },
    };
  }
}
