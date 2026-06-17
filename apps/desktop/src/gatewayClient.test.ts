import { describe, it, expect } from 'vitest';
import {
  createMockClient,
  createJsonClient,
  createHttpClient,
  type GatewayHealthStatus,
  type GatewayAgent,
  type GatewaySession,
  type GatewayApproval,
} from './gatewayClient.js';

describe('MockGatewayClient', () => {
  it('reports healthy', async () => {
    const client = createMockClient();
    const result = await client.health();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.healthy).toBe(true);
    }
  });

  it('lists mock agents', async () => {
    const client = createMockClient();
    const result = await client.listAgents();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBe(2);
      expect(result.data[0]!.id).toBe('gateway-claude-code');
    }
  });

  it('returns empty sessions by default', async () => {
    const client = createMockClient();
    const result = await client.listSessions();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });

  it('returns NOT_FOUND for unknown session', async () => {
    const client = createMockClient();
    const result = await client.getSession('nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('kind is mock', () => {
    expect(createMockClient().kind).toBe('mock');
  });
});

describe('JsonGatewayClient', () => {
  const health: GatewayHealthStatus = {
    healthy: true,
    version: '1.0.0',
    uptime: 3600,
    connectedAgents: 1,
  };

  const agents: GatewayAgent[] = [
    { id: 'test-agent', name: 'Test Agent', version: '1.0.0', capabilities: ['edit'], available: true },
  ];

  const sessions: GatewaySession[] = [
    { id: 's1', agentId: 'test-agent', projectId: 'p1', status: 'running', createdAt: '', updatedAt: '' },
    { id: 's2', agentId: 'test-agent', projectId: 'p2', status: 'completed', createdAt: '', updatedAt: '' },
  ];

  const approvals: GatewayApproval[] = [
    { id: 'a1', sessionId: 's1', type: 'file-edit', description: 'Edit main.ts', status: 'pending', createdAt: '', respondedAt: null },
  ];

  it('returns health from fixtures', async () => {
    const client = createJsonClient({ health });
    const result = await client.health();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.version).toBe('1.0.0');
    }
  });

  it('returns error when health fixture missing', async () => {
    const client = createJsonClient({});
    const result = await client.health();
    expect(result.ok).toBe(false);
  });

  it('filters sessions by projectId', async () => {
    const client = createJsonClient({ sessions });
    const result = await client.listSessions('p1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.id).toBe('s1');
    }
  });

  it('returns all sessions when no filter', async () => {
    const client = createJsonClient({ sessions });
    const result = await client.listSessions();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBe(2);
    }
  });

  it('finds session by id', async () => {
    const client = createJsonClient({ sessions });
    const result = await client.getSession('s2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('completed');
    }
  });

  it('lists agents from fixtures', async () => {
    const client = createJsonClient({ agents });
    const result = await client.listAgents();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBe(1);
    }
  });

  it('filters approvals by sessionId', async () => {
    const client = createJsonClient({ approvals });
    const result = await client.listApprovals('s1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.status).toBe('pending');
    }
  });

  it('kind is json', () => {
    expect(createJsonClient({}).kind).toBe('json');
  });
});

describe('HttpGatewayClient', () => {
  it('returns NOT_IMPLEMENTED for all methods', async () => {
    const client = createHttpClient({ baseUrl: 'http://localhost:9999', timeoutMs: 5000 });
    const health = await client.health();
    expect(health.ok).toBe(false);
    if (!health.ok) {
      expect(health.error.code).toBe('NOT_IMPLEMENTED');
    }
    const agents = await client.listAgents();
    expect(agents.ok).toBe(false);
    const sessions = await client.listSessions();
    expect(sessions.ok).toBe(false);
    const session = await client.getSession('x');
    expect(session.ok).toBe(false);
    const approvals = await client.listApprovals();
    expect(approvals.ok).toBe(false);
  });

  it('kind is http', () => {
    expect(createHttpClient({ baseUrl: 'http://localhost', timeoutMs: 1000 }).kind).toBe('http');
  });
});
