import { describe, expect, it } from 'vitest';
import { defaultMcpServerConfig, isHttpUrl, redactConfig, validateMcpServerConfig } from './config.js';

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

  it('rejects an http server without an http(s) endpoint', () => {
    const errors = validateMcpServerConfig({
      id: 'x',
      name: 'X',
      transport: 'http',
      endpoint: 'ftp://example.com',
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
