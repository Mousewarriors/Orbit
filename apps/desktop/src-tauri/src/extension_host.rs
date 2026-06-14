//! Extension host: discovers extensions, runs them as isolated child processes,
//! and brokers what they're allowed to do.
//!
//! Each invocation spawns the extension's entry script with `node` as a fresh
//! child process (so a crash can only ever fail that one invocation, never the
//! launcher), writes a single JSON `invoke` request to stdin, and reads one JSON
//! response from stdout under a timeout. The pure decision logic — manifest
//! validation, the RPC schema, the permission broker and crash-loop protection —
//! lives in `orbit-extensions`; this module is the OS plumbing around it.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use orbit_extensions::{
    allowed_effects, discover_in, manifest::Manifest, parse_response, CrashTracker, Effect,
    InvokeRequest, InvokeResponse,
};

use crate::commands::AppState;

/// Hard cap on how long an extension invocation may run before it is killed.
const INVOKE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_ITEMS: usize = 200;
const MAX_STORAGE_KEYS: usize = 200;
const MAX_STORAGE_VALUE: usize = 100_000;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// One discovered + loaded extension.
struct LoadedExt {
    id: String,
    dir: PathBuf,
    manifest: Manifest,
    crash: CrashTracker,
}

struct HostInner {
    exts: Vec<LoadedExt>,
    /// Folders that failed to load, with the reason (surfaced in Settings).
    errors: Vec<(String, String)>,
}

/// Process-wide extension host state (held in `AppState`).
pub struct ExtensionHost {
    inner: Mutex<HostInner>,
}

impl Default for ExtensionHost {
    fn default() -> Self {
        ExtensionHost {
            inner: Mutex::new(HostInner {
                exts: Vec::new(),
                errors: Vec::new(),
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtensionInfo {
    pub id: String,
    pub title: String,
    pub version: String,
    pub enabled: bool,
    /// True when crash-loop protection has tripped (host refuses to invoke).
    pub crashed: bool,
    pub command_count: usize,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtCommandInfo {
    pub ext_id: String,
    pub ext_title: String,
    pub command: String,
    pub title: String,
    pub mode: String,
    pub description: Option<String>,
    pub keywords: Vec<String>,
}

/// A brokered, renderer-facing item action (already permission-checked).
#[derive(Debug, Clone, Serialize)]
pub struct RunAction {
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunItem {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub action: Option<RunAction>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunResult {
    pub items: Vec<RunItem>,
    pub toast: Option<String>,
}

/// Discovery roots: `<app data>/extensions` plus any newline-separated dev paths
/// from the `extensions.dev_paths` setting (so samples can be loaded from the
/// repo during development). The app-data dir is created if missing.
pub fn roots(app: &AppHandle, conn: &rusqlite::Connection) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = app.path().app_data_dir() {
        let ext_dir = dir.join("extensions");
        let _ = std::fs::create_dir_all(&ext_dir);
        roots.push(ext_dir);
    }
    if let Some(raw) = orbit_core::get_setting(conn, "extensions.dev_paths").ok().flatten() {
        for line in raw.lines().map(str::trim).filter(|l| !l.is_empty()) {
            roots.push(PathBuf::from(line));
        }
    }
    roots
}

fn effect_to_action(effect: &Effect) -> RunAction {
    match effect {
        Effect::OpenUrl { url } => RunAction { kind: "open-url".into(), value: url.clone() },
        Effect::Copy { text } => RunAction { kind: "copy".into(), value: text.clone() },
        Effect::OpenPath { path } => RunAction { kind: "open-path".into(), value: path.clone() },
    }
}

/// Perform a single brokered effect natively. URL schemes are re-checked here.
fn perform_effect(app: &AppHandle, effect: &Effect) {
    match effect {
        Effect::OpenUrl { url } => {
            let lower = url.to_ascii_lowercase();
            if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:") {
                let _ = app.opener().open_url(url.clone(), None::<&str>);
            }
        }
        Effect::OpenPath { path } => {
            let _ = app.opener().open_path(path.clone(), None::<&str>);
        }
        Effect::Copy { text } => {
            if let Ok(mut cb) = arboard::Clipboard::new() {
                let _ = cb.set_text(text.clone());
            }
        }
    }
}

impl ExtensionHost {
    /// Rescan the given roots, replacing the loaded set (crash breakers reset).
    pub fn reload(&self, roots: &[PathBuf]) {
        let mut exts = Vec::new();
        let mut errors = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for root in roots {
            let (found, errs) = discover_in(root);
            for d in found {
                if seen.insert(d.id.clone()) {
                    exts.push(LoadedExt {
                        id: d.id,
                        dir: d.dir,
                        manifest: d.manifest,
                        crash: CrashTracker::default(),
                    });
                }
            }
            for e in errs {
                errors.push((e.dir.to_string_lossy().to_string(), e.message));
            }
        }
        if let Ok(mut inner) = self.inner.lock() {
            inner.exts = exts;
            inner.errors = errors;
        }
    }

    /// List installed extensions with their enabled/crashed state.
    pub fn list(&self, conn: &rusqlite::Connection) -> Vec<ExtensionInfo> {
        let inner = match self.inner.lock() {
            Ok(i) => i,
            Err(_) => return Vec::new(),
        };
        inner
            .exts
            .iter()
            .map(|e| ExtensionInfo {
                id: e.id.clone(),
                title: e.manifest.title.clone(),
                version: e.manifest.version.clone(),
                enabled: orbit_core::extstore::is_enabled(conn, &e.id).unwrap_or(true),
                crashed: e.crash.is_tripped(),
                command_count: e.manifest.commands.len(),
                permissions: e.manifest.permissions.clone(),
            })
            .collect()
    }

    /// All commands from enabled, non-crashed extensions (for Root Search).
    pub fn commands(&self, conn: &rusqlite::Connection) -> Vec<ExtCommandInfo> {
        let inner = match self.inner.lock() {
            Ok(i) => i,
            Err(_) => return Vec::new(),
        };
        let mut out = Vec::new();
        for e in &inner.exts {
            if e.crash.is_tripped() || !orbit_core::extstore::is_enabled(conn, &e.id).unwrap_or(true) {
                continue;
            }
            for c in &e.manifest.commands {
                out.push(ExtCommandInfo {
                    ext_id: e.id.clone(),
                    ext_title: e.manifest.title.clone(),
                    command: c.name.clone(),
                    title: c.title.clone(),
                    mode: c.mode.clone(),
                    description: c.description.clone(),
                    keywords: c.keywords.clone(),
                });
            }
        }
        out
    }

    pub fn set_enabled(&self, conn: &rusqlite::Connection, ext_id: &str, enabled: bool) -> Result<(), String> {
        orbit_core::extstore::set_enabled(conn, ext_id, enabled).map_err(|e| e.to_string())?;
        // Re-enabling clears a tripped breaker so the user can retry.
        if enabled {
            if let Ok(mut inner) = self.inner.lock() {
                if let Some(ext) = inner.exts.iter_mut().find(|e| e.id == ext_id) {
                    ext.crash.reset();
                }
            }
        }
        Ok(())
    }

    /// Run a command. Performs the one-shot RPC, brokers effects against the
    /// manifest's permissions, persists storage writes, and updates the crash
    /// breaker. Returns the (scrubbed) list items for `list` commands.
    ///
    /// The DB lock is only held for brief reads/writes — never across the child
    /// spawn — so a slow or hung extension can't block the rest of the app.
    pub fn run(
        &self,
        app: &AppHandle,
        state: &AppState,
        ext_id: &str,
        command: &str,
        query: &str,
    ) -> Result<RunResult, String> {
        // Snapshot what we need without holding the host lock during spawn.
        let (dir, main, permissions) = {
            let inner = self.inner.lock().map_err(|e| e.to_string())?;
            let ext = inner
                .exts
                .iter()
                .find(|e| e.id == ext_id)
                .ok_or_else(|| format!("unknown extension '{ext_id}'"))?;
            if ext.crash.is_tripped() {
                return Err("extension is disabled after repeated crashes — reload it to retry".into());
            }
            if !ext.manifest.commands.iter().any(|c| c.name == command) {
                return Err(format!("extension '{ext_id}' has no command '{command}'"));
            }
            (ext.dir.clone(), ext.manifest.main.clone(), ext.manifest.permissions.clone())
        };

        // Brief DB section: check enabled + snapshot storage, then release.
        let storage = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            if !orbit_core::extstore::is_enabled(&conn, ext_id).unwrap_or(true) {
                return Err("extension is disabled".into());
            }
            orbit_core::extstore::all(&conn, ext_id).unwrap_or_default()
        };

        let request = InvokeRequest::new(command, query, storage).to_json();
        let entry = dir.join(&main);

        // No locks held across the child spawn.
        match invoke_child(&entry, &request) {
            Ok(response) => {
                self.record(ext_id, true);
                self.handle_response(app, state, ext_id, &permissions, response)
            }
            Err(e) => {
                self.record(ext_id, false);
                Err(e)
            }
        }
    }

    fn record(&self, ext_id: &str, success: bool) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(ext) = inner.exts.iter_mut().find(|e| e.id == ext_id) {
                if success {
                    ext.crash.record_success();
                } else {
                    ext.crash.record_failure(now_ms());
                }
            }
        }
    }

    fn handle_response(
        &self,
        app: &AppHandle,
        state: &AppState,
        ext_id: &str,
        permissions: &[String],
        response: InvokeResponse,
    ) -> Result<RunResult, String> {
        match response {
            InvokeResponse::Error { message, .. } => Err(message),
            InvokeResponse::Result { items, effects, storage_writes, toast, .. } => {
                // Broker top-level effects and perform the allowed ones.
                for effect in allowed_effects(effects, permissions) {
                    perform_effect(app, &effect);
                }
                // Persist bounded storage writes to the extension's namespace.
                if !storage_writes.is_empty() {
                    if let Ok(conn) = state.db.lock() {
                        for (i, (k, v)) in storage_writes.into_iter().enumerate() {
                            if i >= MAX_STORAGE_KEYS || k.is_empty() || v.len() > MAX_STORAGE_VALUE {
                                continue;
                            }
                            let _ = orbit_core::extstore::set(&conn, ext_id, &k, &v, now_ms());
                        }
                    }
                }
                // Scrub item actions by permission before returning to the UI.
                let run_items = items
                    .into_iter()
                    .take(MAX_ITEMS)
                    .map(|it| {
                        let action = it
                            .action
                            .filter(|a| orbit_extensions::effect_allowed(a, permissions))
                            .as_ref()
                            .map(effect_to_action);
                        RunItem {
                            id: it.id,
                            title: it.title,
                            subtitle: it.subtitle,
                            action,
                        }
                    })
                    .collect();
                Ok(RunResult { items: run_items, toast })
            }
        }
    }

    /// Folders that failed discovery (for diagnostics in Settings).
    pub fn errors(&self) -> Vec<(String, String)> {
        self.inner.lock().map(|i| i.errors.clone()).unwrap_or_default()
    }
}

/// Spawn `node <entry>`, write the request to stdin, read one response from
/// stdout under a timeout. Any transport failure (spawn error, timeout, empty or
/// invalid output, version mismatch) is returned as Err and counts as a crash.
fn invoke_child(entry: &std::path::Path, request: &str) -> Result<InvokeResponse, String> {
    if !entry.is_file() {
        return Err(format!("extension entry not found: {}", entry.display()));
    }
    let mut child = Command::new("node")
        .arg(entry)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start extension (is Node.js installed?): {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(request.as_bytes())
            .map_err(|e| format!("failed to send request: {e}"))?;
        // Dropping stdin here closes it, signalling end-of-input to the child.
    }

    let mut stdout = child.stdout.take().ok_or("no stdout from extension")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });

    let output = match rx.recv_timeout(INVOKE_TIMEOUT) {
        Ok(s) => s,
        Err(_) => {
            let _ = child.kill();
            return Err("extension timed out".into());
        }
    };
    let _ = child.wait();

    if output.trim().is_empty() {
        return Err("extension produced no output".into());
    }
    parse_response(&output)
}
