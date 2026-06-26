import { describe, expect, it } from 'vitest';
import {
  defaultMcpServerConfig,
  isHttpUrl,
  isPublicHttpsMcpEndpoint,
  redactConfig,
  validateMcpServerConfig,
} from './config.js';

describe('validateMcpServerConfig', () => {
  it('accepts a valid stdio server', () => {
    expect(
      validateMcpServerConfig({
        id: 'fs',
        name: 'Filesystem',
        transport: 'stdio',
        command: 'mcp-fs',
        enabled: true,
        startupPolicy: 'on-demand',
        timeoutMs: 15_000,
        trusted: false,
      }),
    ).toEqual([]);
  });

  it('rejects an http server without a public https endpoint', () => {
    const errors = validateMcpServerConfig({
      id: 'x',
      name: 'X',
      transport: 'http',
      endpoint: 'http://127.0.0.1/mcp',
    });
    expect(errors.some((e) => e.field === 'endpoint')).toBe(true);
  });

  it('rejects a stdio server with no command and a bad id', () => {
    const errors = validateMcpServerConfig({ id: 'bad id!', name: '', transport: 'stdio' });
    expect(errors.map((e) => e.field).sort()).toEqual(['command', 'id', 'name']);
  });

  it('rejects an out-of-range timeout', () => {
    const errors = validateMcpServerConfig({
      id: 'fs',
      name: 'fs',
      transport: 'stdio',
      command: 'c',
      timeoutMs: 10,
    });
    expect(errors.some((e) => e.field === 'timeoutMs')).toBe(true);
  });
});

describe('isHttpUrl', () => {
  it('accepts http/https only', () => {
    expect(isHttpUrl('http://x')).toBe(true);
    expect(isHttpUrl('https://x')).toBe(true);
    expect(isHttpUrl('file:///x')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});

describe('isPublicHttpsMcpEndpoint', () => {
  it('allows only public-looking https endpoints', () => {
    expect(isPublicHttpsMcpEndpoint('https://mcp.example.com/rpc')).toBe(true);
    expect(isPublicHttpsMcpEndpoint('http://mcp.example.com/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://user:pass@mcp.example.com/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://localhost/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://service.local/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://127.0.0.1/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://10.0.0.2/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://172.16.0.2/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://192.168.1.2/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://169.254.169.254/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://192.0.0.1/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://198.18.0.1/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://198.19.255.255/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://[::1]/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://[fc00::1]/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://[::ffff:192.168.1.1]/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://[::ffff:c0a8:101]/rpc')).toBe(false);
    expect(isPublicHttpsMcpEndpoint('https://8.8.8.8/rpc')).toBe(true);
  });
});

describe('redactConfig', () => {
  it('never exposes the credential, only whether one is present', () => {
    const view = redactConfig({
      ...defaultMcpServerConfig(),
      id: 'fs',
      name: 'fs',
      command: 'c',
      credentialRef: 'secure://abc',
    });
    expect(view['hasCredential']).toBe(true);
    expect(JSON.stringify(view)).not.toContain('secure://abc');
  });
});
