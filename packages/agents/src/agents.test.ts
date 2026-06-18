import { describe, expect, it } from 'vitest';
import { AGENT_PROFILES, agentProfile, classifyGoalRole, recommendAgent } from './index.js';

describe('classifyGoalRole', () => {
  it('classifies by keyword, most specific first', () => {
    expect(classifyGoalRole('fix the failing build')).toBe('debugging');
    expect(classifyGoalRole('research competitor pricing')).toBe('research');
    expect(classifyGoalRole('plan the architecture')).toBe('planning');
    expect(classifyGoalRole('implement a login component')).toBe('coding');
    expect(classifyGoalRole('say hello')).toBe('general');
  });
});

describe('recommendAgent', () => {
  it('suggests a debugging specialist for a bug goal', () => {
    const rec = recommendAgent('fix the crash in the parser');
    expect(rec?.role).toBe('debugging');
    expect(rec?.agent.id).toBe('claude');
    expect(rec?.reason).toMatch(/debugging/);
  });

  it('suggests Codex for plain coding', () => {
    expect(recommendAgent('implement the export feature')?.agent.id).toBe('codex');
  });

  it('suggests OpenClaw for research', () => {
    expect(recommendAgent('investigate the outage')?.agent.id).toBe('openclaw');
  });
});

describe('catalogue', () => {
  it('exposes unique ids with non-empty strengths', () => {
    const ids = new Set(AGENT_PROFILES.map((a) => a.id));
    expect(ids.size).toBe(AGENT_PROFILES.length);
    for (const a of AGENT_PROFILES) expect(a.strengths.length).toBeGreaterThan(0);
    expect(agentProfile('claude')?.source).toBe('relay');
    expect(agentProfile('openclaw')?.source).toBe('gateway');
  });
});
