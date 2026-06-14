/**
 * Permission identifiers. The native permission broker (Rust) is the source of
 * truth for whether a permission is actually granted; these strings are the
 * stable wire identifiers used in manifests and approval prompts.
 */
export type PermissionId =
  | 'clipboard.read'
  | 'clipboard.write'
  | 'files.read'
  | 'files.write'
  | 'apps.launch'
  | 'apps.enumerate'
  | 'window.manage'
  | 'system.commands'
  | 'network'
  | 'selected-text.read'
  | 'text.insert'
  | 'browser.context'
  | 'calendar.read'
  | 'calendar.write'
  | 'ai'
  | 'shell.execute'
  | 'secure-storage';

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable';

export interface PermissionRequirement {
  readonly id: PermissionId;
  /** Human-readable reason shown to the user at the approval prompt. */
  readonly reason: string;
  /** If false the item still appears but its primary action is gated. */
  readonly required: boolean;
}
