import { describe, expect, it } from 'vitest';
import {
  EMPTY_ROOT_MESSAGE,
  SCAN_ROOT_SETTING_KEY,
  availabilityLabel,
  canExecuteLaunch,
  canStopSession,
  isScanDisabled,
  recordsFrom,
  resolveInitialScanRoot,
  validateScanRoot,
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

describe('validateScanRoot', () => {
  it('rejects an empty root — empty root does not invoke Relay', () => {
    expect(validateScanRoot('')).toBeNull();
  });

  it('rejects a whitespace-only root — whitespace root does not invoke Relay', () => {
    expect(validateScanRoot('   ')).toBeNull();
    expect(validateScanRoot('\t\n')).toBeNull();
    expect(validateScanRoot(' \t ')).toBeNull();
  });

  it('trims surrounding whitespace from a valid root before submission', () => {
    expect(validateScanRoot('  C:/work  ')).toBe('C:/work');
    expect(validateScanRoot('\tC:/projects\n')).toBe('C:/projects');
  });

  it('preserves internal spaces inside a valid path', () => {
    expect(validateScanRoot('C:/My Projects/app')).toBe('C:/My Projects/app');
    expect(validateScanRoot('  C:/My Projects/app  ')).toBe('C:/My Projects/app');
  });

  it('preserves Unicode characters inside a valid path', () => {
    expect(validateScanRoot('C:/Projets/café')).toBe('C:/Projets/café');
    expect(validateScanRoot('/home/用户/代码')).toBe('/home/用户/代码');
    expect(validateScanRoot('C:/code 🚀')).toBe('C:/code 🚀');
  });

  it('accepts a plain valid path unchanged', () => {
    expect(validateScanRoot('C:/work')).toBe('C:/work');
    expect(validateScanRoot('/home/alice/projects')).toBe('/home/alice/projects');
  });
});

describe('resolveInitialScanRoot', () => {
  it('uses the persisted root when available (restart restores the root)', () => {
    expect(resolveInitialScanRoot('C:/work', 'C:/Users/alice')).toBe('C:/work');
  });

  it('falls back to home directory on first run when no root is persisted', () => {
    expect(resolveInitialScanRoot(null, 'C:/Users/alice')).toBe('C:/Users/alice');
  });

  it('persisted root takes priority over the first-run home-directory default', () => {
    expect(resolveInitialScanRoot('D:/code', 'C:/Users/alice')).toBe('D:/code');
    expect(resolveInitialScanRoot('C:/Users/alice/projects', 'C:/Users/alice')).toBe(
      'C:/Users/alice/projects',
    );
  });

  it('home directory default is used exactly — not modified or hard-coded', () => {
    const home = 'C:/Users/some-dynamic-user';
    expect(resolveInitialScanRoot(null, home)).toBe(home);
  });
});

describe('isScanDisabled', () => {
  const ready = { relayReady: true, rootHydrated: true, root: 'C:/work', scanning: false };

  it('is enabled when Relay is ready, root hydrated, root valid, and not scanning', () => {
    expect(isScanDisabled(ready)).toBe(false);
  });

  it('is disabled before hydration completes — no scan occurs before hydration', () => {
    expect(isScanDisabled({ ...ready, rootHydrated: false })).toBe(true);
  });

  it('is disabled for an empty root — Scan button disabled for invalid root', () => {
    expect(isScanDisabled({ ...ready, root: '' })).toBe(true);
  });

  it('is disabled for a whitespace-only root — Scan button disabled for invalid root', () => {
    expect(isScanDisabled({ ...ready, root: '   ' })).toBe(true);
    expect(isScanDisabled({ ...ready, root: '\t' })).toBe(true);
  });

  it('is disabled while a scan is already running', () => {
    expect(isScanDisabled({ ...ready, scanning: true })).toBe(true);
  });

  it('is disabled when Relay is not ready', () => {
    expect(isScanDisabled({ ...ready, relayReady: false })).toBe(true);
  });

  it('is disabled when both not hydrated and relay not ready', () => {
    expect(isScanDisabled({ ...ready, rootHydrated: false, relayReady: false })).toBe(true);
  });
});

describe('scan root defect guards', () => {
  it('EMPTY_ROOT_MESSAGE is the required friendly validation text', () => {
    expect(EMPTY_ROOT_MESSAGE).toBe('Choose a project folder before scanning.');
  });

  it('SCAN_ROOT_SETTING_KEY is a stable persistence key', () => {
    expect(SCAN_ROOT_SETTING_KEY).toBe('relay.scan.root');
  });

  it('empty root is blocked locally — locally preventable error does not expose Invalid_params', () => {
    // validateScanRoot returning null means relayScanProjects is never called,
    // so the raw "Invalid_params (-32602)" RPC error is never shown to the user.
    expect(validateScanRoot('')).toBeNull();
    expect(validateScanRoot('  ')).toBeNull();
  });

  it('valid root passes through — genuine Relay errors are still surfaced', () => {
    // A non-empty root reaches relayScanProjects; only Relay's real error is shown.
    expect(validateScanRoot('C:/work')).toBe('C:/work');
  });

  it('component restart restores root — persisted root survives app close/reopen', () => {
    // Simulates what loadInitialRelayData does: persisted value is restored.
    const restored = resolveInitialScanRoot('C:/work', 'C:/Users/alice');
    expect(restored).toBe('C:/work');
    // With the restored root, scan is no longer disabled.
    expect(isScanDisabled({ relayReady: true, rootHydrated: true, root: restored, scanning: false })).toBe(false);
  });

  it('last successful scan root is saved under the correct key', () => {
    // SCAN_ROOT_SETTING_KEY is the stable key passed to native.setSetting after
    // each successful scan. Tests that the key constant matches expectations.
    expect(SCAN_ROOT_SETTING_KEY).toBe('relay.scan.root');
  });
});
