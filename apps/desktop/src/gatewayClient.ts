/**
 * AgentOS Gateway client foundation.
 *
 * Defines the contract (GatewayClient interface) and provides three adapter
 * implementations: MockGatewayClient for tests, JsonGatewayClient for offline
 * development with fixture files, and HttpGatewayClient as the future
 * production adapter.
 *
 * IMPORTANT: Orbit must NOT bypass Relay by calling Gateway directly for local
 * execution. Gateway is for remote/cloud operations only. Local agent work
 * always goes through Relay.
 */

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

export interface GatewaySession {
  readonly id: string;
  readonly agentId: string;
  readonly projectId: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GatewayApproval {
  readonly id: string;
  readonly sessionId: string;
  readonly type: string;
  readonly description: string;
  readonly status: 'pending' | 'approved' | 'denied' | 'expired';
  readonly createdAt: string;
  readonly respondedAt: string | null;
}

export interface GatewayAgent {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly available: boolean;
}

export interface GatewayHealthStatus {
  readonly healthy: boolean;
  readonly version: string;
  readonly uptime: number;
  readonly connectedAgents: number;
}

export interface GatewayError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type GatewayResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: GatewayError };

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface GatewayClient {
  readonly kind: 'mock' | 'json' | 'http';

  health(): Promise<GatewayResult<GatewayHealthStatus>>;
  listAgents(): Promise<GatewayResult<readonly GatewayAgent[]>>;
  listSessions(projectId?: string): Promise<GatewayResult<readonly GatewaySession[]>>;
  getSession(sessionId: string): Promise<GatewayResult<GatewaySession>>;
  listApprovals(sessionId?: string): Promise<GatewayResult<readonly GatewayApproval[]>>;
}

// ---------------------------------------------------------------------------
// Mock adapter (for tests and offline development)
// ---------------------------------------------------------------------------

const MOCK_AGENTS: readonly GatewayAgent[] = [
  {
    id: 'gateway-claude-code',
    name: 'Claude Code (Gateway)',
    version: '1.0.0',
    capabilities: ['code-edit', 'file-read', 'terminal'],
    available: true,
  },
  {
    id: 'gateway-codex',
    name: 'Codex (Gateway)',
    version: '1.0.0',
    capabilities: ['code-edit', 'file-read'],
    available: false,
  },
];

export function createMockClient(): GatewayClient {
  const sessions: GatewaySession[] = [];
  const approvals: GatewayApproval[] = [];

  return {
    kind: 'mock',

    async health(): Promise<GatewayResult<GatewayHealthStatus>> {
      return {
        ok: true,
        data: { healthy: true, version: '0.1.0-mock', uptime: 0, connectedAgents: 2 },
      };
    },

    async listAgents(): Promise<GatewayResult<readonly GatewayAgent[]>> {
      return { ok: true, data: MOCK_AGENTS };
    },

    async listSessions(projectId?: string): Promise<GatewayResult<readonly GatewaySession[]>> {
      const filtered = projectId
        ? sessions.filter((s) => s.projectId === projectId)
        : sessions;
      return { ok: true, data: filtered };
    },

    async getSession(sessionId: string): Promise<GatewayResult<GatewaySession>> {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Session not found', retryable: false } };
      }
      return { ok: true, data: session };
    },

    async listApprovals(sessionId?: string): Promise<GatewayResult<readonly GatewayApproval[]>> {
      const filtered = sessionId
        ? approvals.filter((a) => a.sessionId === sessionId)
        : approvals;
      return { ok: true, data: filtered };
    },
  };
}

// ---------------------------------------------------------------------------
// JSON fixture adapter (for offline development with fixture files)
// ---------------------------------------------------------------------------

export interface JsonFixtures {
  readonly health?: GatewayHealthStatus;
  readonly agents?: readonly GatewayAgent[];
  readonly sessions?: readonly GatewaySession[];
  readonly approvals?: readonly GatewayApproval[];
}

export function createJsonClient(fixtures: JsonFixtures): GatewayClient {
  return {
    kind: 'json',

    async health(): Promise<GatewayResult<GatewayHealthStatus>> {
      if (!fixtures.health) {
        return { ok: false, error: { code: 'NO_FIXTURE', message: 'No health fixture', retryable: false } };
      }
      return { ok: true, data: fixtures.health };
    },

    async listAgents(): Promise<GatewayResult<readonly GatewayAgent[]>> {
      return { ok: true, data: fixtures.agents ?? [] };
    },

    async listSessions(projectId?: string): Promise<GatewayResult<readonly GatewaySession[]>> {
      const all = fixtures.sessions ?? [];
      const filtered = projectId ? all.filter((s) => s.projectId === projectId) : all;
      return { ok: true, data: filtered };
    },

    async getSession(sessionId: string): Promise<GatewayResult<GatewaySession>> {
      const session = (fixtures.sessions ?? []).find((s) => s.id === sessionId);
      if (!session) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Session not found', retryable: false } };
      }
      return { ok: true, data: session };
    },

    async listApprovals(sessionId?: string): Promise<GatewayResult<readonly GatewayApproval[]>> {
      const all = fixtures.approvals ?? [];
      const filtered = sessionId ? all.filter((a) => a.sessionId === sessionId) : all;
      return { ok: true, data: filtered };
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP adapter (future production use — stub only)
// ---------------------------------------------------------------------------

export interface HttpClientConfig {
  readonly baseUrl: string;
  readonly timeoutMs: number;
}

export function createHttpClient(config: HttpClientConfig): GatewayClient {
  function gatewayError(message: string): GatewayResult<never> {
    return { ok: false, error: { code: 'NOT_IMPLEMENTED', message, retryable: false } };
  }

  // Capture config reference for future use — avoids unused-variable lint error
  const _baseUrl = config.baseUrl;
  const _timeout = config.timeoutMs;
  void _baseUrl;
  void _timeout;

  return {
    kind: 'http',

    async health(): Promise<GatewayResult<GatewayHealthStatus>> {
      return gatewayError('HTTP Gateway client is not yet implemented');
    },

    async listAgents(): Promise<GatewayResult<readonly GatewayAgent[]>> {
      return gatewayError('HTTP Gateway client is not yet implemented');
    },

    async listSessions(_projectId?: string): Promise<GatewayResult<readonly GatewaySession[]>> {
      return gatewayError('HTTP Gateway client is not yet implemented');
    },

    async getSession(_sessionId: string): Promise<GatewayResult<GatewaySession>> {
      return gatewayError('HTTP Gateway client is not yet implemented');
    },

    async listApprovals(_sessionId?: string): Promise<GatewayResult<readonly GatewayApproval[]>> {
      return gatewayError('HTTP Gateway client is not yet implemented');
    },
  };
}
