/**
 * MockMcpTransport — a fully in-memory MCP server for offline use + tests.
 *
 * It is *clearly synthetic*: it answers the JSON-RPC methods from a scripted
 * set of tools/resources/prompts and a tool handler. This lets the entire Tool
 * Registry + Mission engine be exercised end-to-end with no real server, the
 * same way `MockProvider` lets the AI runtime run offline. A real stdio/HTTP
 * transport (needing a Rust MCP bridge — see AI_AGENT_MODE.md) drops in behind
 * the identical `McpTransport` interface without changing any consumer.
 */
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpPromptDescriptor,
  type McpResourceDescriptor,
  type McpToolDescriptor,
  type McpTransport,
  MCP_PROTOCOL_VERSION,
} from './protocol.js';

export interface MockMcpConfig {
  readonly serverId: string;
  readonly name?: string;
  readonly local?: boolean;
  readonly tools?: readonly McpToolDescriptor[];
  readonly resources?: readonly McpResourceDescriptor[];
  readonly prompts?: readonly McpPromptDescriptor[];
  /**
   * Handle a `tools/call`. Return text (success) or throw to simulate a tool
   * error. If omitted, every call echoes its arguments.
   */
  readonly onCall?: (name: string, args: Readonly<Record<string, unknown>>) => string;
}

export class MockMcpTransport implements McpTransport {
  readonly serverId: string;
  readonly local: boolean;
  private readonly cfg: MockMcpConfig;

  constructor(cfg: MockMcpConfig) {
    this.cfg = cfg;
    this.serverId = cfg.serverId;
    this.local = cfg.local ?? true;
  }

  send(request: JsonRpcRequest, signal?: AbortSignal): Promise<JsonRpcResponse> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: request.id, result });
    switch (request.method) {
      case 'initialize':
        return Promise.resolve(
          ok({
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverInfo: { name: this.cfg.name ?? this.serverId, version: '0.1.0-mock' },
            capabilities: { tools: {}, resources: {}, prompts: {} },
          }),
        );
      case 'tools/list':
        return Promise.resolve(ok({ tools: this.cfg.tools ?? [] }));
      case 'resources/list':
        return Promise.resolve(ok({ resources: this.cfg.resources ?? [] }));
      case 'prompts/list':
        return Promise.resolve(ok({ prompts: this.cfg.prompts ?? [] }));
      case 'tools/call': {
        const name = String(request.params?.['name'] ?? '');
        const args = (request.params?.['arguments'] as Record<string, unknown>) ?? {};
        try {
          const text = this.cfg.onCall
            ? this.cfg.onCall(name, args)
            : `mock ${name}(${JSON.stringify(args)})`;
          return Promise.resolve(ok({ content: [{ type: 'text', text }], isError: false }));
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          return Promise.resolve(ok({ content: [{ type: 'text', text }], isError: true }));
        }
      }
      default:
        return Promise.resolve({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        });
    }
  }
}
