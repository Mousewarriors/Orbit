import { describe, expect, it } from 'vitest';
import type { CommandDefinition } from '@orbit/shared-types';
import {
  CommandRegistry,
  buildSignalsFromRegistry,
  canonicalHotkey,
  commandsToSearchItems,
  detectConflicts,
  isReserved,
  parseHotkey,
  HotkeyError,
} from './index.js';

function cmd(id: string, title: string, over: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id,
    title,
    mode: 'no-view',
    source: { kind: 'builtin' },
    category: 'Test',
    enabled: true,
    ...over,
  };
}

describe('CommandRegistry', () => {
  it('registers, lists and unregisters commands', () => {
    const r = new CommandRegistry();
    r.register(cmd('a', 'Alpha'));
    r.register(cmd('b', 'Beta', { enabled: false }));
    expect(r.list()).toHaveLength(2);
    expect(r.listEnabled()).toHaveLength(1);
    expect(r.unregister('a')).toBe(true);
    expect(r.list()).toHaveLength(1);
  });

  it('removes all commands from a crashed extension', () => {
    const r = new CommandRegistry();
    r.register(cmd('x.1', 'One', { source: { kind: 'extension', extensionId: 'x' } }));
    r.register(cmd('x.2', 'Two', { source: { kind: 'extension', extensionId: 'x' } }));
    r.register(cmd('core', 'Core'));
    expect(r.unregisterExtension('x')).toBe(2);
    expect(r.list().map((c) => c.id)).toEqual(['core']);
  });

  it('records usage cumulatively', () => {
    const r = new CommandRegistry();
    r.register(cmd('a', 'Alpha'));
    r.recordUsage('a', 100);
    r.recordUsage('a', 200);
    expect(r.getUsage('a')).toEqual({ commandId: 'a', useCount: 2, lastUsedAt: 200 });
  });

  it('exposes alias and hotkey maps', () => {
    const r = new CommandRegistry();
    r.register(cmd('a', 'Alpha'));
    r.setCustomisation({ commandId: 'a', alias: 'al', hotkey: 'Mod+Shift+A' });
    expect(r.aliasMap().get('al')).toBe('a');
    expect(r.hotkeyMap().get('a')).toBe('Mod+Shift+A');
  });
});

describe('command → search items', () => {
  it('produces items with a run action and alias keywords', () => {
    const r = new CommandRegistry();
    r.register(cmd('a', 'Alpha', { keywords: ['first'], synonyms: ['begin'] }));
    r.setCustomisation({ commandId: 'a', alias: 'al' });
    const items = commandsToSearchItems(r);
    expect(items[0]!.primaryAction.run).toEqual({
      kind: 'builtin',
      handler: 'run-command',
      args: { commandId: 'a' },
    });
    expect(items[0]!.aliases).toContain('al');
    expect(items[0]!.keywords).toEqual(['first', 'begin']);
  });

  it('builds ranking signals from usage and customisation', () => {
    const r = new CommandRegistry();
    r.register(cmd('a', 'Alpha'));
    r.recordUsage('a', 500);
    r.setCustomisation({ commandId: 'a', pinned: true, favourite: true });
    const signals = buildSignalsFromRegistry(r, 1000);
    expect(signals.usage.get('a')).toBe(1);
    expect(signals.lastUsed.get('a')).toBe(500);
    expect(signals.pinned.has('a')).toBe(true);
    expect(signals.favourites.has('a')).toBe(true);
  });
});

describe('hotkeys', () => {
  it('parses modifiers and keys', () => {
    const h = parseHotkey('Mod+Shift+K');
    expect(h.key).toBe('K');
    expect([...h.modifiers].sort()).toEqual(['mod', 'shift']);
  });

  it('normalises key aliases and allows modifier-only', () => {
    expect(parseHotkey('Alt+Space').key).toBe('Space');
    expect(parseHotkey('Ctrl').key).toBe('');
  });

  it('rejects two non-modifier keys', () => {
    expect(() => parseHotkey('A+B')).toThrow(HotkeyError);
  });

  it('canonicalises Mod per platform', () => {
    expect(canonicalHotkey('Mod+K', 'macos')).toBe('meta+K');
    expect(canonicalHotkey('Mod+K', 'windows')).toBe('ctrl+K');
    // order-independent
    expect(canonicalHotkey('Shift+Mod+K', 'windows')).toBe('ctrl+shift+K');
  });

  it('detects conflicts across logical bindings', () => {
    const bindings = new Map([
      ['cmd.a', 'Mod+K'],
      ['cmd.b', 'Ctrl+K'], // same as Mod+K on windows
      ['cmd.c', 'Alt+P'],
    ]);
    const conflicts = detectConflicts(bindings, 'windows');
    expect(conflicts).toHaveLength(1);
    expect([...conflicts[0]!.owners].sort()).toEqual(['cmd.a', 'cmd.b']);
    // On macOS, Mod=Meta so they no longer collide.
    expect(detectConflicts(bindings, 'macos')).toHaveLength(0);
  });

  it('flags reserved OS combinations', () => {
    expect(isReserved('Alt+F4', 'windows')).toBe(true);
    expect(isReserved('Mod+Q', 'macos')).toBe(true);
    expect(isReserved('Mod+Shift+J', 'windows')).toBe(false);
  });
});
