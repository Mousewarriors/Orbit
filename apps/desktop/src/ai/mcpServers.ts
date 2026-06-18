/**
 * Stored MCP server configuration (persisted in the settings KV under
 * `mcp.servers`). Only HTTP servers are supported by the native bridge today —
 * stdio (process-spawn) MCP is a later slice. No secret is stored here; an
 * endpoint is validated as http(s) before it is ever contacted.
 */
import { isHttpUrl } from '@orbit/tool-registry';

export const MCP_SERVERS_SETTING_KEY = 'mcp.servers';

export interface StoredMcpServer {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string;
  readonly enabled: boolean;
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
    const endpoint = typeof o['endpoint'] === 'string' ? o['endpoint'] : '';
    if (!id || !name || !isHttpUrl(endpoint) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, endpoint, enabled: o['enabled'] !== false });
  }
  return out;
}

export function serializeMcpServers(list: readonly StoredMcpServer[]): string {
  return JSON.stringify(list);
}

/** Validate a candidate server, returning an error message or null. */
export function validateServer(
  candidate: { id: string; name: string; endpoint: string },
  existing: readonly StoredMcpServer[],
): string | null {
  if (!/^[a-z0-9][a-z0-9._-]{0,40}$/i.test(candidate.id)) {
    return 'Id must be 1–41 chars: letters, digits, . _ -';
  }
  if (existing.some((s) => s.id === candidate.id)) return 'A server with that id already exists';
  if (!candidate.name.trim()) return 'Name is required';
  if (!isHttpUrl(candidate.endpoint)) return 'Endpoint must be an http(s) URL';
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
