import { describe, expect, it } from 'vitest';
import { selectView } from './route.js';

describe('selectView', () => {
  it('renders the launcher by default', () => {
    expect(selectView({})).toBe('launcher');
    expect(selectView({ label: 'launcher', search: '', hash: '' })).toBe('launcher');
  });

  it('selects Settings from the window label regardless of the URL', () => {
    expect(selectView({ label: 'settings' })).toBe('settings');
    // The label wins even if the URL otherwise looks like the launcher.
    expect(selectView({ label: 'settings', search: '?view=launcher', hash: '#/' })).toBe(
      'settings',
    );
  });

  it('selects Settings from the ?view=settings query parameter', () => {
    expect(selectView({ search: '?view=settings' })).toBe('settings');
    expect(selectView({ label: 'launcher', search: '?foo=bar&view=settings' })).toBe('settings');
  });

  it('still selects Settings from a legacy #/settings hash (back-compat)', () => {
    expect(selectView({ hash: '#/settings' })).toBe('settings');
    expect(selectView({ hash: '#settings' })).toBe('settings');
    expect(selectView({ hash: '#/settings/general' })).toBe('settings');
  });

  it('does not mistake unrelated routes for Settings', () => {
    expect(selectView({ search: '?view=notes' })).toBe('launcher');
    expect(selectView({ search: '?settings=1' })).toBe('launcher'); // wrong param name
    expect(selectView({ hash: '#/settingsfoo' })).toBe('launcher'); // not a settings route
    expect(selectView({ label: 'launcher' })).toBe('launcher');
  });
});
