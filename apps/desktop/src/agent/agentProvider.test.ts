import { describe, expect, it } from 'vitest';
import { createAgentProvider, detectAgentGoal } from './agentProvider.js';
import { decodeQuickAiArg } from '../ai/quickAi.js';

describe('detectAgentGoal', () => {
  it('extracts the goal from explicit agent phrasing', () => {
    expect(detectAgentGoal('agent: continue Orbit with the best agent')).toBe(
      'continue Orbit with the best agent',
    );
    expect(detectAgentGoal('have an agent fix the build')).toBe('fix the build');
    expect(detectAgentGoal('ask orbit to summarise the clipboard')).toBe('summarise the clipboard');
    expect(detectAgentGoal('restart relay for me')).toBe('restart relay');
    expect(detectAgentGoal('do research on competitors')).toBe('research on competitors');
  });

  it('does not trigger on ordinary searches or calculator input', () => {
    expect(detectAgentGoal('calculator')).toBeNull();
    expect(detectAgentGoal('125 * 4')).toBeNull();
    expect(detectAgentGoal('open calculator')).toBeNull();
    expect(detectAgentGoal('orbit')).toBeNull();
  });
});

describe('createAgentProvider', () => {
  const signal = new AbortController().signal;

  it('emits a mission item opening Orbit Agent pre-filled with the goal', async () => {
    const items = await createAgentProvider().search('agent: restart relay', signal);
    expect(items).toHaveLength(1);
    const run = items[0]!.primaryAction.run;
    expect(run.kind).toBe('push-view');
    if (run.kind !== 'push-view') throw new Error('expected push-view');
    expect(run.viewId).toBe('orbit-agent');
    expect(decodeQuickAiArg(String(run.args!['id'])).prompt).toBe('restart relay');
  });

  it('returns nothing for a non-agent query', async () => {
    expect(await createAgentProvider().search('calculator', signal)).toEqual([]);
  });
});
