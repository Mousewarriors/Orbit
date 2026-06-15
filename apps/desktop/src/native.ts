/**
 * Typed wrappers over the Tauri IPC command surface. The renderer only ever
 * touches native capabilities through these functions, never raw `invoke`,
 * so the boundary stays auditable and mockable in tests.
 */
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface NativeApp {
  id: string;
  name: string;
  path: string;
  kind: string;
}

/** True when running inside the Tauri shell (vs. a plain browser/dev preview). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * The current Tauri window's label (e.g. "launcher" or "settings"), or null when
 * running outside Tauri. Read synchronously from the injected window metadata —
 * the renderer uses it to pick which root component to mount (see route.ts).
 */
export function currentWindowLabel(): string | null {
  if (!isTauri()) return null;
  try {
    return getCurrentWindow().label;
  } catch {
    return null;
  }
}

export async function listApplications(): Promise<NativeApp[]> {
  return invoke<NativeApp[]>('list_applications');
}

export async function reindexApplications(): Promise<number> {
  return invoke<number>('reindex_applications');
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>('get_setting', { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invoke('set_setting', { key, value });
}

export async function recordCommandUsage(commandId: string): Promise<void> {
  return invoke('record_command_usage', { commandId });
}

export async function usageSnapshot(): Promise<Array<[string, number, number]>> {
  return invoke<Array<[string, number, number]>>('usage_snapshot');
}

export async function launchPath(path: string): Promise<void> {
  return invoke('launch_path', { path });
}

export async function openUrl(url: string): Promise<void> {
  return invoke('open_url', { url });
}

/** Built-in window layout identifiers understood by the native side. */
export type WindowLayout =
  | 'left-half'
  | 'right-half'
  | 'top-half'
  | 'bottom-half'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center'
  | 'maximize'
  | 'almost-maximize'
  | 'reasonable-size'
  | 'first-third'
  | 'center-third'
  | 'last-third'
  | 'first-two-thirds'
  | 'last-two-thirds';

export async function manageWindow(layout: WindowLayout): Promise<void> {
  return invoke('manage_window', { layout });
}

export interface ClipboardEntry {
  id: number;
  kind: string;
  content: string;
  preview: string;
  source_app: string | null;
  sensitive: boolean;
  pinned: boolean;
  created_at: number;
}

export async function clipboardList(query: string, limit = 200): Promise<ClipboardEntry[]> {
  return invoke<ClipboardEntry[]>('clipboard_list', { query, limit });
}

export async function clipboardDelete(id: number): Promise<void> {
  return invoke('clipboard_delete', { id });
}

export async function clipboardClear(): Promise<number> {
  return invoke<number>('clipboard_clear');
}

export async function clipboardPin(id: number, pinned: boolean): Promise<void> {
  return invoke('clipboard_pin', { id, pinned });
}

export async function clipboardSet(content: string): Promise<void> {
  return invoke('clipboard_set', { content });
}

export interface Snippet {
  id: string;
  name: string;
  keyword: string | null;
  content: string;
  description: string | null;
  created_at: number;
  updated_at: number;
  use_count: number;
}

export async function snippetList(query: string, limit = 200): Promise<Snippet[]> {
  return invoke<Snippet[]>('snippet_list', { query, limit });
}

export async function snippetCreate(input: {
  id: string;
  name: string;
  keyword: string | null;
  content: string;
  description: string | null;
}): Promise<Snippet> {
  return invoke<Snippet>('snippet_create', input);
}

export async function snippetUpdate(input: {
  id: string;
  name: string;
  keyword: string | null;
  content: string;
  description: string | null;
}): Promise<Snippet> {
  return invoke<Snippet>('snippet_update', input);
}

export async function snippetDelete(id: string): Promise<void> {
  return invoke('snippet_delete', { id });
}

export async function snippetRecordUse(id: string): Promise<void> {
  return invoke('snippet_record_use', { id });
}

export interface Note {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  archived: boolean;
  created_at: number;
  updated_at: number;
}

export async function noteList(query: string, limit = 200): Promise<Note[]> {
  return invoke<Note[]>('note_list', { query, limit });
}

export async function noteCreate(input: {
  id: string;
  title: string;
  body: string;
}): Promise<Note> {
  return invoke<Note>('note_create', input);
}

export async function noteUpdate(input: {
  id: string;
  title: string;
  body: string;
}): Promise<Note> {
  return invoke<Note>('note_update', input);
}

export async function noteDelete(id: string): Promise<void> {
  return invoke('note_delete', { id });
}

export async function noteSetPinned(id: string, pinned: boolean): Promise<void> {
  return invoke('note_set_pinned', { id, pinned });
}

export interface Quicklink {
  id: string;
  title: string;
  target: string;
  icon: string | null;
  alias: string | null;
  hotkey: string | null;
  browser: string | null;
  pinned: boolean;
  created_at: number;
}

export async function quicklinkList(query: string, limit = 200): Promise<Quicklink[]> {
  return invoke<Quicklink[]>('quicklink_list', { query, limit });
}

export async function quicklinkCreate(input: {
  id: string;
  title: string;
  target: string;
  alias: string | null;
}): Promise<Quicklink> {
  return invoke<Quicklink>('quicklink_create', input);
}

export async function quicklinkUpdate(input: {
  id: string;
  title: string;
  target: string;
  alias: string | null;
}): Promise<Quicklink> {
  return invoke<Quicklink>('quicklink_update', input);
}

export async function quicklinkDelete(id: string): Promise<void> {
  return invoke('quicklink_delete', { id });
}

export interface FileRecord {
  path: string;
  name: string;
  parent: string;
  ext: string | null;
  kind: string;
  size: number;
  created_at: number | null;
  modified_at: number;
}

export interface FileIndexStatus {
  enabled: boolean;
  running: boolean;
  indexed: number;
  total: number;
  roots: string[];
  /** Epoch-ms of the last fully-completed index, or 0 if never. */
  last_indexed_at: number;
  /** Unreadable directories from the most-recent run (diagnostic). */
  errors: number;
  /** Configured roots that don't currently exist (diagnostic). */
  unavailable: string[];
}

export async function fileSearch(
  query: string,
  opts: { kind?: string; ext?: string; limit?: number } = {},
): Promise<FileRecord[]> {
  return invoke<FileRecord[]>('file_search', {
    query,
    kind: opts.kind ?? null,
    ext: opts.ext ?? null,
    limit: opts.limit ?? 50,
  });
}

export async function fileIndexStatus(): Promise<FileIndexStatus> {
  return invoke<FileIndexStatus>('file_index_status');
}

export async function fileIndexSetEnabled(enabled: boolean): Promise<FileIndexStatus> {
  return invoke<FileIndexStatus>('file_index_set_enabled', { enabled });
}

export async function fileIndexRebuild(): Promise<FileIndexStatus> {
  return invoke<FileIndexStatus>('file_index_rebuild');
}

/** Empty the file index on demand (without disabling indexing). */
export async function fileIndexClear(): Promise<FileIndexStatus> {
  return invoke<FileIndexStatus>('file_index_clear');
}

/** Reveal a path in the OS file manager (selects it on Windows). */
export async function revealPath(path: string): Promise<void> {
  return invoke('reveal_path', { path });
}

/** Runtime status of the system-wide snippet-expansion watcher. */
export interface WatcherStatus {
  running: boolean;
  keyword_count: number;
  supported: boolean;
}

export async function snippetWatcherStatus(): Promise<WatcherStatus> {
  return invoke<WatcherStatus>('snippet_watcher_status');
}

/** Enable/disable system-wide keyword expansion; persists and applies at once. */
export async function snippetWatcherSetEnabled(enabled: boolean): Promise<WatcherStatus> {
  return invoke<WatcherStatus>('snippet_watcher_set_enabled', { enabled });
}

/** Reinstall the keyboard hook (only acts when expansion is enabled). */
export async function snippetWatcherRestart(): Promise<WatcherStatus> {
  return invoke<WatcherStatus>('snippet_watcher_restart');
}

/** Inject text into the previously-focused window as real keystrokes. */
export async function pasteText(text: string): Promise<void> {
  return invoke('paste_text', { text });
}

export async function hideLauncher(): Promise<void> {
  return invoke('hide_launcher');
}

/** Open (or focus) the standalone Settings window. */
export async function openSettings(): Promise<void> {
  return invoke('open_settings');
}

/** Re-bind the global activation shortcut to `accelerator` (e.g. "Alt+Space"). */
export async function setActivationShortcut(accelerator: string): Promise<void> {
  return invoke('set_activation_shortcut', { accelerator });
}

export interface Diagnostics {
  version: string;
  data_dir: string;
  db_path: string;
  platform: string;
}

export async function diagnostics(): Promise<Diagnostics> {
  return invoke<Diagnostics>('diagnostics');
}

/** Reveal the application data directory in the OS file manager. */
export async function openDataDir(): Promise<void> {
  return invoke('open_data_dir');
}

// --- Extensions ---

export interface ExtCmdMeta {
  name: string;
  title: string;
  mode: string;
}

export interface ExtensionInfo {
  id: string;
  title: string;
  description: string;
  version: string;
  enabled: boolean;
  crashed: boolean;
  /** "disabled" | "unhealthy" | "degraded" | "ready". */
  health: string;
  command_count: number;
  commands: ExtCmdMeta[];
  permissions: string[];
  /** Absolute extension folder (for "Open folder"). */
  dir: string;
  last_error: string | null;
  /** Bounded tail of the most recent invocation's stderr (diagnostics). */
  recent_logs: string | null;
}

export interface ExtCommandInfo {
  ext_id: string;
  ext_title: string;
  command: string;
  title: string;
  mode: string;
  description: string | null;
  keywords: string[];
}

export interface ExtRunAction {
  kind: string;
  value: string;
}

export interface ExtRunItem {
  id: string;
  title: string;
  subtitle: string | null;
  action: ExtRunAction | null;
}

export interface ExtRunResult {
  items: ExtRunItem[];
  toast: string | null;
}

export async function extensionList(): Promise<ExtensionInfo[]> {
  return invoke<ExtensionInfo[]>('extension_list');
}

export async function extensionCommands(): Promise<ExtCommandInfo[]> {
  return invoke<ExtCommandInfo[]>('extension_commands');
}

export async function extensionRun(
  extId: string,
  command: string,
  query: string,
): Promise<ExtRunResult> {
  return invoke<ExtRunResult>('extension_run', { extId, command, query });
}

export async function extensionSetEnabled(extId: string, enabled: boolean): Promise<void> {
  return invoke('extension_set_enabled', { extId, enabled });
}

export async function extensionReload(): Promise<ExtensionInfo[]> {
  return invoke<ExtensionInfo[]>('extension_reload');
}

/** Reload a single extension by id (resets only its crash breaker). */
export async function extensionReloadOne(extId: string): Promise<ExtensionInfo[]> {
  return invoke<ExtensionInfo[]>('extension_reload_one', { extId });
}

export async function extensionErrors(): Promise<Array<[string, string]>> {
  return invoke<Array<[string, string]>>('extension_errors');
}

export async function extensionGetDevPaths(): Promise<string> {
  return invoke<string>('extension_get_dev_paths');
}

export async function extensionSetDevPaths(paths: string): Promise<ExtensionInfo[]> {
  return invoke<ExtensionInfo[]>('extension_set_dev_paths', { paths });
}

export async function quitApp(): Promise<void> {
  return invoke('quit_app');
}
