import { describe, expect, it } from 'vitest';
import { ToolRegistry, nativeToolRecords, NATIVE_TOOL_IDS } from '@orbit/tool-registry';
import { AUTOMATIONS, buildAutomationPlan, getAutomation } from './index.js';

function registry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(nativeToolRecords());
  return reg;
}

describe('automations catalogue', () => {
  it('has unique ids and at least one step each, all manual today', () => {
    const ids = new Set(AUTOMATIONS.map((a) => a.id));
    expect(ids.size).toBe(AUTOMATIONS.length);
    for (const a of AUTOMATIONS) {
      expect(a.steps.length).toBeGreaterThan(0);
      expect(a.trigger).toBe('manual');
    }
  });
});

describe('buildAutomationPlan', () => {
  const reg = registry();

  it('compiles a valid automation into a deterministic MissionPlan', () => {
    const plan = buildAutomationPlan(getAutomation('review-approvals')!, reg);
    expect(plan?.source).toBe('deterministic');
    expect(plan?.steps[0]?.toolId).toBe(NATIVE_TOOL_IDS.openControlCenter);
    expect(plan?.steps[0]?.args['controlCenterTab']).toBe('approvals');
  });

  it('keeps the consequential restart step (still gated by the executor)', () => {
    const plan = buildAutomationPlan(getAutomation('restart-relay')!, reg);
    expect(plan?.steps[0]?.toolId).toBe(NATIVE_TOOL_IDS.restartRelay);
    // The tool itself carries the confirmation requirement.
    expect(reg.get(NATIVE_TOOL_IDS.restartRelay)?.requiresConfirmation).toBe(true);
  });

  it('returns null when the registry lacks the automation\'s tools', () => {
    const empty = new ToolRegistry();
    expect(buildAutomationPlan(getAutomation('review-approvals')!, empty)).toBeNull();
  });
});
