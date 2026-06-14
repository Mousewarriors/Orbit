//! Tauri IPC commands — the *only* surface the renderer can call into native
//! code. Each command validates its inputs and returns a `Result<_, String>` so
//! the renderer always receives a structured success or a human error message.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use orbit_input::platform as inject;
use rusqlite::Connection;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_opener::OpenerExt;

use crate::apps::{scan_applications, AppEntry};
use crate::snippet_watcher;
use crate::window_mgmt::platform as winmgmt;

/// The default activation shortcut when the user hasn't chosen one.
pub const DEFAULT_HOTKEY: &str = "Alt+Space";

/// Cap on snippet text size — generous for templates, bounded against abuse.
const MAX_SNIPPET_CONTENT: usize = 100_000;
const MAX_SNIPPET_FIELD: usize = 200;

/// Shared application state managed by Tauri and injected into commands.
pub struct AppState {
    pub db: Mutex<Connection>,
    /// Cached application index, refreshed by `reindex_applications`.
    pub apps: Mutex<Vec<AppEntry>>,
    /// Raw handle of the window focused immediately before Orbit was summoned,
    /// so window-management commands act on the user's previous window.
    pub last_foreground: Mutex<isize>,
    /// The currently-registered global activation shortcut, so the handler can
    /// match it and [`set_activation_shortcut`] can unregister the previous one.
    pub active_shortcut: Mutex<Option<Shortcut>>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn list_applications(state: State<'_, AppState>) -> Result<Vec<AppEntry>, String> {
    let apps = state.apps.lock().map_err(|e| e.to_string())?;
    Ok(apps.clone())
}

#[tauri::command]
pub fn reindex_applications(state: State<'_, AppState>) -> Result<usize, String> {
    let scanned = scan_applications();
    let count = scanned.len();
    let mut apps = state.apps.lock().map_err(|e| e.to_string())?;
    *apps = scanned;
    Ok(count)
}

#[tauri::command]
pub fn get_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    if key.is_empty() || key.len() > 200 {
        return Err("invalid setting key".into());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_command_usage(state: State<'_, AppState>, command_id: String) -> Result<(), String> {
    if command_id.is_empty() {
        return Err("missing command id".into());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::record_command_usage(&conn, &command_id, now_ms()).map_err(|e| e.to_string())
}

/// Returns usage rows as (command_id, use_count, last_used_at) for ranking.
#[tauri::command]
pub fn usage_snapshot(state: State<'_, AppState>) -> Result<Vec<(String, i64, i64)>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::usage_snapshot(&conn).map_err(|e| e.to_string())
}

/// Launch an application or open a file/folder via the OS default handler.
/// `path` must come from Orbit's own index; we never pass it to a shell.
#[tauri::command]
pub fn launch_path(app: AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("empty path".into());
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Open an external URL. Only http(s)/mailto schemes are permitted.
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    let ok = lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:");
    if !ok {
        return Err("unsupported url scheme".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Hide the launcher window (used by Escape from the renderer).
#[tauri::command]
pub fn hide_launcher(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("launcher") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn clipboard_list(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<orbit_core::ClipboardEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::clipboard::list(&conn, &query, limit.unwrap_or(200).clamp(1, 1000))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::clipboard::delete(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_clear(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::clipboard::clear(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_pin(state: State<'_, AppState>, id: i64, pinned: bool) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::clipboard::set_pinned(&conn, id, pinned).map_err(|e| e.to_string())
}

/// Write text back to the OS clipboard (used by "Copy to Clipboard").
#[tauri::command]
pub fn clipboard_set(content: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(content).map_err(|e| e.to_string())
}

/// Apply a built-in window layout (e.g. "left-half") to the user's previously
/// focused window. Returns a graceful error on unsupported platforms.
#[tauri::command]
pub fn manage_window(state: State<'_, AppState>, layout: String) -> Result<(), String> {
    let parsed = layout
        .parse::<orbit_window_manager::Layout>()
        .map_err(|_| format!("unknown layout '{layout}'"))?;
    let hwnd = *state.last_foreground.lock().map_err(|e| e.to_string())?;
    if hwnd == 0 {
        return Err("no recent window to manage".into());
    }
    // Gap is configurable later via settings; default to 0 for the slice.
    winmgmt::apply(hwnd, parsed, 0)
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

/// Rebuild the keyword→snippet and snippet→content maps used by the system-wide
/// expansion watcher. Called after every snippet mutation and once at startup.
pub fn refresh_watcher(conn: &Connection) {
    let Ok(keywords) = orbit_core::snippets::keyword_map(conn) else {
        return;
    };
    let mut content = std::collections::HashMap::new();
    if let Ok(all) = orbit_core::snippets::list(conn, "", 100_000) {
        for s in all {
            content.insert(s.id, s.content);
        }
    }
    snippet_watcher::set_snippets(keywords, content);
}

fn validate_snippet(
    id: &str,
    name: &str,
    keyword: &Option<String>,
    content: &str,
) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_SNIPPET_FIELD {
        return Err("invalid snippet id".into());
    }
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_SNIPPET_FIELD {
        return Err("snippet name must be 1–200 characters".into());
    }
    if let Some(k) = keyword {
        if k.chars().count() > MAX_SNIPPET_FIELD {
            return Err("snippet keyword too long".into());
        }
    }
    if content.is_empty() {
        return Err("snippet content must not be empty".into());
    }
    if content.len() > MAX_SNIPPET_CONTENT {
        return Err("snippet content too large".into());
    }
    Ok(())
}

#[tauri::command]
pub fn snippet_list(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<orbit_core::Snippet>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::snippets::list(&conn, &query, limit.unwrap_or(200).clamp(1, 1000))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn snippet_create(
    state: State<'_, AppState>,
    id: String,
    name: String,
    keyword: Option<String>,
    content: String,
    description: Option<String>,
) -> Result<orbit_core::Snippet, String> {
    let keyword = keyword.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    validate_snippet(&id, &name, &keyword, &content)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let snippet = orbit_core::snippets::create(
        &conn,
        &id,
        name.trim(),
        keyword.as_deref(),
        &content,
        description.as_deref(),
        now_ms(),
    )
    .map_err(|e| e.to_string())?;
    refresh_watcher(&conn);
    Ok(snippet)
}

#[tauri::command]
pub fn snippet_update(
    state: State<'_, AppState>,
    id: String,
    name: String,
    keyword: Option<String>,
    content: String,
    description: Option<String>,
) -> Result<orbit_core::Snippet, String> {
    let keyword = keyword.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    validate_snippet(&id, &name, &keyword, &content)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let snippet = orbit_core::snippets::update(
        &conn,
        &id,
        name.trim(),
        keyword.as_deref(),
        &content,
        description.as_deref(),
        now_ms(),
    )
    .map_err(|e| e.to_string())?;
    refresh_watcher(&conn);
    Ok(snippet)
}

#[tauri::command]
pub fn snippet_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::snippets::delete(&conn, &id).map_err(|e| e.to_string())?;
    refresh_watcher(&conn);
    Ok(())
}

#[tauri::command]
pub fn snippet_record_use(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::snippets::record_use(&conn, &id, now_ms()).map_err(|e| e.to_string())
}

/// Report whether the system-wide keyword-expansion watcher is running, how many
/// keywords it knows, and whether the platform supports it at all.
#[tauri::command]
pub fn snippet_watcher_status() -> snippet_watcher::WatcherStatus {
    snippet_watcher::status()
}

/// Enable or disable system-wide keyword expansion. Persists the preference,
/// (un)installs the keyboard hook immediately, and returns the new status. The
/// keyword maps are refreshed from the DB before starting so the hook is current.
#[tauri::command]
pub fn snippet_watcher_set_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<snippet_watcher::WatcherStatus, String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        orbit_core::set_setting(
            &conn,
            "snippets.expansion.enabled",
            if enabled { "true" } else { "false" },
        )
        .map_err(|e| e.to_string())?;
        if enabled {
            refresh_watcher(&conn);
        }
    }
    if enabled {
        snippet_watcher::start();
    } else {
        snippet_watcher::stop();
    }
    Ok(snippet_watcher::status())
}

/// Reinstall the keyboard hook (e.g. after the user reports it stopped firing).
/// No-op when expansion is disabled. Refreshes keywords from the DB first.
#[tauri::command]
pub fn snippet_watcher_restart(
    state: State<'_, AppState>,
) -> Result<snippet_watcher::WatcherStatus, String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        refresh_watcher(&conn);
    }
    // Only reinstall if expansion is actually enabled; restarting a stopped
    // watcher would silently turn it on.
    if snippet_watcher::status().running {
        snippet_watcher::restart();
    }
    Ok(snippet_watcher::status())
}

/// Inject `text` into the user's previously-focused window as real keystrokes.
/// The renderer hides the launcher first; we restore focus to the prior window
/// and type, which works in any app without clobbering the clipboard.
#[tauri::command]
pub fn paste_text(state: State<'_, AppState>, text: String) -> Result<(), String> {
    if text.is_empty() {
        return Err("nothing to paste".into());
    }
    let hwnd = *state.last_foreground.lock().map_err(|e| e.to_string())?;
    winmgmt::focus_window(hwnd);
    // Give the OS a moment to transfer focus before typing.
    std::thread::sleep(std::time::Duration::from_millis(40));
    inject::send_text(&text)
}

// ---------------------------------------------------------------------------
// Settings window + configuration
// ---------------------------------------------------------------------------

const SETTINGS_LABEL: &str = "settings";

/// Open (or focus, if already open) the standalone Settings window. It is a
/// normal decorated, resizable window — deliberately *not* the launcher.
#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        SETTINGS_LABEL,
        WebviewUrl::App("index.html#/settings".into()),
    )
    .title("Orbit Settings")
    .inner_size(820.0, 600.0)
    .min_inner_size(640.0, 460.0)
    .resizable(true)
    .center()
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Change the global activation shortcut. Parses the accelerator, unregisters the
/// previous shortcut, registers the new one, persists it, and updates state so
/// the handler matches. Returns a clear error if the accelerator is invalid.
#[tauri::command]
pub fn set_activation_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    accelerator: String,
) -> Result<(), String> {
    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|_| format!("'{accelerator}' is not a valid shortcut"))?;
    let gs = app.global_shortcut();
    // Unregister the previous shortcut (best-effort) before claiming the new one.
    if let Ok(prev) = state.active_shortcut.lock() {
        if let Some(p) = prev.as_ref() {
            let _ = gs.unregister(*p);
        }
    }
    gs.register(shortcut)
        .map_err(|e| format!("could not register shortcut (already in use?): {e}"))?;
    *state.active_shortcut.lock().map_err(|e| e.to_string())? = Some(shortcut);
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    orbit_core::set_setting(&conn, "general.hotkey", &accelerator).map_err(|e| e.to_string())
}

/// Read-only diagnostics for the Developer settings section.
#[derive(serde::Serialize)]
pub struct Diagnostics {
    pub version: String,
    pub data_dir: String,
    pub db_path: String,
    pub platform: String,
}

#[tauri::command]
pub fn diagnostics(app: AppHandle) -> Result<Diagnostics, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();
    let db_path = format!("{data_dir}/orbit.sqlite");
    Ok(Diagnostics {
        version: app.package_info().version.to_string(),
        data_dir,
        db_path,
        platform: std::env::consts::OS.to_string(),
    })
}

/// Reveal the application data directory in the OS file manager.
#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
