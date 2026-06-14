/**
 * Pure helpers for global-shortcut accelerators.
 *
 * The accelerator string format matches what the native side
 * (`tauri-plugin-global-shortcut` / the `global-hotkey` crate) parses: modifier
 * names joined to a `KeyboardEvent.code` with `+`, e.g. `Alt+Space`,
 * `Control+Shift+KeyK`, `Super+KeyO`. Keeping the builder and the human-readable
 * formatter here makes them unit-testable and reusable by both windows.
 */

/** The minimal slice of a KeyboardEvent we need to build an accelerator. */
export interface KeyChord {
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  /** `KeyboardEvent.code`, e.g. "Space", "KeyK", "Digit1". */
  readonly code: string;
}

/** `KeyboardEvent.code` values that are modifiers on their own (not a chord). */
const LONE_MODIFIERS = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight',
]);

/**
 * Build an accelerator string from a key chord, or `null` when the press is only
 * a modifier (so a recorder keeps waiting for the real key). Modifier order is
 * canonical: Control, Alt, Shift, Super.
 */
export function acceleratorFromEvent(e: KeyChord): string | null {
  if (LONE_MODIFIERS.has(e.code) || e.code === '') return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  parts.push(e.code);
  return parts.join('+');
}

const MOD_LABELS: Readonly<Record<string, string>> = {
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Super: 'Win',
  CommandOrControl: 'Ctrl',
  CmdOrCtrl: 'Ctrl',
};

/** Turn a single `KeyboardEvent.code`-style token into a readable key label. */
function humanizeKey(token: string): string {
  if (token in MOD_LABELS) return MOD_LABELS[token]!;
  if (token.startsWith('Key')) return token.slice(3);
  if (token.startsWith('Digit')) return token.slice(5);
  if (token.startsWith('Numpad')) return `Num ${token.slice(6)}`;
  if (token.startsWith('Arrow')) return token.slice(5);
  return token;
}

/** Human-readable form of an accelerator, e.g. `Control+Shift+KeyK` → `Ctrl + Shift + K`. */
export function humanizeAccelerator(accelerator: string): string {
  if (!accelerator) return '';
  return accelerator
    .split('+')
    .map((t) => humanizeKey(t.trim()))
    .filter(Boolean)
    .join(' + ');
}
