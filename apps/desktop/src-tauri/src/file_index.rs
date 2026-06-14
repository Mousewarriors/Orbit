//! Background local file indexing.
//!
//! A rebuild walks the configured roots (via `orbit-files`) on a worker thread
//! and writes metadata into the `files` table (via `orbit-core::files`) in small
//! transactional batches, so the launcher's DB lock is only held briefly and
//! search stays responsive while indexing. Rebuilds are cancellable and
//! self-superseding: each run captures a generation number and stops as soon as a
//! newer rebuild starts. Indexing is **opt-in** (`files.indexing.enabled`) — Orbit
//! never scans the disk without the user turning it on.

use std::cell::RefCell;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use orbit_files::{walk, Entry, WalkConfig};

use crate::commands::AppState;

/// How many entries to buffer before flushing a transaction.
const BATCH: usize = 400;

/// Shared, lock-free indexing progress/state.
#[derive(Default)]
pub struct IndexState {
    /// Bumped on every rebuild; an in-flight walk stops when it is superseded.
    pub generation: AtomicU64,
    pub running: AtomicBool,
    /// Entries written during the current/most-recent run.
    pub indexed: AtomicUsize,
}

/// Status surfaced to the Settings → Files section.
#[derive(serde::Serialize)]
pub struct IndexStatus {
    pub enabled: bool,
    pub running: bool,
    pub indexed: usize,
    pub total: i64,
    pub roots: Vec<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Split a newline-separated setting into trimmed, non-empty lines.
fn split_lines(s: &str) -> Vec<String> {
    s.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// Whether file indexing has been enabled by the user (default false).
pub fn is_enabled(conn: &rusqlite::Connection) -> bool {
    orbit_core::get_setting(conn, "files.indexing.enabled")
        .ok()
        .flatten()
        .as_deref()
        == Some("true")
}

/// Resolve the roots to index: the user's saved list, or sensible defaults
/// (Desktop / Documents / Downloads) that exist on this machine.
pub fn configured_roots(app: &AppHandle, conn: &rusqlite::Connection) -> Vec<PathBuf> {
    let stored = orbit_core::get_setting(conn, "files.roots")
        .ok()
        .flatten()
        .unwrap_or_default();
    let lines = split_lines(&stored);
    if !lines.is_empty() {
        return lines.into_iter().map(PathBuf::from).collect();
    }
    let p = app.path();
    [p.desktop_dir(), p.document_dir(), p.download_dir()]
        .into_iter()
        .flatten()
        .filter(|d| d.is_dir())
        .collect()
}

fn read_config(app: &AppHandle, conn: &rusqlite::Connection) -> WalkConfig {
    let excludes = orbit_core::get_setting(conn, "files.excludes")
        .ok()
        .flatten()
        .map(|s| split_lines(&s))
        .unwrap_or_default();
    let include_hidden = orbit_core::get_setting(conn, "files.include_hidden")
        .ok()
        .flatten()
        .as_deref()
        == Some("true");
    let max_depth = orbit_core::get_setting(conn, "files.max_depth")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    WalkConfig {
        roots: configured_roots(app, conn),
        excludes,
        include_hidden,
        follow_symlinks: false,
        max_depth,
    }
}

fn flush(state: &AppState, batch: &[Entry], at: i64) {
    let Ok(mut guard) = state.db.lock() else {
        return;
    };
    let Ok(tx) = guard.transaction() else {
        return;
    };
    for e in batch {
        let input = orbit_core::FileInput {
            path: e.path.clone(),
            name: e.name.clone(),
            parent: e.parent.clone(),
            ext: e.ext.clone(),
            kind: e.kind.as_str().to_string(),
            size: e.size as i64,
            created_at: e.created_ms,
            modified_at: e.modified_ms,
        };
        let _ = orbit_core::files::insert(&tx, &input, at);
    }
    let _ = tx.commit();
}

/// Start a full rebuild on a background thread. Returns immediately. Safe to call
/// repeatedly — an earlier run cancels itself when the newer one starts.
pub fn rebuild(app: AppHandle) {
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let my_gen = state.index.generation.fetch_add(1, Ordering::SeqCst) + 1;
        state.index.running.store(true, Ordering::SeqCst);
        state.index.indexed.store(0, Ordering::SeqCst);

        let cfg = {
            let Ok(conn) = state.db.lock() else {
                state.index.running.store(false, Ordering::SeqCst);
                return;
            };
            read_config(&app, &conn)
        };

        // Fresh start: clear the previous index.
        if let Ok(conn) = state.db.lock() {
            let _ = orbit_core::files::clear(&conn);
        }

        let at = now_ms();
        let buf: RefCell<Vec<Entry>> = RefCell::new(Vec::with_capacity(BATCH));
        {
            let cancel = || state.index.generation.load(Ordering::SeqCst) != my_gen;
            let on_entry = |e: Entry| {
                state.index.indexed.fetch_add(1, Ordering::Relaxed);
                let mut b = buf.borrow_mut();
                b.push(e);
                if b.len() >= BATCH {
                    let batch = std::mem::take(&mut *b);
                    drop(b);
                    flush(&state, &batch, at);
                }
            };
            walk(&cfg, on_entry, &cancel);
        }
        let rest = buf.into_inner();
        if !rest.is_empty() {
            flush(&state, &rest, at);
        }

        // Only the latest run owns the running flag.
        if state.index.generation.load(Ordering::SeqCst) == my_gen {
            state.index.running.store(false, Ordering::SeqCst);
        }
    });
}

/// Read the current index status.
pub fn status(app: &AppHandle, state: &AppState) -> IndexStatus {
    let conn = state.db.lock().ok();
    let total = conn
        .as_ref()
        .and_then(|c| orbit_core::files::count(c).ok())
        .unwrap_or(0);
    let enabled = conn.as_ref().map(|c| is_enabled(c)).unwrap_or(false);
    let roots = conn
        .as_ref()
        .map(|c| {
            configured_roots(app, c)
                .into_iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    IndexStatus {
        enabled,
        running: state.index.running.load(Ordering::SeqCst),
        indexed: state.index.indexed.load(Ordering::SeqCst),
        total,
        roots,
    }
}
