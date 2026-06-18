/**
 * MCP server configuration + validation.
 *
 * A server record is what the user configures in Settings → MCP. It never holds
 * a plaintext secret — only a *reference* into OS secure storage (spec §9.5).
 * Validation is conservative: unknown transports, empty commands and non-
 * http(s) endpoints are rejected before anything is ever spawned/connected.
 */

export type McpTransportKind = 'stdio' | 'http';
export type McpStartupPolicy = 'eager' | 'on-demand' | 'manual';

export interface McpServerConfig {
  readonly id: string;
  readonly name: string;
  readonly transport: McpTransportKind;
  /** For `stdio`: the executable to launch. */
  readonly command?: string;
  readonly args?: readonly string[];
  /** For `http`: the base endpoint (http/https only). */
  readonly endpoint?: string;
  /** Reference into OS secure storage; never the secret itself. */
  readonly credentialRef?: string;
  readonly enabled: boolean;
  readonly startupPolicy: McpStartupPolicy;
  readonly timeoutMs: number;
  /** A trusted server's read-only tools may skip the confirm step (still logged). */
  readonly trusted: boolean;
  /** When set, only these tool names are exposed from the server. */
  readonly toolAllowlist?: readonly string[];
  /** When set, the server's tools are scoped to these project paths. */
  readonly projectScope?: readonly string[];
  /** When set, only these agents may use this server's tools. */
  readonly agentAllowlist?: readonly string[];
}

export interface McpConfigError {
  readonly field: string;
  readonly message: string;
}

const MAX_TIMEOUT = 120_000;
const MIN_TIMEOUT = 500;

/** Validate a server config. Returns [] when valid. Never throws. */
export function validateMcpServerConfig(config: Partial<McpServerConfig>): McpConfigError[] {
  const errors: McpConfigError[] = [];
  if (!config.id || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(config.id)) {
    errors.push({ field: 'id', message: 'id must be 1–64 chars: letters, digits, . _ -' });
  }
  if (!config.name || config.name.trim().length === 0) {
    errors.push({ field: 'name', message: 'name is required' });
  }
  if (config.transport !== 'stdio' && config.transport !== 'http') {
    errors.push({ field: 'transport', message: 'transport must be "stdio" or "http"' });
  }
  if (config.transport === 'stdio') {
    if (!config.command || config.command.trim().length === 0) {
      errors.push({ field: 'command', message: 'stdio transport requires a command' });
    }
  }
  if (config.transport === 'http') {
    if (!isHttpUrl(config.endpoint)) {
      errors.push({ field: 'endpoint', message: 'http transport requires an http(s) endpoint' });
    }
  }
  if (
    config.timeoutMs !== undefined &&
    (!Number.isFinite(config.timeoutMs) || config.timeoutMs < MIN_TIMEOUT || config.timeoutMs > MAX_TIMEOUT)
  ) {
    errors.push({ field: 'timeoutMs', message: `timeoutMs must be ${MIN_TIMEOUT}–${MAX_TIMEOUT}` });
  }
  return errors;
}

export function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A view of a config safe to log / display: never includes the credential value
 * (there isn't one here — only a reference — but this guards future fields too).
 */
export function redactConfig(config: McpServerConfig): Record<string, unknown> {
  return {
    id: config.id,
    name: config.name,
    transport: config.transport,
    ...(config.command ? { command: config.command } : {}),
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    hasCredential: Boolean(config.credentialRef),
    enabled: config.enabled,
    startupPolicy: config.startupPolicy,
    trusted: config.trusted,
  };
}

/** Sensible defaults for a new server form. */
export function defaultMcpServerConfig(): McpServerConfig {
  return {
    id: '',
    name: '',
    transport: 'stdio',
    enabled: false,
    startupPolicy: 'on-demand',
    timeoutMs: 15_000,
    trusted: false,
  };
}
