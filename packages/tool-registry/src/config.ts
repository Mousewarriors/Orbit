/**
 * MCP server configuration + validation.
 *
 * A server record is what the user configures in Settings → MCP. It never holds
 * a plaintext secret — only a *reference* into OS secure storage (spec §9.5).
 * Validation is conservative: unknown transports, empty commands and non-public
 * HTTPS endpoints are rejected before anything is ever spawned/connected.
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
    if (!isPublicHttpsMcpEndpoint(config.endpoint)) {
      errors.push({
        field: 'endpoint',
        message: 'http transport requires a public https endpoint',
      });
    }
  }
  if (
    config.timeoutMs !== undefined &&
    (!Number.isFinite(config.timeoutMs) ||
      config.timeoutMs < MIN_TIMEOUT ||
      config.timeoutMs > MAX_TIMEOUT)
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

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN;
    return Number(part);
  });
  return octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? octets : null;
}

function isForbiddenIpv4(host: string): boolean {
  const octets = parseIpv4(host);
  if (!octets) return false;
  const a = octets[0]!;
  const b = octets[1]!;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && octets[2] === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 203 && b === 0 && octets[2] === 113)
  );
}

function isForbiddenIpv6(host: string): boolean {
  const h = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (!h.includes(':')) return false;
  const mappedDotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedDotted) return isForbiddenIpv4(mappedDotted[1]!);
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1]!, 16);
    const low = Number.parseInt(mappedHex[2]!, 16);
    if (Number.isFinite(high) && Number.isFinite(low)) {
      return isForbiddenIpv4(
        `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`,
      );
    }
  }
  if (h === '::' || h === '::1') {
    return true;
  }
  const first = h.split(':').find(Boolean) ?? '';
  const firstValue = Number.parseInt(first, 16);
  if (!Number.isFinite(firstValue)) return false;
  return (
    firstValue === 0x0100 ||
    (firstValue & 0xfe00) === 0xfc00 ||
    (firstValue & 0xffc0) === 0xfe80 ||
    firstValue === 0xff00 ||
    h.startsWith('2001:db8:') ||
    (firstValue === 0x2001 && Number.parseInt(h.split(':')[1] || '0', 16) <= 0x01ff)
  );
}

/** Static HTTP-MCP endpoint policy; native Rust repeats this and adds DNS checks. */
export function isPublicHttpsMcpEndpoint(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
      return false;
    }
    if (isForbiddenIpv4(host) || isForbiddenIpv6(host)) return false;
    return true;
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
