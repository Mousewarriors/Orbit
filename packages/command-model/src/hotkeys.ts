/**
 * Hotkey parsing, normalisation and conflict detection.
 *
 * Accelerators are written like "Mod+Shift+K" / "Alt+Space". "Mod" is the
 * platform-primary modifier (Cmd on macOS, Ctrl on Windows/Linux) and is
 * normalised so the same logical binding compares equal across platforms.
 */

export type Platform = 'windows' | 'macos' | 'linux';

export interface ParsedHotkey {
  readonly modifiers: ReadonlySet<'mod' | 'ctrl' | 'alt' | 'shift' | 'meta'>;
  readonly key: string; // normalised, uppercase for letters
}

export class HotkeyError extends Error {}

type Modifier = 'mod' | 'ctrl' | 'alt' | 'shift' | 'meta';

const MOD_ALIASES: Readonly<Record<string, Modifier>> = {
  mod: 'mod',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  win: 'meta',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

const KEY_ALIASES: Readonly<Record<string, string>> = {
  space: 'Space',
  spacebar: 'Space',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  del: 'Delete',
  delete: 'Delete',
  backspace: 'Backspace',
};

export function parseHotkey(accelerator: string): ParsedHotkey {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new HotkeyError('Empty hotkey');

  const modifiers = new Set<'mod' | 'ctrl' | 'alt' | 'shift' | 'meta'>();
  let key: string | null = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower in MOD_ALIASES) {
      modifiers.add(MOD_ALIASES[lower]!);
      continue;
    }
    if (key !== null) {
      throw new HotkeyError(`Hotkey "${accelerator}" has multiple non-modifier keys`);
    }
    if (lower in KEY_ALIASES) {
      key = KEY_ALIASES[lower]!;
    } else if (part.length === 1) {
      key = part.toUpperCase();
    } else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(part)) {
      key = part.toUpperCase();
    } else {
      key = part;
    }
  }

  if (key === null) {
    // Modifier-only hotkeys are allowed (e.g. double-tap), represented with key ''.
    return { modifiers, key: '' };
  }
  return { modifiers, key };
}

/**
 * Canonical string for equality/conflict checks. "Mod" is resolved to the
 * concrete modifier for the platform so cross-platform configs don't collide
 * incorrectly, then modifiers are sorted.
 */
export function canonicalHotkey(accelerator: string, platform: Platform): string {
  const { modifiers, key } = parseHotkey(accelerator);
  const resolved = new Set<string>();
  for (const m of modifiers) {
    if (m === 'mod') resolved.add(platform === 'macos' ? 'meta' : 'ctrl');
    else resolved.add(m);
  }
  const order = ['ctrl', 'alt', 'shift', 'meta'];
  const mods = [...resolved].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...mods, key].filter(Boolean).join('+');
}

export interface HotkeyConflict {
  readonly accelerator: string;
  readonly canonical: string;
  readonly owners: ReadonlyArray<string>;
}

/**
 * Detect conflicts among a map of ownerId → accelerator. Two bindings conflict
 * if they canonicalise to the same combination on the target platform.
 */
export function detectConflicts(
  bindings: ReadonlyMap<string, string>,
  platform: Platform,
): HotkeyConflict[] {
  const byCanonical = new Map<string, { accelerator: string; owners: string[] }>();
  for (const [owner, accel] of bindings) {
    let canonical: string;
    try {
      canonical = canonicalHotkey(accel, platform);
    } catch {
      continue; // invalid bindings are reported elsewhere
    }
    const entry = byCanonical.get(canonical);
    if (entry) entry.owners.push(owner);
    else byCanonical.set(canonical, { accelerator: accel, owners: [owner] });
  }
  const conflicts: HotkeyConflict[] = [];
  for (const [canonical, { accelerator, owners }] of byCanonical) {
    if (owners.length > 1) conflicts.push({ accelerator, canonical, owners });
  }
  return conflicts;
}

/** Reserved OS-level combinations we should warn about when recording. */
const RESERVED: Readonly<Record<Platform, ReadonlyArray<string>>> = {
  windows: ['ctrl+alt+Delete', 'meta+L', 'alt+Tab', 'alt+F4'],
  macos: ['meta+Q', 'meta+Space', 'meta+Tab'],
  linux: ['ctrl+alt+Delete', 'alt+Tab'],
};

export function isReserved(accelerator: string, platform: Platform): boolean {
  let canonical: string;
  try {
    canonical = canonicalHotkey(accelerator, platform);
  } catch {
    return false;
  }
  return RESERVED[platform].some((r) => canonicalHotkey(r, platform) === canonical);
}
