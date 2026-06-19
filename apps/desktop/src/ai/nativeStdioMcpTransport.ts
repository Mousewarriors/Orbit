/**
 * An MCP transport over the native stdio host (`mcp_stdio_*` commands).
 *
 * This lights up real stdio MCP servers — the most common kind, and what
 * AgentOS's Second Brain server (`node …/server/mcp/server.js`) speaks. The
 * connection (a long-lived child process) is opened lazily on the first `send`
 * and torn down by `close`. Each `send` exchanges exactly one JSON-RPC line.
 * Processing stays on-device (`local = true`).
 */
import type { JsonRpcRequest, JsonRpcResponse, McpTransport } from '@orbit/tool-registry';
import * as native from '../native.js';

/** Parse a single JSON-RPC response line; null if it isn't a 2.0 envelope. */
export function parseJsonRpcLine(line: string): JsonRpcResponse | null {
  const text = line.trim();
  if (!text) return null;
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (obj && obj['jsonrpc'] === '2.0') return obj as unknown as JsonRpcResponse;
  } catch {
    /* not JSON */
  }
  return null;
}

export class NativeStdioMcpTransport implements McpTransport {
  readonly local = true;
  private opened = false;
  private opening: Promise<void> | null = null;

  constructor(
    readonly serverId: string,
    private readonly command: string,
    private readonly args: readonly string[],
    private readonly cwd?: string | null,
  ) {}

  private async ensureOpen(): Promise<void> {
    if (this.opened) return;
    if (!this.opening) {
      this.opening = native
        .mcpStdioOpen(this.serverId, this.command, [...this.args], this.cwd ?? null)
        .then(() => {
          this.opened = true;
        })
        .finally(() => {
          this.opening = null;
        });
    }
    return this.opening;
  }

  async send(request: JsonRpcRequest, signal?: AbortSignal): Promise<JsonRpcResponse> {
    if (signal?.aborted) throw new Error('aborted');
    await this.ensureOpen();
    const line = await native.mcpStdioRequest(this.serverId, JSON.stringify(request));
    const parsed = parseJsonRpcLine(line);
    if (parsed) return parsed;
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32700, message: 'Invalid JSON-RPC response from server' },
    };
  }

  async close(): Promise<void> {
    if (this.opened || this.opening) {
      this.opened = false;
      this.opening = null;
      await native.mcpStdioClose(this.serverId);
    }
  }
}
