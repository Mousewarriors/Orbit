/**
 * Typed wrappers over the Tauri IPC command surface. The renderer only ever
 * touches native capabilities through these functions, never raw `invoke`,
 * so the boundary stays auditable and mockable in tests.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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

export async function openProjectInApplication(
  applicationId: string,
  projectPath: string,
): Promise<void> {
  return invoke('open_project_in_application', { applicationId, projectPath });
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

// --- AI Chat ---

export interface Chat {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  model: string | null;
  parent_chat_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  seq: number;
  created_at: number;
}

export async function chatList(query = '', limit = 100): Promise<Chat[]> {
  return invoke<Chat[]>('chat_list', { query, limit });
}

export async function chatCreate(id: string, title: string): Promise<Chat> {
  return invoke<Chat>('chat_create', { id, title });
}

export async function chatRename(id: string, title: string): Promise<void> {
  return invoke('chat_rename', { id, title });
}

export async function chatSetPinned(id: string, pinned: boolean): Promise<void> {
  return invoke('chat_set_pinned', { id, pinned });
}

export async function chatDelete(id: string): Promise<void> {
  return invoke('chat_delete', { id });
}

export async function chatAddMessage(
  id: string,
  chatId: string,
  role: ChatMessage['role'],
  content: string,
  model: string | null,
): Promise<ChatMessage> {
  return invoke<ChatMessage>('chat_add_message', { id, chatId, role, content, model });
}

export async function chatMessages(chatId: string): Promise<ChatMessage[]> {
  return invoke<ChatMessage[]>('chat_messages', { chatId });
}

export async function chatDeleteFrom(chatId: string, fromSeq: number): Promise<void> {
  return invoke('chat_delete_from', { chatId, fromSeq });
}

export async function chatBranch(
  newId: string,
  fromChat: string,
  uptoSeq: number,
  title: string,
): Promise<Chat> {
  return invoke<Chat>('chat_branch', { newId, fromChat, uptoSeq, title });
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

/** Returns the current user's home directory via Tauri's trusted path resolver. */
export async function getHomeDir(): Promise<string> {
  return invoke<string>('get_home_dir');
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

/**
 * Install Orbit's bundled sample extensions (Developer Utilities, AgentOS
 * Controller) into the local extensions folder if they aren't already
 * present, then reload. Safe to call repeatedly.
 */
export async function extensionInstallBundled(): Promise<ExtensionInfo[]> {
  return invoke<ExtensionInfo[]>('extension_install_bundled');
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

/** Whether Orbit is registered to launch at login. */
export async function getAutostart(): Promise<boolean> {
  return invoke<boolean>('get_autostart');
}

/** Enable/disable launching Orbit at login. */
export async function setAutostart(enabled: boolean): Promise<void> {
  return invoke('set_autostart', { enabled });
}

export async function quitApp(): Promise<void> {
  return invoke('quit_app');
}

// --- Project metadata ---

export interface ProjectMeta {
  path: string;
  name: string | null;
  favourite: boolean;
  last_opened_at: number;
  preferred_agent: string | null;
  build_brief: string | null;
  docs_path: string | null;
  preview_url: string | null;
  studio_url: string | null;
  created_at: number;
}

export async function projectMetaGet(path: string): Promise<ProjectMeta | null> {
  return invoke<ProjectMeta | null>('project_meta_get', { path });
}

export async function projectMetaUpsert(
  path: string,
  name: string | null,
): Promise<ProjectMeta> {
  return invoke<ProjectMeta>('project_meta_upsert', { path, name });
}

export async function projectMetaCatalogue(
  path: string,
  name: string | null,
): Promise<ProjectMeta> {
  return invoke<ProjectMeta>('project_meta_catalogue', { path, name });
}

export async function projectMetaTouch(path: string): Promise<void> {
  return invoke('project_meta_touch', { path });
}

export async function projectMetaSetFavourite(
  path: string,
  favourite: boolean,
): Promise<void> {
  return invoke('project_meta_set_favourite', { path, favourite });
}

export async function projectMetaSetPreferredAgent(
  path: string,
  agentId: string | null,
): Promise<void> {
  return invoke('project_meta_set_preferred_agent', { path, agentId });
}

export async function projectMetaListRecent(limit = 20): Promise<ProjectMeta[]> {
  return invoke<ProjectMeta[]>('project_meta_list_recent', { limit });
}

export async function projectMetaListFavourites(): Promise<ProjectMeta[]> {
  return invoke<ProjectMeta[]>('project_meta_list_favourites');
}

export async function projectMetaListCatalogued(limit = 500): Promise<ProjectMeta[]> {
  return invoke<ProjectMeta[]>('project_meta_list_catalogued', { limit });
}

// --- Orbit Relay ---

export type RelaySupervisorState =
  | 'stopped'
  | 'starting'
  | 'awaiting-ready'
  | 'ready'
  | 'degraded'
  | 'restarting'
  | 'incompatible'
  | 'failed'
  | 'shutting-down';

export interface RelayReadyPayload {
  implementationVersion: string;
  protocolVersion: string;
  minimumClientProtocolVersion: string;
  protocolCompatibilityRange: string | null;
  maxRequestLineBytes: number | null;
  methods: string[];
  notifications: string[];
  capabilities: string[];
}

export interface RelayExpectedMetadata {
  relayVersion: string;
  protocolVersion: string;
  minimumClientProtocolVersion: string;
  protocolCompatibilityRange: string;
  targetTriple: string;
  sidecarName: string;
  sidecarFileName: string;
  certifiedCommit: string;
  expectedSha256: string;
}

export interface RelayStatus {
  appVersion: string;
  buildCommit: string;
  buildTimestamp: string;
  executablePath: string | null;
  state: RelaySupervisorState;
  expected: RelayExpectedMetadata;
  userMessage: string;
  technicalDetail: string | null;
  diagnostics: string[];
  ready: RelayReadyPayload | null;
  health: unknown | null;
  capabilities: unknown | null;
  missingMethods: string[];
  pid: number | null;
  sidecarPath: string | null;
  sidecarSha256: string | null;
  pendingRequests: number;
  lastExitCode: number | null;
  lastStateChangeMs: number;
}

export type RelayRecord = Record<string, unknown>;

export async function relayStatus(): Promise<RelayStatus> {
  return invoke<RelayStatus>('relay_status');
}

export async function relayHealth(): Promise<unknown> {
  return invoke<unknown>('relay_health');
}

export async function relayCapabilities(): Promise<unknown> {
  return invoke<unknown>('relay_capabilities');
}

export async function relayListAgents(): Promise<unknown> {
  return invoke<unknown>('relay_list_agents');
}

export async function relayGetAgent(agentId: string): Promise<unknown> {
  return invoke<unknown>('relay_get_agent', { agentId });
}

export async function relayScanProjects(root: string | null): Promise<unknown> {
  return invoke<unknown>('relay_scan_projects', { root });
}

export async function relayInspectProject(path: string): Promise<unknown> {
  return invoke<unknown>('relay_inspect_project', { path });
}

export async function relayCreateLaunchPlan(
  agentId: string,
  projectPath: string,
): Promise<unknown> {
  return invoke<unknown>('relay_create_launch_plan', { agentId, projectPath });
}

export async function relayExecuteLaunch(planId: string, confirm: boolean): Promise<unknown> {
  return invoke<unknown>('relay_execute_launch', { planId, confirm });
}

export async function relayListSessions(): Promise<unknown> {
  return invoke<unknown>('relay_list_sessions');
}

export async function relayGetSession(sessionId: string): Promise<unknown> {
  return invoke<unknown>('relay_get_session', { sessionId });
}

export async function relayStopSession(sessionId: string): Promise<unknown> {
  return invoke<unknown>('relay_stop_session', { sessionId });
}

export async function relayCreateHandoff(input: {
  projectPath: string;
  fromAgentId: string;
  toAgentId: string;
  objective: string | null;
}): Promise<unknown> {
  return invoke<unknown>('relay_create_handoff', input);
}

export async function relayValidateHandoff(path: string): Promise<unknown> {
  return invoke<unknown>('relay_validate_handoff', { path });
}

export async function relayListEvents(): Promise<unknown> {
  return invoke<unknown>('relay_list_events');
}

export async function relayRestart(): Promise<RelayStatus> {
  return invoke<RelayStatus>('relay_restart');
}

export async function onRelayStateChanged(
  handler: (status: RelayStatus) => void,
): Promise<UnlistenFn> {
  return listen<RelayStatus>('relay-state-changed', (event) => handler(event.payload));
}

export async function onRelayDiagnosticsUpdated(
  handler: (status: RelayStatus) => void,
): Promise<UnlistenFn> {
  return listen<RelayStatus>('relay-diagnostics-updated', (event) => handler(event.payload));
}

export async function onRelaySessionEvent(
  handler: (payload: unknown) => void,
): Promise<UnlistenFn[]> {
  const names = [
    'relay-session-started',
    'relay-session-changed',
    'relay-session-completed',
    'relay-session-failed',
    'relay-session-stopped',
  ];
  return Promise.all(names.map((name) => listen<unknown>(name, (event) => handler(event.payload))));
}

// --- Native HTTP bridge (AI providers + HTTP MCP) ---

export interface HttpResponse {
  status: number;
  body: string;
}

export interface HttpStreamEvent {
  id: string;
  kind: 'chunk' | 'end' | 'error';
  /** base64 bytes for `chunk`; an error message for `error`; empty for `end`. */
  data: string;
  status: number;
}

/** One-shot HTTP request through the native client (http/https only). */
export async function httpRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string | null,
): Promise<HttpResponse> {
  return invoke<HttpResponse>('http_request', { method, url, headers, body: body ?? null });
}

/** Begin a streamed HTTP request; body chunks arrive on the `http-stream` event. */
export async function httpStreamOpen(
  id: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string | null,
): Promise<void> {
  return invoke('http_stream_open', { id, method, url, headers, body: body ?? null });
}

/** Cancel an in-flight streamed request. */
export async function httpStreamCancel(id: string): Promise<void> {
  return invoke('http_stream_cancel', { id });
}

/** Subscribe to streamed HTTP chunks (filter by `id` in the handler). */
export async function onHttpStream(handler: (ev: HttpStreamEvent) => void): Promise<UnlistenFn> {
  return listen<HttpStreamEvent>('http-stream', (event) => handler(event.payload));
}

// --- Native stdio MCP host (long-lived child-process MCP servers) ---

/** Open (or re-open) a stdio MCP connection under `id` for `command args`. */
export async function mcpStdioOpen(
  id: string,
  command: string,
  args: string[],
  cwd?: string | null,
): Promise<void> {
  return invoke('mcp_stdio_open', { id, command, args, cwd: cwd ?? null });
}

/** Send one JSON-RPC request line; resolves with the matching response line. */
export async function mcpStdioRequest(
  id: string,
  request: string,
  timeoutMs?: number,
): Promise<string> {
  return invoke<string>('mcp_stdio_request', { id, request, timeoutMs: timeoutMs ?? null });
}

/** Recent stderr lines from a stdio MCP connection (diagnostics only). */
export async function mcpStdioLogs(id: string): Promise<string[]> {
  return invoke<string[]>('mcp_stdio_logs', { id });
}

/** Close a stdio MCP connection and kill its child process. */
export async function mcpStdioClose(id: string): Promise<void> {
  return invoke('mcp_stdio_close', { id });
}

// --- OS secure storage (credentials) ---

/** Store a secret (e.g. an API key) in OS secure storage. Never persisted elsewhere. */
export async function secretSet(key: string, value: string): Promise<void> {
  return invoke('secret_set', { key, value });
}

export async function secretGet(key: string): Promise<string | null> {
  return invoke<string | null>('secret_get', { key });
}

export async function secretDelete(key: string): Promise<void> {
  return invoke('secret_delete', { key });
}

export async function secretHas(key: string): Promise<boolean> {
  return invoke<boolean>('secret_has', { key });
}

// --- OAuth loopback (subscription sign-in) ---

export interface OauthCallbackEvent {
  requestId: string;
  code: string | null;
  state: string | null;
  error: string | null;
}

/**
 * Bind a one-shot loopback HTTP server on `127.0.0.1:port` that captures the
 * OAuth redirect to `path`. Resolves with the actually-bound port once listening
 * (bind happens before this resolves, so it's safe to open the browser after).
 * The captured `code`/`state` arrive on the `oauth-callback` event.
 */
export async function oauthListen(
  requestId: string,
  port: number,
  path: string,
  timeoutMs: number,
): Promise<number> {
  return invoke<number>('oauth_listen', { requestId, port, path, timeoutMs });
}

/** Stop a pending loopback listener (e.g. on timeout / cancel). */
export async function oauthCancel(requestId: string): Promise<void> {
  return invoke('oauth_cancel', { requestId });
}

/** Subscribe to OAuth redirect callbacks (filter by `requestId`). */
export async function onOauthCallback(
  handler: (ev: OauthCallbackEvent) => void,
): Promise<UnlistenFn> {
  return listen<OauthCallbackEvent>('oauth-callback', (event) => handler(event.payload));
}
