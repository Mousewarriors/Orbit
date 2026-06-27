/**
 * Stored MCP server configuration (persisted in the settings KV under
 * `mcp.servers`).
 *
 * Two transports are supported:
 *  - **http**  — a Streamable-HTTP/SSE endpoint (`endpoint`), contacted through
 *    the native HTTP bridge. The endpoint is validated as http(s).
 *  - **stdio** — a long-lived child process (`command` + `args`, optional `cwd`)
 *    that speaks newline-delimited JSON-RPC, run through the native stdio host.
 *    This is the most common kind (and what AgentOS's Second Brain server uses).
 *
 * The kind is discriminated by which fields are present (`command` ⇒ stdio),
 * so existing http entries round-trip unchanged. No secret is ever stored here.
 */
import { isAllowedStdioMcpCommand, isPublicHttpsMcpEndpoint } from '@orbit/tool-registry';

export const MCP_SERVERS_SETTING_KEY = 'mcp.servers';

export type McpServerKind = 'http' | 'stdio';

export interface StoredMcpServer {
  readonly id: string;
  readonly name: string;
  /** http transport: the Streamable-HTTP endpoint. */
  readonly endpoint?: string;
  /** stdio transport: the executable to run. */
  readonly command?: string;
  /** stdio transport: arguments passed to the command. */
  readonly args?: readonly string[];
  /** stdio transport: optional working directory. */
  readonly cwd?: string;
  readonly enabled: boolean;
}

export function serverKind(s: Pick<StoredMcpServer, 'command'>): McpServerKind {
  return s.command && s.command.trim() ? 'stdio' : 'http';
}

/** Parse the stored JSON into a clean list, dropping malformed/invalid entries. */
export function parseMcpServers(raw: string | null | undefined): StoredMcpServer[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: StoredMcpServer[] = [];
  for (const item of parsed) {
    const o = item as Record<string, unknown> | null;
    if (!o) continue;
    const id = typeof o['id'] === 'string' ? o['id'] : '';
    const name = typeof o['name'] === 'string' ? o['name'] : '';
    if (!id || !name || seen.has(id)) continue;
    const enabled = o['enabled'] !== false;
    const command = typeof o['command'] === 'string' ? o['command'].trim() : '';

    if (command) {
      const args = Array.isArray(o['args'])
        ? o['args'].filter((a): a is string => typeof a === 'string')
        : [];
      const cwd = typeof o['cwd'] === 'string' && o['cwd'].trim() ? o['cwd'] : undefined;
      if (!isAllowedStdioMcpCommand(command, args, cwd)) continue;
      // stdio server
      const base = { id, name, command, args, enabled };
      out.push(cwd ? { ...base, cwd } : base);
      seen.add(id);
    } else {
      // http server
      const endpoint = typeof o['endpoint'] === 'string' ? o['endpoint'] : '';
      if (!isPublicHttpsMcpEndpoint(endpoint)) continue;
      out.push({ id, name, endpoint, enabled });
      seen.add(id);
    }
  }
  return out;
}

export function serializeMcpServers(list: readonly StoredMcpServer[]): string {
  return JSON.stringify(list);
}

/** A candidate for validation — either an http endpoint or a stdio command. */
export interface McpServerCandidate {
  readonly id: string;
  readonly name: string;
  readonly endpoint?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
}

/** Validate a candidate server, returning an error message or null. */
export function validateServer(
  candidate: McpServerCandidate,
  existing: readonly StoredMcpServer[],
): string | null {
  if (!/^[a-z0-9][a-z0-9._-]{0,40}$/i.test(candidate.id)) {
    return 'Id must be 1–41 chars: letters, digits, . _ -';
  }
  if (existing.some((s) => s.id === candidate.id)) return 'A server with that id already exists';
  if (!candidate.name.trim()) return 'Name is required';
  if (candidate.command && candidate.command.trim()) {
    return isAllowedStdioMcpCommand(candidate.command, candidate.args ?? [], candidate.cwd)
      ? null
      : 'Stdio MCP must use node with an absolute .js/.mjs/.cjs server script inside its working directory';
  }
  if (!isPublicHttpsMcpEndpoint(candidate.endpoint ?? '')) {
    return 'Endpoint must be a public https URL';
  }
  return null;
}

/** Add/replace a server by id. */
export function upsertServer(
  list: readonly StoredMcpServer[],
  server: StoredMcpServer,
): StoredMcpServer[] {
  const without = list.filter((s) => s.id !== server.id);
  return [...without, server];
}

export function removeServer(list: readonly StoredMcpServer[], id: string): StoredMcpServer[] {
  return list.filter((s) => s.id !== id);
}
