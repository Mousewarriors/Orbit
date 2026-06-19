/**
 * One-click AgentOS connection.
 *
 * AgentOS ships an MCP server (`server/mcp/server.js`) that exposes the Second
 * Brain over stdio JSON-RPC: search the vault, ask grounded questions, list/save
 * memories, route tasks, create handoffs, log decisions, and read today's battle
 * plan. Connecting it makes those eight tools appear in Orbit's Tool Registry —
 * usable from the MCP & Tools view and (with tool-use) from Chat/Quick AI.
 *
 * We run it as a stdio MCP server (`node <dir>/server/mcp/server.js`) through the
 * native stdio host. The directory is configurable; this is the only place the
 * default install path lives.
 */
import type { StoredMcpServer } from './mcpServers.js';

/** Default AgentOS install directory on this machine. */
export const DEFAULT_AGENTOS_DIR = 'C:/AgentOS';

/** Stable server id used for the AgentOS connection. */
export const AGENTOS_SERVER_ID = 'agentos';

/** Normalise a user-entered directory: forward slashes, no trailing slash. */
export function normaliseDir(dir: string): string {
  return dir.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Build the stdio MCP server config for an AgentOS install directory. */
export function agentosMcpServer(dir: string = DEFAULT_AGENTOS_DIR): StoredMcpServer {
  const base = normaliseDir(dir) || DEFAULT_AGENTOS_DIR;
  return {
    id: AGENTOS_SERVER_ID,
    name: 'AgentOS Second Brain',
    command: 'node',
    args: [`${base}/server/mcp/server.js`],
    cwd: base,
    enabled: true,
  };
}
