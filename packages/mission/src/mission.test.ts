import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry, nativeToolRecords, NATIVE_TOOL_IDS } from '@orbit/tool-registry';
import {
  buildMissionPrompt,
  missionConsequentialCount,
  missionStepViews,
  parseMissionPlan,
  planDeterministically,
  planMission,
} from './index.js';

function registry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(nativeToolRecords());
  return reg;
}

describe('planDeterministically', () => {
  const reg = registry();

  it('maps "Continue Orbit with the best coding agent" to a dispatch_agent step (no AI)', () => {
    const plan = planDeterministically('Continue Orbit with the best coding agent', reg);
    expect(plan?.source).toBe('deterministic');
    expect(plan?.steps).toHaveLength(1);
    expect(plan?.steps[0]?.toolId).toBe(NATIVE_TOOL_IDS.dispatchAgent);
    expect(plan?.steps[0]?.args['projectQuery']).toMatch(/orbit/i);
    expect(plan?.steps[0]?.args['agentPreference']).toBe('best');
  });

  it('maps "Restart Relay" to the restart tool', () => {
    expect(planDeterministically('Restart Relay', reg)?.steps[0]?.toolId).toBe(
      NATIVE_TOOL_IDS.restartRelay,
    );
  });

  it('maps "Open Calculator" to open_application', () => {
    const plan = planDeterministically('Open Calculator', reg);
    expect(plan?.steps[0]?.toolId).toBe(NATIVE_TOOL_IDS.openApplication);
    expect(plan?.steps[0]?.args['applicationQuery']).toMatch(/calculator/i);
  });

  it('maps "load up the convention attendant positions map in Paint" to open_file_in_application', () => {
    const plan = planDeterministically(
      'load up the convention attendant positions map in Paint',
      reg,
    );
    expect(plan?.steps[0]?.toolId).toBe(NATIVE_TOOL_IDS.openFileInApplication);
    expect(plan?.steps[0]?.args).toEqual({
      applicationQuery: 'paint',
      fileQuery: 'convention attendant positions map',
    });
  });

  it('maps "Show failed sessions" to open_control_center filtered to failed', () => {
    const plan = planDeterministically('Show failed sessions', reg);
    expect(plan?.steps[0]?.toolId).toBe(NATIVE_TOOL_IDS.openControlCenter);
    expect(plan?.steps[0]?.args['controlCenterTab']).toBe('sessions');
    expect(plan?.steps[0]?.args['sessionStatus']).toBe('failed');
  });

  it('returns null for an unrecognised multi-step goal', () => {
    expect(
      planDeterministically('research competitors then draft a launch email and deploy it', reg),
    ).toBeNull();
  });
});

describe('parseMissionPlan', () => {
  const reg = registry();

  it('validates steps against the registry and drops unknown tools / bad args', () => {
    const text = JSON.stringify({
      summary: 'do stuff',
      steps: [
        { tool: NATIVE_TOOL_IDS.findFiles, args: { fileQuery: 'leonard' }, rationale: 'search' },
        { tool: 'native:not_a_tool', args: {} }, // dropped: unknown
        { tool: NATIVE_TOOL_IDS.dispatchAgent, args: { agentPreference: 'wizard' } }, // dropped: bad enum + missing required
      ],
    });
    const plan = parseMissionPlan(text, 'goal', reg);
    expect(plan?.steps).toHaveLength(1);
    expect(plan?.steps[0]?.toolId).toBe(NATIVE_TOOL_IDS.findFiles);
    expect(plan?.source).toBe('ai');
    expect(plan?.summary).toBe('do stuff');
  });

  it('returns null when no step survives', () => {
    expect(parseMissionPlan('{"steps":[{"tool":"x","args":{}}]}', 'g', reg)).toBeNull();
    expect(parseMissionPlan('not json', 'g', reg)).toBeNull();
  });

  it('caps the number of steps', () => {
    const steps = Array.from({ length: 20 }, () => ({
      tool: NATIVE_TOOL_IDS.findNotes,
      args: { noteQuery: 'x' },
    }));
    const plan = parseMissionPlan(JSON.stringify({ steps }), 'g', reg);
    expect(plan!.steps.length).toBeLessThanOrEqual(8);
  });
});

describe('planMission', () => {
  const reg = registry();

  it('does not call the model when a deterministic plan exists', async () => {
    const complete = vi.fn();
    const result = await planMission('Restart Relay', reg, { tools: reg.all(), complete });
    expect(result.plan?.source).toBe('deterministic');
    expect(complete).not.toHaveBeenCalled();
  });

  it('falls back to AI when nothing is recognised', async () => {
    const complete = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ steps: [{ tool: NATIVE_TOOL_IDS.findFiles, args: { fileQuery: 'a' } }] }),
      );
    const result = await planMission('rummage for a file about a', reg, {
      tools: reg.all(),
      complete,
    });
    expect(complete).toHaveBeenCalledOnce();
    expect(result.plan?.source).toBe('ai');
  });

  it('reports no-match-no-ai when unrecognised and no provider', async () => {
    const result = await planMission('do something elaborate', reg, { tools: reg.all() });
    expect(result.plan).toBeNull();
    expect(result.reason).toBe('no-match-no-ai');
  });

  it('reports ai-error when the model throws', async () => {
    const result = await planMission('do something elaborate', reg, {
      tools: reg.all(),
      complete: () => Promise.reject(new Error('boom')),
    });
    expect(result.reason).toBe('ai-error');
  });
});

describe('describe helpers + prompt', () => {
  const reg = registry();

  it('marks dispatch_agent as consequential in the step view', () => {
    const plan = planDeterministically('Continue Orbit with the best coding agent', reg)!;
    const views = missionStepViews(plan, reg);
    expect(views[0]?.requiresConfirmation).toBe(true);
    expect(missionConsequentialCount(plan, reg)).toBe(1);
  });

  it('lists tool ids and flags consequential tools in the prompt', () => {
    const messages = buildMissionPrompt('do a thing', reg.all());
    const system = messages[0]!.content;
    expect(system).toContain(NATIVE_TOOL_IDS.dispatchAgent);
    expect(system).toContain('[consequential]');
    expect(messages[1]!.content).toBe('do a thing');
  });
});
