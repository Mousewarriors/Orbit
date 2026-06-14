import { describe, expect, it } from 'vitest';
import { acceleratorFromEvent, humanizeAccelerator, type KeyChord } from './index.js';

function chord(partial: Partial<KeyChord> & { code: string }): KeyChord {
  return { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...partial };
}

describe('acceleratorFromEvent', () => {
  it('returns null for lone modifier presses', () => {
    expect(acceleratorFromEvent(chord({ code: 'ControlLeft', ctrlKey: true }))).toBeNull();
    expect(acceleratorFromEvent(chord({ code: 'ShiftRight', shiftKey: true }))).toBeNull();
  });

  it('builds a plain key accelerator', () => {
    expect(acceleratorFromEvent(chord({ code: 'Space', altKey: true }))).toBe('Alt+Space');
  });

  it('orders modifiers canonically', () => {
    const acc = acceleratorFromEvent(
      chord({ code: 'KeyK', ctrlKey: true, shiftKey: true, altKey: true, metaKey: true }),
    );
    expect(acc).toBe('Control+Alt+Shift+Super+KeyK');
  });

  it('allows a modifier-less key', () => {
    expect(acceleratorFromEvent(chord({ code: 'F1' }))).toBe('F1');
  });
});

describe('humanizeAccelerator', () => {
  it('formats modifiers and key codes', () => {
    expect(humanizeAccelerator('Control+Shift+KeyK')).toBe('Ctrl + Shift + K');
    expect(humanizeAccelerator('Alt+Space')).toBe('Alt + Space');
    expect(humanizeAccelerator('Super+Digit1')).toBe('Win + 1');
    expect(humanizeAccelerator('Control+ArrowUp')).toBe('Ctrl + Up');
  });

  it('handles an empty string', () => {
    expect(humanizeAccelerator('')).toBe('');
  });
});
