import { describe, expect, it } from 'vitest';
import { isValidToolRecord, ToolRegistry } from './registry.js';
import { nativeToolRecords, NATIVE_TOOL_IDS } from './nativeTools.js';
import { mcpToolsToRecords } from './mcp/mapToRecords.js';
import { validateArgs } from './validateArgs.js';

describe('ToolRegistry', () => {
  it('merges native + MCP tools and dedupes by id', () => {
    const reg = new ToolRegistry();
    reg.register(nativeToolRecords());
    reg.register(
      mcpToolsToRecords('fs', [{ name: 'read_file', annotations: { readOnlyHint: true } }], {
        trustReadOnlyHint: true,
      }),
    );
    const before = reg.size;
    // Re-registering the same id replaces, doesn't grow.
    reg.register(
      mcpToolsToRecords('fs', [{ name: 'read_file', annotations: { readOnlyHint: true } }], {
        trustReadOnlyHint: true,
      }),
    );
    expect(reg.size).toBe(before);
    expect(reg.get('mcp:fs:read_file')).toBeDefined();
    expect(reg.get(NATIVE_TOOL_IDS.dispatchAgent)?.source).toBe('relay');
  });

  it('requires stable versioned records with schema, risk and health', () => {
    const native = nativeToolRecords();
    expect(native.every((t) => isValidToolRecord(t))).toBe(true);
    expect(native.every((t) => /^\d+\.\d+\.\d+$/.test(t.version))).toBe(true);

    const [mcp] = mcpToolsToRecords('fs', [{ name: 'read_file' }]);
    expect(mcp?.version).toBe('1.0.0');
    expect(mcp ? isValidToolRecord(mcp) : false).toBe(true);

    const reg = new ToolRegistry();
    reg.register([{ ...native[0]!, version: '' }]);
    expect(reg.size).toBe(0);
  });

  it("removes a server's tools on disable", () => {
    const reg = new ToolRegistry();
    reg.register(mcpToolsToRecords('fs', [{ name: 'a' }, { name: 'b' }]));
    expect(reg.bySource('mcp')).toHaveLength(2);
    reg.removeServer('fs');
    expect(reg.bySource('mcp')).toHaveLength(0);
  });

  it('scopes tools to the active project', () => {
    const reg = new ToolRegistry();
    reg.register(
      mcpToolsToRecords('repo', [{ name: 'build' }], { projectScope: ['C:/proj/orbit'] }),
    );
    reg.register(nativeToolRecords());
    expect(reg.scopedTo('C:/proj/orbit').some((t) => t.id === 'mcp:repo:build')).toBe(true);
    expect(reg.scopedTo('C:/proj/other').some((t) => t.id === 'mcp:repo:build')).toBe(false);
    // Global native tools remain in scope regardless.
    expect(reg.scopedTo('C:/proj/other').some((t) => t.source === 'native')).toBe(true);
  });

  it('finds tools by substring', () => {
    const reg = new ToolRegistry();
    reg.register(nativeToolRecords());
    expect(reg.find('agent').some((t) => t.id === NATIVE_TOOL_IDS.dispatchAgent)).toBe(true);
  });
});

describe('native dispatch_agent tool', () => {
  it('is high-risk, confirmed, and once-only approvable', () => {
    const dispatch = nativeToolRecords().find((t) => t.id === NATIVE_TOOL_IDS.dispatchAgent)!;
    expect(dispatch.requiresConfirmation).toBe(true);
    expect(dispatch.approvalScopes).toEqual(['once']);
  });

  it('validates its arguments', () => {
    const dispatch = nativeToolRecords().find((t) => t.id === NATIVE_TOOL_IDS.dispatchAgent)!;
    const bad = validateArgs(dispatch.inputSchema, { agentPreference: 'wizard' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toContain('projectQuery');
    const good = validateArgs(dispatch.inputSchema, {
      projectQuery: 'orbit',
      agentPreference: 'best',
    });
    expect(good.ok).toBe(true);
    expect(good.cleaned).toEqual({ projectQuery: 'orbit', agentPreference: 'best' });
  });
});

describe('native open_file_in_application tool', () => {
  it('validates the app and file search arguments', () => {
    const openFile = nativeToolRecords().find(
      (t) => t.id === NATIVE_TOOL_IDS.openFileInApplication,
    )!;
    const bad = validateArgs(openFile.inputSchema, { applicationQuery: 'paint' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toContain('fileQuery');
    const good = validateArgs(openFile.inputSchema, {
      applicationQuery: 'paint',
      fileQuery: 'convention attendant positions map',
    });
    expect(good.ok).toBe(true);
    expect(good.cleaned).toEqual({
      applicationQuery: 'paint',
      fileQuery: 'convention attendant positions map',
    });
  });
});
