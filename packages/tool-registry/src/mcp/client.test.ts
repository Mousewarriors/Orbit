import { describe, expect, it } from 'vitest';
import { McpClient, McpError, flattenContent } from './client.js';
import { MockMcpTransport } from './mockTransport.js';
import type { JsonRpcRequest, JsonRpcResponse, McpTransport } from './protocol.js';

function makeClient() {
  const transport = new MockMcpTransport({
    serverId: 'fs',
    name: 'Filesystem',
    tools: [
      { name: 'read_file', description: 'Read a file', annotations: { readOnlyHint: true } },
      { name: 'write_file', description: 'Write a file' },
    ],
    resources: [{ uri: 'file:///notes.md', name: 'notes' }],
    prompts: [{ name: 'summarise' }],
    onCall: (name, args) => {
      if (name === 'read_file') return `contents of ${String(args['path'])}`;
      throw new Error('boom');
    },
  });
  return new McpClient(transport);
}

describe('McpClient', () => {
  it('initialises and reports server info', async () => {
    const client = makeClient();
    const info = await client.initialize();
    expect(info.name).toBe('Filesystem');
    expect(client.serverId).toBe('fs');
    expect(client.local).toBe(true);
  });

  it('discovers tools, resources and prompts', async () => {
    const client = makeClient();
    expect((await client.listTools()).map((t) => t.name)).toEqual(['read_file', 'write_file']);
    expect((await client.listResources())[0]?.uri).toBe('file:///notes.md');
    expect((await client.listPrompts())[0]?.name).toBe('summarise');
  });

  it('invokes a tool and returns bounded output', async () => {
    const client = makeClient();
    const result = await client.callTool('read_file', { path: '/a.txt' });
    expect(result.ok).toBe(true);
    expect(result.content).toBe('contents of /a.txt');
  });

  it('reports a tool error as ok:false, not an exception', async () => {
    const client = makeClient();
    const result = await client.callTool('write_file', {});
    expect(result.ok).toBe(false);
    expect(result.content).toContain('boom');
  });

  it('maps a transport rejection to an unreachable McpError', async () => {
    const transport: McpTransport = {
      serverId: 'down',
      local: false,
      send: () => Promise.reject(new Error('ECONNREFUSED')),
    };
    const client = new McpClient(transport);
    await expect(client.listTools()).rejects.toBeInstanceOf(McpError);
    await expect(client.listTools()).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('surfaces a JSON-RPC protocol error', async () => {
    const transport: McpTransport = {
      serverId: 'x',
      local: true,
      send: (req: JsonRpcRequest): Promise<JsonRpcResponse> =>
        Promise.resolve({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'nope' } }),
    };
    const client = new McpClient(transport);
    await expect(client.listTools()).rejects.toMatchObject({ code: 'protocol', message: 'nope' });
  });

  it('honours cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = makeClient();
    await expect(client.listTools(controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('flattenContent', () => {
  it('joins text blocks and clamps to the bound', () => {
    const { text, truncated } = flattenContent(
      { content: [{ type: 'text', text: 'a'.repeat(100) }] },
      10,
    );
    expect(text).toHaveLength(10);
    expect(truncated).toBe(true);
  });

  it('summarises non-text blocks and detects isError', () => {
    const { text, isError } = flattenContent({
      isError: true,
      content: [{ type: 'image', data: '...' }],
    });
    expect(text).toBe('[image content]');
    expect(isError).toBe(true);
  });
});
