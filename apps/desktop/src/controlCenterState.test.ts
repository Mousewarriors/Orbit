import { describe, expect, it } from 'vitest';
import {
  ALL_TABS,
  TAB_LABELS,
  decodeControlCenterArg,
  encodeControlCenterArg,
  initialState,
  isRelayReady,
  relayState,
  type ControlCenterTab,
} from './controlCenterState.js';

describe('Control Center state model', () => {
  it('ALL_TABS contains 7 tabs in the expected order', () => {
    expect(ALL_TABS).toEqual([
      'projects',
      'launch',
      'sessions',
      'activity',
      'handoffs',
      'approvals',
      'diagnostics',
    ]);
  });

  it('every tab has a label', () => {
    for (const tab of ALL_TABS) {
      expect(TAB_LABELS[tab]).toBeTruthy();
    }
  });

  it('initialState defaults to projects tab', () => {
    const state = initialState();
    expect(state.tab).toBe('projects');
    expect(state.relayStatus).toBeNull();
    expect(state.error).toBeNull();
    expect(state.busy).toBeNull();
  });

  it('initialState respects a custom initial tab', () => {
    expect(initialState('diagnostics').tab).toBe('diagnostics');
  });

  it('relayState returns stopped for null status', () => {
    expect(relayState(null)).toBe('stopped');
  });

  it('isRelayReady returns true only for ready state', () => {
    expect(isRelayReady(null)).toBe(false);
    const ready = { state: 'ready' } as Parameters<typeof isRelayReady>[0];
    expect(isRelayReady(ready)).toBe(true);
    const degraded = { state: 'degraded' } as Parameters<typeof isRelayReady>[0];
    expect(isRelayReady(degraded)).toBe(false);
  });

  it('encodes a bare tab as a plain string (back-compatible)', () => {
    expect(encodeControlCenterArg({ tab: 'sessions' })).toBe('sessions');
  });

  it('encodes a richer target as JSON', () => {
    const encoded = encodeControlCenterArg({ tab: 'launch', project: 'C:\\proj' });
    expect(encoded).not.toBe('launch');
    expect(decodeControlCenterArg(encoded)).toEqual({ tab: 'launch', project: 'C:\\proj' });
  });

  it('round-trips a session-status filter', () => {
    const encoded = encodeControlCenterArg({ tab: 'sessions', sessionStatus: 'failed' });
    expect(decodeControlCenterArg(encoded)).toEqual({ tab: 'sessions', sessionStatus: 'failed' });
  });

  it('round-trips a selected session', () => {
    const encoded = encodeControlCenterArg({ tab: 'sessions', sessionId: 'session-1' });
    expect(decodeControlCenterArg(encoded)).toEqual({
      tab: 'sessions',
      sessionId: 'session-1',
    });
  });

  it('round-trips continuation preferences and ignores invalid agents', () => {
    const encoded = encodeControlCenterArg({
      tab: 'launch',
      project: 'C:\\proj',
      agentPreference: 'codex',
      includeLatestHandoff: true,
    });
    expect(decodeControlCenterArg(encoded)).toEqual({
      tab: 'launch',
      project: 'C:\\proj',
      agentPreference: 'codex',
      includeLatestHandoff: true,
    });
    expect(
      decodeControlCenterArg('{"tab":"launch","agentPreference":"powershell"}'),
    ).toEqual({ tab: 'launch' });
  });

  it('decodes a bare tab name and tolerates junk', () => {
    expect(decodeControlCenterArg('activity')).toEqual({ tab: 'activity' });
    expect(decodeControlCenterArg(null)).toEqual({ tab: 'projects' });
    expect(decodeControlCenterArg('not json {')).toEqual({ tab: 'projects' });
    expect(decodeControlCenterArg('{"tab":"bogus"}')).toEqual({ tab: 'projects' });
  });

  it('tab failure isolation — each tab can have its own error', () => {
    const errors: Partial<Record<ControlCenterTab, string>> = {};
    errors['sessions'] = 'sessions failed';
    errors['activity'] = 'activity failed';
    expect(errors['sessions']).toBe('sessions failed');
    expect(errors['activity']).toBe('activity failed');
    expect(errors['projects']).toBeUndefined();
    expect(errors['launch']).toBeUndefined();
  });
});
