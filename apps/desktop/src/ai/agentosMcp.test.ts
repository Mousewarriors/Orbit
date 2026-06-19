import { describe, expect, it } from 'vitest';
import { agentosMcpServer, AGENTOS_SERVER_ID, normaliseDir } from './agentosMcp.js';

describe('agentosMcp', () => {
  it('normalises backslashes and trailing slashes', () => {
    expect(normaliseDir('C:\\AgentOS\\')).toBe('C:/AgentOS');
    expect(normaliseDir('  C:/AgentOS//  ')).toBe('C:/AgentOS');
  });

  it('builds a stdio server pointing at the MCP entry', () => {
    const s = agentosMcpServer('C:\\AgentOS');
    expect(s.id).toBe(AGENTOS_SERVER_ID);
    expect(s.command).toBe('node');
    expect(s.args).toEqual(['C:/AgentOS/server/mcp/server.js']);
    expect(s.cwd).toBe('C:/AgentOS');
    expect(s.enabled).toBe(true);
  });

  it('falls back to the default dir when given empty input', () => {
    expect(agentosMcpServer('').args?.[0]).toBe('C:/AgentOS/server/mcp/server.js');
  });
});
