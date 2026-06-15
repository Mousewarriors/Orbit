/**
 * Settings render smoke test.
 *
 * Server-renders the real <Settings/> tree (no GUI, no Tauri) and asserts every
 * section label is present. This is the automated proof that the Settings window
 * paints its full navigation + content rather than a blank page — the failure
 * the routing fix + error boundary are meant to eliminate. Effects (which call
 * native IPC) do not run during server rendering, so no Tauri shell is needed.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Settings } from './Settings.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => undefined }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'settings' }) }));

const SECTIONS = [
  'General',
  'Appearance',
  'Snippets',
  'Files',
  'Extensions',
  'Privacy',
  'Developer',
];

describe('Settings window renders', () => {
  it('renders without throwing and shows every section', () => {
    const html = renderToString(createElement(Settings));
    for (const label of SECTIONS) {
      expect(html).toContain(label);
    }
    // Sanity: it produced a real, non-empty UI rather than a blank document.
    expect(html.length).toBeGreaterThan(200);
  });
});
