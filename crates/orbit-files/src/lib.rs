//! orbit-files — the filesystem walker and indexing rules behind Orbit's local
//! file search.
//!
//! [`rules`] holds the pure, unit-tested decisions (what counts as an extension,
//! which directories/files to skip). [`walk`] performs a breadth-first traversal
//! of the configured roots using only `std::fs`, emitting one [`Entry`] per file
//! and directory through a callback. It is cancellable (a closure polled between
//! entries), does not follow symlinks by default (loop-safe), and silently skips
//! paths it cannot read (permission denied, races) so one bad directory never
//! aborts the whole index.

pub mod rules;

pub use rules::{
    ext_of, is_hidden, path_is_excluded, should_index_file, should_skip_dir, DEFAULT_EXCLUDES,
};

use std::collections::VecDeque;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Configuration for a walk.
#[derive(Debug, Clone)]
pub struct WalkConfig {
    /// Roots to traverse. Non-existent or non-directory roots are skipped.
    pub roots: Vec<PathBuf>,
    /// Names or path-prefixes to exclude (see [`rules::should_skip_dir`] and
    /// [`rules::path_is_excluded`]).
    pub excludes: Vec<String>,
    /// Whether to index dot-prefixed files/dirs.
    pub include_hidden: bool,
    /// Whether to descend into symlinked directories (default false: loop-safe).
    pub follow_symlinks: bool,
    /// Maximum depth below each root; 0 means unlimited.
    pub max_depth: usize,
}

impl Default for WalkConfig {
    fn default() -> Self {
        WalkConfig {
            roots: Vec::new(),
            excludes: Vec::new(),
            include_hidden: false,
            follow_symlinks: false,
            max_depth: 0,
        }
    }
}

/// Kind of an indexed entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
}

impl EntryKind {
    /// The string stored in the index ("file" / "dir").
    pub fn as_str(self) -> &'static str {
        match self {
            EntryKind::File => "file",
            EntryKind::Dir => "dir",
        }
    }
}

/// A single discovered filesystem entry.
#[derive(Debug, Clone)]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub ext: Option<String>,
    pub kind: EntryKind,
    pub size: u64,
    pub created_ms: Option<i64>,
    pub modified_ms: i64,
}

/// Summary of a completed (or cancelled) walk.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WalkStats {
    pub files: usize,
    pub dirs: usize,
    /// Directories skipped by an exclude / hidden rule.
    pub skipped: usize,
    /// Directories that could not be read (permission denied, etc.).
    pub errors: usize,
    /// True if the cancel callback ended the walk early.
    pub cancelled: bool,
}

fn to_ms(t: SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

/// Walk the configured roots, invoking `on_entry` for each file and directory.
/// `cancel` is polled between directories; returning `true` ends the walk.
pub fn walk<F>(config: &WalkConfig, mut on_entry: F, cancel: &dyn Fn() -> bool) -> WalkStats
where
    F: FnMut(Entry),
{
    let mut stats = WalkStats::default();
    let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::new();
    for root in &config.roots {
        if root.is_dir() {
            queue.push_back((root.clone(), 0));
        }
    }

    while let Some((dir, depth)) = queue.pop_front() {
        if cancel() {
            stats.cancelled = true;
            break;
        }
        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => {
                stats.errors += 1;
                continue;
            }
        };
        for entry in read.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            // Use the dir-entry file type so we classify symlinks without
            // following them.
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if file_type.is_symlink() && !config.follow_symlinks {
                continue;
            }
            let parent = dir.to_string_lossy().to_string();
            let path_str = path.to_string_lossy().to_string();
            let is_dir = if file_type.is_symlink() {
                path.is_dir()
            } else {
                file_type.is_dir()
            };

            if is_dir {
                if should_skip_dir(&name, &config.excludes, config.include_hidden)
                    || path_is_excluded(&path_str, &config.excludes)
                {
                    stats.skipped += 1;
                    continue;
                }
                let meta = entry.metadata().ok();
                on_entry(Entry {
                    path: path_str.clone(),
                    name,
                    parent,
                    ext: None,
                    kind: EntryKind::Dir,
                    size: 0,
                    created_ms: meta.as_ref().and_then(|m| m.created().ok()).and_then(to_ms),
                    modified_ms: meta
                        .as_ref()
                        .and_then(|m| m.modified().ok())
                        .and_then(to_ms)
                        .unwrap_or(0),
                });
                stats.dirs += 1;
                if config.max_depth == 0 || depth + 1 < config.max_depth {
                    queue.push_back((path, depth + 1));
                }
            } else if file_type.is_file() || file_type.is_symlink() {
                if !should_index_file(&name, config.include_hidden) {
                    continue;
                }
                let meta = entry.metadata().ok();
                let ext = ext_of(&name);
                on_entry(Entry {
                    path: path_str,
                    name,
                    parent,
                    ext,
                    kind: EntryKind::File,
                    size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                    created_ms: meta.as_ref().and_then(|m| m.created().ok()).and_then(to_ms),
                    modified_ms: meta
                        .as_ref()
                        .and_then(|m| m.modified().ok())
                        .and_then(to_ms)
                        .unwrap_or(0),
                });
                stats.files += 1;
            }
        }
    }
    stats
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Create a unique temp directory for a test fixture (no external crates).
    fn temp_root(tag: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let dir = std::env::temp_dir().join(format!("orbit-files-{tag}-{pid}-{n}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(path: &std::path::Path) {
        fs::write(path, b"x").unwrap();
    }

    #[test]
    fn walks_files_and_dirs_skipping_excluded() {
        let root = temp_root("walk");
        touch(&root.join("a.txt"));
        touch(&root.join("b.md"));
        fs::create_dir_all(root.join("sub")).unwrap();
        touch(&root.join("sub").join("c.rs"));
        fs::create_dir_all(root.join("node_modules")).unwrap();
        touch(&root.join("node_modules").join("ignored.js"));
        touch(&root.join(".hidden"));

        let cfg = WalkConfig {
            roots: vec![root.clone()],
            ..Default::default()
        };
        let mut names: Vec<String> = Vec::new();
        let stats = walk(&cfg, |e| names.push(e.name), &|| false);

        assert!(names.contains(&"a.txt".to_string()));
        assert!(names.contains(&"c.rs".to_string()), "descends into sub");
        assert!(!names.iter().any(|n| n == "ignored.js"), "node_modules skipped");
        assert!(!names.iter().any(|n| n == ".hidden"), "hidden skipped by default");
        assert_eq!(stats.files, 3); // a.txt, b.md, c.rs
        assert!(stats.skipped >= 1);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn include_hidden_picks_up_dotfiles() {
        let root = temp_root("hidden");
        touch(&root.join(".env"));
        let cfg = WalkConfig {
            roots: vec![root.clone()],
            include_hidden: true,
            ..Default::default()
        };
        let mut found = false;
        walk(&cfg, |e| found |= e.name == ".env", &|| false);
        assert!(found);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn max_depth_limits_descent() {
        let root = temp_root("depth");
        fs::create_dir_all(root.join("l1").join("l2")).unwrap();
        touch(&root.join("top.txt"));
        touch(&root.join("l1").join("mid.txt"));
        touch(&root.join("l1").join("l2").join("deep.txt"));
        let cfg = WalkConfig {
            roots: vec![root.clone()],
            max_depth: 1, // only the root level
            ..Default::default()
        };
        let mut names = Vec::new();
        walk(&cfg, |e| names.push(e.name), &|| false);
        assert!(names.contains(&"top.txt".to_string()));
        assert!(!names.contains(&"mid.txt".to_string()), "depth 1 stops at root");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cancellation_stops_early() {
        let root = temp_root("cancel");
        for i in 0..5 {
            fs::create_dir_all(root.join(format!("d{i}"))).unwrap();
            touch(&root.join(format!("d{i}")).join("f.txt"));
        }
        let cfg = WalkConfig {
            roots: vec![root.clone()],
            ..Default::default()
        };
        let stats = walk(&cfg, |_| {}, &|| true); // cancel immediately
        assert!(stats.cancelled);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_root_is_ignored() {
        let cfg = WalkConfig {
            roots: vec![PathBuf::from("/this/does/not/exist/orbit")],
            ..Default::default()
        };
        let stats = walk(&cfg, |_| {}, &|| false);
        assert_eq!(stats.files, 0);
        assert_eq!(stats.dirs, 0);
    }
}
