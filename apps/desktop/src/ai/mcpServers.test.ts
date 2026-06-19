import { describe, expect, it } from 'vitest';
import {
  parseMcpServers,
  removeServer,
  serializeMcpServers,
  upsertServer,
  validateServer,
  type StoredMcpServer,
} from './mcpServers.js';

describe('parseMcpServers', () => {
  it('keeps valid http(s) servers and drops the rest', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'A', endpoint: 'https://a/mcp', enabled: true },
      { id: 'b', name: 'B', endpoint: 'ftp://b' }, // bad scheme
      { id: '', name: 'C', endpoint: 'http://c' }, // no id
      { id: 'a', name: 'dup', endpoint: 'http://a2' }, // dup id
    ]);
    const list = parseMcpServers(raw);
    expect(list.map((s) => s.id)).toEqual(['a']);
    expect(list[0]?.enabled).toBe(true);
  });

  it('returns [] for junk', () => {
    expect(parseMcpServers(null)).toEqual([]);
    expect(parseMcpServers('not json')).toEqual([]);
    expect(parseMcpServers('{}')).toEqual([]);
  });

  it('round-trips through serialize', () => {
    const list: StoredMcpServer[] = [{ id: 'x', name: 'X', endpoint: 'http://x/mcp', enabled: false }];
    expect(parseMcpServers(serializeMcpServers(list))).toEqual(list);
  });

  it('keeps stdio servers (command-based) and round-trips them', () => {
    const list: StoredMcpServer[] = [
      {
        id: 'agentos',
        name: 'AgentOS',
        command: 'node',
        args: ['C:/AgentOS/server/mcp/server.js'],
        cwd: 'C:/AgentOS',
        enabled: true,
      },
    ];
    const parsed = parseMcpServers(serializeMcpServers(list));
    expect(parsed).toEqual(list);
  });

  it('drops a stdio entry with no command and a bad endpoint, but keeps a valid stdio one', () => {
    const raw = JSON.stringify([
      { id: 'bad', name: 'Bad', enabled: true }, // neither command nor endpoint
      { id: 'os', name: 'OS', command: 'node', args: ['x.js'], enabled: true },
    ]);
    expect(parseMcpServers(raw).map((s) => s.id)).toEqual(['os']);
  });
});

describe('validateServer', () => {
  const existing: StoredMcpServer[] = [{ id: 'a', name: 'A', endpoint: 'http://a', enabled: true }];

  it('accepts a valid server', () => {
    expect(validateServer({ id: 'fs', name: 'FS', endpoint: 'http://localhost:9/mcp' }, existing)).toBeNull();
  });

  it('rejects bad id, duplicate id, missing name, non-http endpoint', () => {
    expect(validateServer({ id: 'bad id', name: 'n', endpoint: 'http://x' }, existing)).toMatch(/Id/);
    expect(validateServer({ id: 'a', name: 'n', endpoint: 'http://x' }, existing)).toMatch(/exists/);
    expect(validateServer({ id: 'ok', name: '', endpoint: 'http://x' }, existing)).toMatch(/Name/);
    expect(validateServer({ id: 'ok', name: 'n', endpoint: 'ws://x' }, existing)).toMatch(/http/);
  });

  it('accepts a stdio server with just a command (no endpoint needed)', () => {
    expect(validateServer({ id: 'os', name: 'AgentOS', command: 'node' }, existing)).toBeNull();
  });
});

describe('upsert/remove', () => {
  it('replaces by id and removes', () => {
    let list: StoredMcpServer[] = [];
    list = upsertServer(list, { id: 'a', name: 'A', endpoint: 'http://a', enabled: true });
    list = upsertServer(list, { id: 'a', name: 'A2', endpoint: 'http://a', enabled: false });
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('A2');
    expect(removeServer(list, 'a')).toEqual([]);
  });
});
