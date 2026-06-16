import { describe, expect, it } from 'vitest';
import {
  availabilityLabel,
  canExecuteLaunch,
  canStopSession,
  recordsFrom,
} from './relayViewModel.js';

describe('Relay view model', () => {
  it('normalizes keyed and array-shaped Relay list payloads', () => {
    expect(recordsFrom({ agents: [{ id: 'codex' }, null, 'skip'] }, 'agents')).toEqual([
      { id: 'codex' },
    ]);
    expect(recordsFrom([{ path: 'C:/work/app' }], 'projects')).toEqual([{ path: 'C:/work/app' }]);
  });

  it('maps agent availability into compact UI labels', () => {
    expect(availabilityLabel({ available: true })).toBe('Available');
    expect(availabilityLabel({ requiresGateway: true, available: true })).toBe('Gateway only');
    expect(availabilityLabel({ unavailableReason: 'binary not found' })).toBe('Not detected');
    expect(availabilityLabel({ capabilities: ['handoff'] })).toBe('Capability limited');
  });

  it('only treats Relay-owned or explicitly stoppable sessions as safe to stop', () => {
    expect(canStopSession({ ownership: 'owned', status: 'running' })).toBe(true);
    expect(canStopSession({ ownership: 'owned', status: 'starting' })).toBe(true);
    expect(canStopSession({ ownership: 'detached', status: 'running' })).toBe(false);
    expect(canStopSession({ ownership: 'owned', status: 'running', stoppable: false })).toBe(false);
    expect(canStopSession({ ownership: 'detached', status: 'unknown', stoppable: true })).toBe(true);
  });

  it('requires a ready Relay, a plan id, and explicit confirmation before launch', () => {
    expect(canExecuteLaunch({ planId: 'plan-1' }, true, true, null)).toBe(true);
    expect(canExecuteLaunch({ planId: 'plan-1' }, false, true, null)).toBe(false);
    expect(canExecuteLaunch({ planId: 'plan-1' }, true, false, null)).toBe(false);
    expect(canExecuteLaunch({}, true, true, null)).toBe(false);
    expect(canExecuteLaunch({ planId: 'plan-1' }, true, true, 'execute')).toBe(false);
  });
});
