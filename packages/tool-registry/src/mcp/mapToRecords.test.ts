import { describe, expect, it } from 'vitest';
import { inferSideEffects, mcpToolToRecord, mcpToolsToRecords, sanitizeSchema } from './mapToRecords.js';

describe('inferSideEffects', () => {
  it('treats an unannotated tool as a writer (never silently safe)', () => {
    expect(inferSideEffects({ name: 'do_thing' })).toEqual(['write-file']);
  });

  it('does not trust a server read-only hint by default', () => {
    expect(inferSideEffects({ name: 'list', annotations: { readOnlyHint: true } })).toEqual([
      'write-file',
    ]);
  });

  it('accepts a read-only hint only for an explicitly trusted catalogue', () => {
    expect(inferSideEffects({ name: 'list', annotations: { readOnlyHint: true } }, true)).toEqual([
      'read',
    ]);
  });

  it('escalates dangerous verbs in the tool name', () => {
    expect(inferSideEffects({ name: 'delete_file' })).toContain('delete-file');
    expect(inferSideEffects({ name: 'deploy_site' })).toContain('deploy');
    expect(inferSideEffects({ name: 'send_email' })).toContain('send-message');
    expect(inferSideEffects({ name: 'git_push' })).toContain('git-push');
  });

  it('adds network for open-world tools', () => {
    expect(inferSideEffects({ name: 'fetch', annotations: { openWorldHint: true } })).toContain('network');
  });
});

describe('mcpToolToRecord', () => {
  it('produces a gated record for a write tool', () => {
    const record = mcpToolToRecord('fs', { name: 'write_file', description: 'w' });
    expect(record.id).toBe('mcp:fs:write_file');
    expect(record.source).toBe('mcp');
    expect(record.risk).toBe('medium');
    expect(record.requiresConfirmation).toBe(true);
  });

  it('keeps an arbitrary server read-only tool gated', () => {
    const record = mcpToolToRecord('fs', {
      name: 'read_file',
      annotations: { readOnlyHint: true },
    });
    expect(record.risk).toBe('medium');
    expect(record.requiresConfirmation).toBe(true);
  });

  it('allows a caller-owned catalogue to trust read-only annotations', () => {
    const record = mcpToolToRecord(
      'owned',
      { name: 'read_file', annotations: { readOnlyHint: true } },
      { trustReadOnlyHint: true },
    );
    expect(record.risk).toBe('safe');
    expect(record.requiresConfirmation).toBe(false);
  });

  it('forces critical tools to once-only approval', () => {
    const record = mcpToolToRecord('ops', { name: 'deploy_prod' });
    expect(record.risk).toBe('critical');
    expect(record.approvalScopes).toEqual(['once']);
  });
});

describe('mcpToolsToRecords', () => {
  it('honours an allowlist', () => {
    const records = mcpToolsToRecords(
      'fs',
      [{ name: 'read_file' }, { name: 'delete_file' }],
      { allowlist: ['read_file'] },
    );
    expect(records.map((r) => r.name)).toEqual(['read_file']);
  });
});

describe('sanitizeSchema', () => {
  it('keeps only declared properties with allowed types', () => {
    const schema = sanitizeSchema({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'p' },
        weird: { type: 'function' },
      },
      required: ['path'],
    });
    expect(schema.properties['path']?.type).toBe('string');
    expect(schema.properties['weird']?.type).toBe('string'); // coerced from unknown type
    expect(schema.required).toEqual(['path']);
  });
});
