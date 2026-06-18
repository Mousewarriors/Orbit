import { describe, expect, it } from 'vitest';
import { parseJsonRpcBody } from './nativeMcpTransport.js';

describe('parseJsonRpcBody', () => {
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
});
