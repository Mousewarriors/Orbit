/**
 * @orbit/tool-registry — the unified vocabulary for *tools* Orbit can invoke,
 * regardless of where they come from (native capability, Orbit Relay, the
 * AgentOS Gateway, an extension, an MCP server, or an AI provider tool).
 *
 * This package is pure and GUI-free. It defines the canonical `ToolRecord`,
 * derives a tool's risk + approval policy from its declared side effects, talks
 * the MCP protocol over an *injected* transport (so it is testable without any
 * real server), and merges discovered tools into one bounded registry that the
 * Mission engine and Approval Centre consume.
 *
 * Security stance (mirrors the AI runtime): a tool can never widen Orbit's
 * action surface implicitly. Every tool carries an explicit risk + side-effect
 * set; anything that writes, deletes, sends, runs, publishes, deploys or spends
 * is forced through confirmation, and high/critical-risk tools can never be
 * granted a *persistent* approval. Tool output is treated as untrusted data.
 */

/** Where a tool originates. Always shown to the user — never hidden. */
export type ToolSource = 'native' | 'relay' | 'agentos' | 'extension' | 'mcp' | 'ai-provider';

/** Coarse risk band, ordered. Drives confirmation + offerable approval scopes. */
export type ToolRisk = 'safe' | 'low' | 'medium' | 'high' | 'critical';

/** The kinds of effect a tool may have on the world. */
export type ToolSideEffect =
  | 'read'
  | 'write-file'
  | 'delete-file'
  | 'network'
  | 'send-message'
  | 'run-command'
  | 'git-push'
  | 'deploy'
  | 'publish'
  | 'spend'
  | 'system-change';

/**
 * How an approval for a tool may be remembered. High/critical-risk tools are
 * restricted to `once` — they may never be granted a persistent approval (spec
 * §21: "High-risk actions must not offer persistent approval").
 */
export type ApprovalScope = 'once' | 'per-mission' | 'per-project';

/** A minimal JSON-Schema subset we validate tool arguments against. */
export interface ToolPropertySchema {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  readonly description?: string;
  readonly enum?: ReadonlyArray<string | number>;
}

export interface ToolInputSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, ToolPropertySchema>>;
  readonly required?: readonly string[];
}

/** Liveness of a tool's backing source. */
export type ToolAvailability = 'available' | 'unavailable' | 'unknown';
export type ToolHealth = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * The canonical, source-agnostic description of a single invokable tool. Ids are
 * namespaced (`<source>:<server>:<name>`) so the registry can dedupe across
 * sources without collisions.
 */
export interface ToolRecord {
  readonly id: string;
  /** The tool's own name within its source (e.g. the MCP tool name). */
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly source: ToolSource;
  /** For mcp/extension tools, the server/extension that provides it. */
  readonly serverId?: string;
  readonly inputSchema: ToolInputSchema;
  readonly risk: ToolRisk;
  readonly sideEffects: readonly ToolSideEffect[];
  /** Whether invoking this tool requires explicit confirmation first. */
  readonly requiresConfirmation: boolean;
  /** Which approval scopes the UI may offer (never persistent for high risk). */
  readonly approvalScopes: readonly ApprovalScope[];
  /** When set, the tool is only offered while one of these projects is active. */
  readonly projectScope?: readonly string[];
  readonly availability: ToolAvailability;
  readonly health: ToolHealth;
}

/** The bounded result of invoking a tool. Text is clamped by the client. */
export interface ToolInvocationResult {
  readonly ok: boolean;
  /** Bounded textual output (already length-limited). */
  readonly content: string;
  /** True when the output was truncated to the content bound. */
  readonly truncated: boolean;
  /** Present when `ok` is false. */
  readonly error?: string;
  /** Milliseconds the call took, when measured by the caller. */
  readonly durationMs?: number;
}

/** Numeric ordering of risk so callers can compare/raise a floor. */
export const RISK_ORDER: Readonly<Record<ToolRisk, number>> = {
  safe: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Return the higher of two risks. */
export function maxRisk(a: ToolRisk, b: ToolRisk): ToolRisk {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}
