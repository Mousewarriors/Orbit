import { describe, expect, it } from 'vitest';
import type { ActionDescriptor } from '@orbit/shared-types';
import { describeConfirmation, needsConfirmation } from './confirm.js';

function action(over: Partial<ActionDescriptor>): ActionDescriptor {
  return {
    id: 'a',
    title: 'Do Thing',
    run: { kind: 'copy', text: '' },
    ...over,
  };
}

describe('needsConfirmation', () => {
  it('is true only when the action is marked dangerous', () => {
    expect(needsConfirmation({ dangerous: true })).toBe(true);
    expect(needsConfirmation({ dangerous: false })).toBe(false);
    expect(needsConfirmation({})).toBe(false);
  });
});

describe('describeConfirmation', () => {
  it('gives specific copy for the Restart Relay command', () => {
    const p = describeConfirmation(
      action({
        title: 'Restart Relay',
        dangerous: true,
        run: { kind: 'builtin', handler: 'run-command', args: { commandId: 'builtin.cc.restart' } },
      }),
    );
    expect(p.title).toBe('Restart Relay?');
    expect(p.body).toMatch(/relay sidecar/i);
    expect(p.confirmLabel).toBe('Restart Relay');
  });

  it('gives replace copy for paste actions', () => {
    const p = describeConfirmation(action({ run: { kind: 'paste', text: 'hi' }, dangerous: true }));
    expect(p.title).toMatch(/replace/i);
    expect(p.confirmLabel).toBe('Replace');
  });

  it('falls back to a generic but honest warning', () => {
    const p = describeConfirmation(action({ title: 'Delete Everything', dangerous: true }));
    expect(p.title).toBe('Delete Everything?');
    expect(p.body).toMatch(/hard to undo/i);
    expect(p.confirmLabel).toBe('Delete Everything');
  });
});
