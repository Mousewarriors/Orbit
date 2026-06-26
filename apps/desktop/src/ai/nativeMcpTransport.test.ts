import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as native from '../native.js';
import { NativeHttpMcpTransport, parseJsonRpcBody } from './nativeMcpTransport.js';

vi.mock('../native.js', () => ({
  httpMcpRequest: vi.fn(),
  httpMcpCancel: vi.fn(),
}));

const httpMcpRequest = vi.mocked(native.httpMcpRequest);
const httpMcpCancel = vi.mocked(native.httpMcpCancel);

describe('parseJsonRpcBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a plain JSON-RPC body', () => {
    const r = parseJsonRpcBody('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}');
    expect(r?.id).toBe(1);
    expect((r?.result as { tools: unknown[] }).tools).toEqual([]);
  });

  it('parses a JSON-RPC body delivered as an SSE data frame', () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n';
    const r = parseJsonRpcBody(sse);
    expect(r?.id).toBe(2);
  });

  it('returns null for a non-JSON-RPC or empty body', () => {
    expect(parseJsonRpcBody('')).toBeNull();
    expect(parseJsonRpcBody('hello')).toBeNull();
    expect(parseJsonRpcBody('{"foo":1}')).toBeNull();
  });

  it('sends HTTP MCP requests with a cancellable native request id', async () => {
    httpMcpRequest.mockResolvedValue({
      status: 200,
      body: '{"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
    });
    const transport = new NativeHttpMcpTransport('srv', 'https://mcp.example/rpc');
    const response = await transport.send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    expect(response.id).toBe(7);
    expect(httpMcpRequest).toHaveBeenCalledWith(
      'POST',
      'https://mcp.example/rpc',
      { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      '{"jsonrpc":"2.0","id":7,"method":"tools/list"}',
      expect.stringMatching(/^mcp-http-/),
    );
  });

  it('cancels the native HTTP MCP request when the signal aborts', () => {
    httpMcpRequest.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const transport = new NativeHttpMcpTransport('srv', 'https://mcp.example/rpc');
    void transport.send({ jsonrpc: '2.0', id: 8, method: 'tools/list' }, controller.signal);
    const requestId = httpMcpRequest.mock.calls[0]?.[4];
    controller.abort();
    expect(httpMcpCancel).toHaveBeenCalledWith(requestId);
  });

  it('rejects pre-aborted requests before native side effects', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = new NativeHttpMcpTransport('srv', 'https://mcp.example/rpc');
    await expect(
      transport.send({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, controller.signal),
    ).rejects.toThrow(/aborted/);
    expect(httpMcpRequest).not.toHaveBeenCalled();
  });
});
