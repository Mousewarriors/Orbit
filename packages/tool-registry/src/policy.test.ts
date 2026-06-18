import { describe, expect, it } from 'vitest';
import { approvalScopesFor, deriveRisk, requiresConfirmation } from './policy.js';

describe('deriveRisk', () => {
  it('floors a read-only tool at safe', () => {
    expect(deriveRisk(['read'])).toBe('safe');
  });

  it('raises to the highest side-effect risk', () => {
    expect(deriveRisk(['read', 'network', 'write-file'])).toBe('medium');
    expect(deriveRisk(['write-file', 'delete-file'])).toBe('high');
    expect(deriveRisk(['network', 'deploy'])).toBe('critical');
    expect(deriveRisk(['spend'])).toBe('critical');
  });

  it('honours a base hint but never lowers below side effects', () => {
    expect(deriveRisk([], 'low')).toBe('low');
    expect(deriveRisk(['deploy'], 'low')).toBe('critical');
  });
});

describe('requiresConfirmation', () => {
  it('is false for safe/low read-only tools', () => {
    expect(requiresConfirmation(['read'], 'safe')).toBe(false);
    expect(requiresConfirmation(['network'], 'low')).toBe(false);
  });

  it('is true for any mandatory side effect even if risk were lower', () => {
    expect(requiresConfirmation(['write-file'], 'low')).toBe(true);
    expect(requiresConfirmation(['send-message'], 'low')).toBe(true);
    expect(requiresConfirmation(['run-command'], 'low')).toBe(true);
  });

  it('is true for medium+ risk', () => {
    expect(requiresConfirmation([], 'medium')).toBe(true);
    expect(requiresConfirmation([], 'critical')).toBe(true);
  });
});

describe('approvalScopesFor', () => {
  it('never offers a persistent scope for high/critical risk', () => {
    expect(approvalScopesFor('high')).toEqual(['once']);
    expect(approvalScopesFor('critical')).toEqual(['once']);
  });

  it('allows mission/project scope for medium risk', () => {
    expect(approvalScopesFor('medium')).toContain('per-mission');
    expect(approvalScopesFor('medium')).toContain('per-project');
  });

  it('offers no approval scope for safe/low (no approval needed)', () => {
    expect(approvalScopesFor('safe')).toEqual([]);
    expect(approvalScopesFor('low')).toEqual([]);
  });
});
