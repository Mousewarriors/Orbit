import { describe, expect, it } from 'vitest';
import { parseJsonRpcLine } from './nativeStdioMcpTransport.js';

describe('parseJsonRpcLine', () => {
  it('parses a JSON-RPC 2.0 response line', () => {
    const r = parseJsonRpcLine('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}');
    expect(r?.id).toBe(2);
    expect((r?.result as { tools: unknown[] }).tools).toEqual([]);
  });

  it('rejects non-2.0 / non-JSON / empty lines', () => {
    expect(parseJsonRpcLine('')).toBeNull();
    expect(parseJsonRpcLine('   ')).toBeNull();
    expect(parseJsonRpcLine('not json')).toBeNull();
    expect(parseJsonRpcLine('{"id":1}')).toBeNull(); // missing jsonrpc
  });

  it('tolerates surrounding whitespace', () => {
    const r = parseJsonRpcLine('  {"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"x"}}  \n');
    expect(r?.error?.message).toBe('x');
  });
});
