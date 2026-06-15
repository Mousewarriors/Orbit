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
    allowed_effects, bound_logs, discover_in, manifest::Manifest, parse_response, CrashTracker,
    Effect, InvokeRequest, InvokeResponse,
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
    /// Last invocation error (transport/crash/handler), shown in Settings.
    last_error: Option<String>,
    /// Bounded tail of the child's stderr from the most recent invocation, so
    /// Settings can show "recent logs" for diagnostics. None until first run.
    recent_logs: Option<String>,
}

impl LoadedExt {
    /// Build a freshly-loaded entry from discovery (crash breaker reset, no
    /// error/log history yet).
    fn fresh(id: String, dir: PathBuf, manifest: Manifest) -> Self {
        LoadedExt {
            id,
            dir,
            manifest,
            crash: CrashTracker::default(),
            last_error: None,
            recent_logs: None,
        }
    }
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

/// Lightweight command metadata for the management UI.
#[derive(Debug, Clone, Serialize)]
pub struct ExtCmdMeta {
    pub name: String,
    pub title: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtensionInfo {
    pub id: String,
    pub title: String,
    pub description: String,
    pub version: String,
    pub enabled: bool,
    /// True when crash-loop protection has tripped (host refuses to invoke).
    pub crashed: bool,
    /// Derived state: "disabled" | "unhealthy" | "degraded" | "ready".
    pub health: String,
    pub command_count: usize,
    pub commands: Vec<ExtCmdMeta>,
    pub permissions: Vec<String>,
    /// Absolute folder, so the UI can offer "Open folder".
    pub dir: String,
    /// Last invocation error, if any.
    pub last_error: Option<String>,
    /// Bounded tail of the most recent invocation's stderr (diagnostics).
    pub recent_logs: Option<String>,
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

/// Names of the repository's bundled sample extensions that Orbit offers to
/// install locally (copied into `<app data>/extensions/<name>`).
pub const BUNDLED_EXTENSIONS: &[&str] = &["developer-utilities", "agentos-controller"];

/// Locate the folder containing the bundled sample extensions (each a
/// subdirectory with `manifest.json` + `index.mjs`), if available.
///
/// In a packaged build these are bundled as a resource at
/// `extensions/examples` (see `tauri.conf.json`); in development they're read
/// straight from the repo via `CARGO_MANIFEST_DIR` (this crate lives at
/// `apps/desktop/src-tauri`, so the repo root is three levels up).
fn bundled_extensions_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("extensions").join("examples");
        if p.exists() {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("extensions")
        .join("examples");
    if dev.exists() {
        return Some(dev);
    }
    None
}

/// Recursively copy a directory tree (std-only; small extension folders).
fn copy_dir(src: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Install any of [`BUNDLED_EXTENSIONS`] that aren't already present under
/// `<app data>/extensions/<name>`. Existing folders are left untouched — this
/// is what makes the install idempotent and safe to call on every startup
/// without undoing a deliberate uninstall (deleting the folder) or disable
/// (which only flips a flag in the database, leaving the folder in place).
/// Returns the names actually installed.
pub fn install_bundled(app: &AppHandle) -> Vec<String> {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return Vec::new();
    };
    let dest_root = data_dir.join("extensions");
    if std::fs::create_dir_all(&dest_root).is_err() {
        return Vec::new();
    }
    let Some(src_root) = bundled_extensions_dir(app) else {
        return Vec::new();
    };
    let mut installed = Vec::new();
    for name in BUNDLED_EXTENSIONS {
        let dest = dest_root.join(name);
        if dest.exists() {
            continue;
        }
        let src = src_root.join(name);
        if src.join("manifest.json").exists() && copy_dir(&src, &dest).is_ok() {
            installed.push((*name).to_string());
        }
    }
    installed
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
                    exts.push(LoadedExt::fresh(d.id, d.dir, d.manifest));
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

    /// Reload a *single* extension: re-discover it from `roots` and replace only
    /// its entry with a fresh one (new manifest, reset crash breaker, cleared
    /// error/log history). Every other extension — including its crash breaker —
    /// is left untouched. Returns an error if the extension is no longer found on
    /// disk (in which case it is dropped from the loaded set).
    pub fn reload_one(&self, roots: &[PathBuf], ext_id: &str) -> Result<(), String> {
        // Re-discover across the roots and pick the first match by id (the same
        // first-wins precedence `reload` uses across overlapping roots).
        let mut found: Option<orbit_extensions::Discovered> = None;
        for root in roots {
            let (discovered, _errs) = discover_in(root);
            if let Some(d) = discovered.into_iter().find(|d| d.id == ext_id) {
                found = Some(d);
                break;
            }
        }

        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        match found {
            Some(d) => {
                let fresh = LoadedExt::fresh(d.id, d.dir, d.manifest);
                if let Some(slot) = inner.exts.iter_mut().find(|e| e.id == ext_id) {
                    *slot = fresh;
                } else {
                    inner.exts.push(fresh);
                    inner.exts.sort_by(|a, b| a.id.cmp(&b.id));
                }
                Ok(())
            }
            None => {
                // Gone from disk — drop it so the list stays honest.
                inner.exts.retain(|e| e.id != ext_id);
                Err(format!(
                    "extension '{ext_id}' was not found on disk — it may have been removed"
                ))
            }
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
            .map(|e| {
                let enabled = orbit_core::extstore::is_enabled(conn, &e.id).unwrap_or(true);
                let crashed = e.crash.is_tripped();
                let health = if !enabled {
                    "disabled"
                } else if crashed {
                    "unhealthy"
                } else if e.last_error.is_some() {
                    "degraded"
                } else {
                    "ready"
                };
                ExtensionInfo {
                    id: e.id.clone(),
                    title: e.manifest.title.clone(),
                    description: e.manifest.description.clone(),
                    version: e.manifest.version.clone(),
                    enabled,
                    crashed,
                    health: health.to_string(),
                    command_count: e.manifest.commands.len(),
                    commands: e
                        .manifest
                        .commands
                        .iter()
                        .map(|c| ExtCmdMeta {
                            name: c.name.clone(),
                            title: c.title.clone(),
                            mode: c.mode.clone(),
                        })
                        .collect(),
                    permissions: e.manifest.permissions.clone(),
                    dir: e.dir.to_string_lossy().to_string(),
                    last_error: e.last_error.clone(),
                    recent_logs: e.recent_logs.clone(),
                }
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

        // No locks held across the child spawn. Stderr is captured (bounded)
        // alongside stdout so Settings can surface "recent logs" either way.
        let (result, logs) = invoke_child(&entry, &request);
        match result {
            Ok(response) => {
                // A handler can still return a logical error; reflect that too.
                let logical_err = match &response {
                    InvokeResponse::Error { message, .. } => Some(message.clone()),
                    _ => None,
                };
                self.record(ext_id, logical_err.is_none(), logical_err, logs);
                self.handle_response(app, state, ext_id, &permissions, response)
            }
            Err(e) => {
                self.record(ext_id, false, Some(e.clone()), logs);
                Err(e)
            }
        }
    }

    fn record(&self, ext_id: &str, success: bool, last_error: Option<String>, logs: Option<String>) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(ext) = inner.exts.iter_mut().find(|e| e.id == ext_id) {
                if success {
                    ext.crash.record_success();
                    ext.last_error = None;
                } else {
                    ext.crash.record_failure(now_ms());
                    ext.last_error = last_error;
                }
                // Always refresh the captured logs (even on success) so the most
                // recent diagnostics are shown; keep the old capture if this run
                // wrote nothing to stderr.
                if logs.is_some() {
                    ext.recent_logs = logs;
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

    /// Test-only: force an extension's crash breaker to trip (no child spawn).
    #[cfg(test)]
    fn test_trip(&self, ext_id: &str) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(ext) = inner.exts.iter_mut().find(|e| e.id == ext_id) {
            // Three failures inside the window trips the default breaker.
            ext.crash.record_failure(1_000);
            ext.crash.record_failure(2_000);
            ext.crash.record_failure(3_000);
        }
    }

    /// Test-only: whether an extension's crash breaker is currently tripped.
    /// `None` if the extension isn't loaded.
    #[cfg(test)]
    fn test_is_tripped(&self, ext_id: &str) -> Option<bool> {
        let inner = self.inner.lock().unwrap();
        inner.exts.iter().find(|e| e.id == ext_id).map(|e| e.crash.is_tripped())
    }
}

/// Spawn `node <entry>`, write the request to stdin, read one response from
/// stdout under a timeout. Any transport failure (spawn error, timeout, empty or
/// invalid output, version mismatch) is returned as Err and counts as a crash.
///
/// Stderr is *captured* (piped) on its own reader thread so it can't deadlock the
/// stdout read, then trimmed to a bounded tail via [`bound_logs`] and returned
/// alongside the result — extensions write structured diagnostics there. The
/// second tuple element is the captured logs, available on both success and
/// failure (including timeout, where we return whatever was emitted before the
/// kill).
fn invoke_child(
    entry: &std::path::Path,
    request: &str,
) -> (Result<InvokeResponse, String>, Option<String>) {
    if !entry.is_file() {
        return (
            Err(format!("extension entry not found: {}", entry.display())),
            None,
        );
    }
    let mut child = match Command::new("node")
        .arg(entry)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return (
                Err(format!("could not start extension (is Node.js installed?): {e}")),
                None,
            )
        }
    };

    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(request.as_bytes()) {
            return (Err(format!("failed to send request: {e}")), None);
        }
        // Dropping stdin here closes it, signalling end-of-input to the child.
    }

    // Drain stdout and stderr on separate threads so a full stderr pipe can never
    // block the stdout read (or vice versa).
    let (out_tx, out_rx) = mpsc::channel();
    if let Some(mut stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = stdout.read_to_string(&mut buf);
            let _ = out_tx.send(buf);
        });
    }
    let (err_tx, err_rx) = mpsc::channel();
    if let Some(mut stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = stderr.read_to_string(&mut buf);
            let _ = err_tx.send(buf);
        });
    }

    let output = match out_rx.recv_timeout(INVOKE_TIMEOUT) {
        Ok(s) => s,
        Err(_) => {
            let _ = child.kill();
            // Surface whatever the child managed to log before we killed it.
            let logs = err_rx.recv_timeout(Duration::from_millis(200)).ok();
            return (Err("extension timed out".into()), logs.and_then(|s| bound_logs(&s)));
        }
    };
    let _ = child.wait();

    // Stderr should be at EOF now that stdout closed and the child exited; take
    // it with a tiny grace period rather than blocking.
    let logs = err_rx
        .recv_timeout(Duration::from_millis(200))
        .ok()
        .and_then(|s| bound_logs(&s));

    if output.trim().is_empty() {
        return (Err("extension produced no output".into()), logs);
    }
    (parse_response(&output), logs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn temp_root(tag: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("orbit-host-{tag}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_ext(root: &std::path::Path, id: &str) {
        let dir = root.join(id);
        fs::create_dir_all(&dir).unwrap();
        let manifest = format!(
            r#"{{"name":"{id}","title":"{id}","commands":[{{"name":"go","title":"Go","mode":"no-view"}}]}}"#
        );
        fs::write(dir.join("manifest.json"), manifest).unwrap();
    }

    /// Reloading one extension must not reset another extension's crash breaker.
    #[test]
    fn reload_one_preserves_other_crash_state() {
        let root = temp_root("reload-one");
        write_ext(&root, "alpha");
        write_ext(&root, "beta");
        let roots = vec![root.clone()];

        let host = ExtensionHost::default();
        host.reload(&roots);
        assert_eq!(host.test_is_tripped("alpha"), Some(false));
        assert_eq!(host.test_is_tripped("beta"), Some(false));

        // Trip alpha's breaker (simulating repeated crashes).
        host.test_trip("alpha");
        assert_eq!(host.test_is_tripped("alpha"), Some(true));

        // Reloading *beta* must leave alpha's tripped breaker untouched.
        host.reload_one(&roots, "beta").expect("beta reloads");
        assert_eq!(host.test_is_tripped("alpha"), Some(true), "alpha must stay tripped");
        assert_eq!(host.test_is_tripped("beta"), Some(false));

        // Reloading *alpha* itself resets only alpha's breaker.
        host.reload_one(&roots, "alpha").expect("alpha reloads");
        assert_eq!(host.test_is_tripped("alpha"), Some(false), "alpha reset by its own reload");

        let _ = fs::remove_dir_all(&root);
    }

    /// Reloading an extension that's gone from disk drops it and errors clearly.
    #[test]
    fn reload_one_missing_drops_and_errors() {
        let root = temp_root("reload-missing");
        write_ext(&root, "alpha");
        write_ext(&root, "beta");
        let roots = vec![root.clone()];

        let host = ExtensionHost::default();
        host.reload(&roots);

        // Remove beta from disk, then reload just beta.
        fs::remove_dir_all(root.join("beta")).unwrap();
        let err = host.reload_one(&roots, "beta").unwrap_err();
        assert!(err.contains("beta"), "error names the missing extension");
        assert_eq!(host.test_is_tripped("beta"), None, "beta dropped from the loaded set");
        assert_eq!(host.test_is_tripped("alpha"), Some(false), "alpha untouched");

        let _ = fs::remove_dir_all(&root);
    }

    /// `copy_dir` recursively copies nested files/folders, which underlies
    /// `install_bundled` copying a sample extension's tree into `<app
    /// data>/extensions/<name>`.
    #[test]
    fn copy_dir_recurses_into_subfolders() {
        let src = temp_root("copy-src");
        let dest = temp_root("copy-dest");
        fs::remove_dir_all(&dest).unwrap();

        write_ext(&src, ".");
        fs::write(src.join("index.mjs"), b"export default {};").unwrap();
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("sub").join("nested.txt"), b"hello").unwrap();

        copy_dir(&src, &dest).expect("copy succeeds");

        assert!(dest.join("manifest.json").exists());
        assert!(dest.join("index.mjs").exists());
        assert_eq!(fs::read_to_string(dest.join("sub").join("nested.txt")).unwrap(), "hello");

        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    /// Bundled extensions resolve to the repo's `extensions/examples` in dev
    /// (this crate is at `apps/desktop/src-tauri`, three levels below the repo
    /// root) and contain both extensions Orbit offers to install.
    #[test]
    fn dev_bundled_extensions_dir_contains_expected_samples() {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .join("extensions")
            .join("examples");
        assert!(dev.exists(), "extensions/examples should exist at {dev:?}");
        for name in BUNDLED_EXTENSIONS {
            assert!(
                dev.join(name).join("manifest.json").exists(),
                "{name} should have a manifest"
            );
        }
    }
}
