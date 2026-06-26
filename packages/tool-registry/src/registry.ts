/**
 * The unified Tool Registry.
 *
 * One bounded, in-memory set of `ToolRecord`s merged from every source (native,
 * Relay, AgentOS, extensions, MCP, AI-provider tools). It is the single place
 * the Mission engine and Approval Centre look up what can be invoked, how risky
 * it is, and whether it's in scope for the active project. Pure + deterministic:
 * registration is idempotent by id, queries never mutate.
 */
import type { ToolHealth, ToolRecord, ToolRisk, ToolSource } from './types.js';

/** Hard cap so a noisy MCP server can't unbound the registry. */
export const MAX_TOOLS = 2000;
export const TOOL_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const VALID_RISKS = new Set<ToolRisk>(['safe', 'low', 'medium', 'high', 'critical']);
const VALID_HEALTH = new Set<ToolHealth>(['healthy', 'degraded', 'unhealthy', 'unknown']);

export function isValidToolRecord(record: ToolRecord): boolean {
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    TOOL_VERSION_PATTERN.test(record.version) &&
    typeof record.name === 'string' &&
    record.name.length > 0 &&
    typeof record.title === 'string' &&
    typeof record.description === 'string' &&
    record.inputSchema?.type === 'object' &&
    VALID_RISKS.has(record.risk) &&
    VALID_HEALTH.has(record.health)
  );
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolRecord>();

  /** Register/replace records by id. Later registration of an id wins. */
  register(records: readonly ToolRecord[]): void {
    for (const record of records) {
      if (!isValidToolRecord(record)) continue;
      if (this.tools.size >= MAX_TOOLS && !this.tools.has(record.id)) continue;
      this.tools.set(record.id, record);
    }
  }

  /** Remove every tool contributed by a given source/server (e.g. on disable). */
  removeServer(serverId: string): void {
    for (const [id, record] of this.tools) {
      if (record.serverId === serverId) this.tools.delete(id);
    }
  }

  removeSource(source: ToolSource): void {
    for (const [id, record] of this.tools) {
      if (record.source === source) this.tools.delete(id);
    }
  }

  get(id: string): ToolRecord | undefined {
    return this.tools.get(id);
  }

  all(): ToolRecord[] {
    return [...this.tools.values()];
  }

  bySource(source: ToolSource): ToolRecord[] {
    return this.all().filter((t) => t.source === source);
  }

  get size(): number {
    return this.tools.size;
  }

  /**
   * Tools available for a project. A tool with no `projectScope` is global; one
   * with a scope is only included when `projectPath` is one of its entries.
   */
  scopedTo(projectPath: string | null): ToolRecord[] {
    return this.all().filter(
      (t) => !t.projectScope || (projectPath !== null && t.projectScope.includes(projectPath)),
    );
  }

  /** Simple case-insensitive substring search over title/name/description. */
  find(query: string): ToolRecord[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.all();
    return this.all().filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }
}
