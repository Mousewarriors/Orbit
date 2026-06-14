//! Installed-application enumeration.
//!
//! Windows: scans the per-user and all-users Start Menu for `.lnk` shortcuts.
//! macOS:   scans the standard Applications directories for `.app` bundles.
//! The shortcut/bundle path is used directly to launch via the OS, so we never
//! shell out to a command line and never interpolate untrusted strings.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct AppEntry {
    /// Stable id derived from the launch path.
    pub id: String,
    pub name: String,
    /// The path the OS should open to launch the app (a .lnk or .app).
    pub path: String,
    pub kind: String,
}

fn make_id(path: &str) -> String {
    // Deterministic, filesystem-safe id from the path (FNV-1a hash, hex).
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in path.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("app.{hash:016x}")
}

/// Recursively collect files under `dir` matching `ext`, bounded in depth to
/// avoid symlink loops and pathological trees.
fn collect(dir: &Path, ext: &str, depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            collect(&path, ext, depth - 1, out);
        } else if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case(ext))
            == Some(true)
        {
            out.push(path);
        }
    }
}

#[cfg(target_os = "windows")]
fn scan_paths() -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(pd) = std::env::var("ProgramData") {
        roots.push(PathBuf::from(pd).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Ok(ad) = std::env::var("AppData") {
        roots.push(PathBuf::from(ad).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    for root in roots {
        collect(&root, "lnk", 6, &mut files);
    }
    files
}

#[cfg(target_os = "macos")]
fn scan_paths() -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut roots: Vec<PathBuf> = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    for root in roots {
        // .app bundles are directories; collect them at shallow depth.
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("app") {
                    files.push(path);
                }
            }
        }
    }
    files
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn scan_paths() -> Vec<PathBuf> {
    // Linux: scan XDG .desktop files (basic support).
    let mut files = Vec::new();
    let roots = [
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
    ];
    for root in roots {
        collect(&root, "desktop", 3, &mut files);
    }
    files
}

/// Enumerate installed applications, de-duplicated by name (case-insensitive).
pub fn scan_applications() -> Vec<AppEntry> {
    let mut seen = std::collections::HashSet::new();
    let mut apps = Vec::new();
    for path in scan_paths() {
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let key = name.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        let path_str = path.to_string_lossy().to_string();
        apps.push(AppEntry {
            id: make_id(&path_str),
            name,
            path: path_str,
            kind: "app".into(),
        });
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_is_deterministic_and_prefixed() {
        let a = make_id("/Applications/Safari.app");
        let b = make_id("/Applications/Safari.app");
        assert_eq!(a, b);
        assert!(a.starts_with("app."));
        assert_ne!(make_id("/x"), make_id("/y"));
    }

    #[test]
    fn scanning_does_not_panic() {
        // On CI the dirs may be empty; we only assert it returns without error.
        let _ = scan_applications();
    }
}
