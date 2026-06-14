/**
 * Typed wrappers over the Tauri IPC command surface. The renderer only ever
 * touches native capabilities through these functions, never raw `invoke`,
 * so the boundary stays auditable and mockable in tests.
 */
import { invoke } from '@tauri-apps/api/core';

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

export async function quitApp(): Promise<void> {
  return invoke('quit_app');
}
