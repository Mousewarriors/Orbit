//! Extension discovery: scan a directory for immediate subfolders that contain a
//! valid `manifest.json`. Invalid or unreadable folders are skipped (with the
//! reason) so one bad extension never blocks the rest.

use std::path::{Path, PathBuf};

use crate::manifest::{self, Manifest};

/// A successfully discovered extension on disk.
#[derive(Debug, Clone)]
pub struct Discovered {
    /// Stable id (the manifest `name`).
    pub id: String,
    pub dir: PathBuf,
    pub manifest: Manifest,
}

/// A folder that looked like an extension but failed to load.
#[derive(Debug, Clone)]
pub struct DiscoveryError {
    pub dir: PathBuf,
    pub message: String,
}

/// Scan `root`'s immediate subdirectories for `manifest.json`. Returns the valid
/// extensions and a list of per-folder errors.
pub fn discover_in(root: &Path) -> (Vec<Discovered>, Vec<DiscoveryError>) {
    let mut ok = Vec::new();
    let mut errors = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return (ok, errors);
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let manifest_path = dir.join("manifest.json");
        if !manifest_path.is_file() {
            continue;
        }
        match std::fs::read_to_string(&manifest_path) {
            Ok(text) => match manifest::parse(&text) {
                Ok(m) => ok.push(Discovered {
                    id: m.name.clone(),
                    dir,
                    manifest: m,
                }),
                Err(e) => errors.push(DiscoveryError { dir, message: e }),
            },
            Err(e) => errors.push(DiscoveryError {
                dir,
                message: e.to_string(),
            }),
        }
    }
    ok.sort_by(|a, b| a.id.cmp(&b.id));
    (ok, errors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn temp_root(tag: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("orbit-ext-{tag}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_ext(root: &Path, folder: &str, manifest: &str) {
        let dir = root.join(folder);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("manifest.json"), manifest).unwrap();
    }

    const GOOD: &str = r#"{"name":"good","title":"Good","commands":[{"name":"go","title":"Go","mode":"no-view"}]}"#;
    const BAD: &str = r#"{"name":"BAD NAME","title":"Bad","commands":[]}"#;

    #[test]
    fn discovers_valid_and_reports_invalid() {
        let root = temp_root("disc");
        write_ext(&root, "good", GOOD);
        write_ext(&root, "bad", BAD);
        fs::create_dir_all(root.join("not-an-ext")).unwrap(); // no manifest.json

        let (ok, errors) = discover_in(&root);
        assert_eq!(ok.len(), 1);
        assert_eq!(ok[0].id, "good");
        assert_eq!(errors.len(), 1);
        assert!(errors[0].dir.ends_with("bad"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_root_is_empty() {
        let (ok, errors) = discover_in(Path::new("/no/such/dir/orbit-x"));
        assert!(ok.is_empty());
        assert!(errors.is_empty());
    }
}
