/**
 * Renderer-side Tool Registry assembly.
 *
 * Builds the unified registry the Mission engine and the MCP & Tools view read
 * from: Orbit's own native capabilities (always present) plus any MCP servers.
 *
 * Honest status: a real MCP server (stdio/HTTP) needs a native MCP bridge — the
 * renderer can't spawn a process or open arbitrary sockets under the Tauri CSP,
 * exactly like the Ollama situation. So today we register the native catalogue
 * plus a single, clearly-labelled **in-process demo server** (a MockMcpTransport)
 * so the registry, risk/approval policy and tool-call path are all real and
 * exercisable end-to-end. When the native bridge lands, real servers register
 * through the identical `McpClient` with no change to consumers.
 */
import {
  McpClient,
  MockMcpTransport,
  ToolRegistry,
  mcpToolsToRecords,
  nativeToolRecords,
  type McpToolDescriptor,
  type ToolRecord,
} from '@orbit/tool-registry';

/** The bundled demo MCP server's id (clearly synthetic, never live data). */
export const DEMO_MCP_SERVER_ID = 'demo';

const DEMO_TOOLS: readonly McpToolDescriptor[] = [
  {
    name: 'echo',
    description: 'Echo the provided text back (demo, on-device).',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    annotations: { readOnlyHint: true, title: 'Echo' },
  },
  {
    name: 'word_count',
    description: 'Count words in the provided text (demo, on-device).',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    annotations: { readOnlyHint: true, title: 'Word count' },
  },
  {
    name: 'write_note',
    description: 'Pretend to write a note (demo — gated as a write so you can see confirmation).',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
      required: ['title'],
    },
    annotations: { title: 'Write note (demo)' },
  },
];

/** Build the demo MCP client (in-process MockMcpTransport). */
export function createDemoMcpClient(): McpClient {
  const transport = new MockMcpTransport({
    serverId: DEMO_MCP_SERVER_ID,
    name: 'Demo MCP (in-process)',
    local: true,
    tools: DEMO_TOOLS,
    onCall: (name, args) => {
      const text = String(args['text'] ?? '');
      if (name === 'echo') return text;
      if (name === 'word_count') return String(text.split(/\s+/).filter(Boolean).length);
      if (name === 'write_note') return `Demo: would write note "${String(args['title'] ?? '')}".`;
      return `mock ${name}`;
    },
  });
  return new McpClient(transport);
}

export interface BuiltRegistry {
  readonly registry: ToolRegistry;
  /** MCP clients keyed by serverId, for tool invocation + test calls. */
  readonly clients: ReadonlyMap<string, McpClient>;
}

/**
 * Assemble the registry: native tools + the demo MCP server's discovered tools.
 * Discovery is async (it talks the protocol, even to the in-process mock) so the
 * path matches a real server exactly.
 */
export async function buildToolRegistry(): Promise<BuiltRegistry> {
  const registry = new ToolRegistry();
  registry.register(nativeToolRecords());

  const clients = new Map<string, McpClient>();
  const demo = createDemoMcpClient();
  try {
    await demo.initialize();
    const tools = await demo.listTools();
    const records: ToolRecord[] = mcpToolsToRecords(DEMO_MCP_SERVER_ID, tools, {
      availability: 'available',
      health: 'healthy',
    });
    registry.register(records);
    clients.set(DEMO_MCP_SERVER_ID, demo);
  } catch {
    // A failed server must never break the registry; native tools remain.
  }

  return { registry, clients };
}
