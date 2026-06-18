import { describe, expect, it } from 'vitest';
import {
  createAutomationProvider,
  decodeAutomationArg,
  encodeAutomationArg,
} from './automationProvider.js';

const signal = new AbortController().signal;

describe('automation arg codec', () => {
  it('round-trips an automation id', () => {
    expect(decodeAutomationArg(encodeAutomationArg('restart-relay'))).toBe('restart-relay');
    expect(decodeAutomationArg('just a prompt')).toBeNull();
    expect(decodeAutomationArg(undefined)).toBeNull();
  });
});

describe('createAutomationProvider', () => {
  it('matches automations by keyword and opens Orbit Agent with auto:<id>', async () => {
    const items = await createAutomationProvider().search('approvals', signal);
    const approvals = items.find((i) => i.id === 'automation.review-approvals')!;
    const run = approvals.primaryAction.run;
    expect(run.kind).toBe('push-view');
    if (run.kind !== 'push-view') throw new Error('expected push-view');
    expect(run.viewId).toBe('orbit-agent');
    expect(decodeAutomationArg(String(run.args!['id']))).toBe('review-approvals');
  });

  it('lists everything for the word "automation"', async () => {
    const items = await createAutomationProvider().search('automation', signal);
    expect(items.length).toBeGreaterThanOrEqual(5);
  });
});
