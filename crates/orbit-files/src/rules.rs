//! Pure, platform-free indexing rules: extension detection, hidden detection,
//! and which directories/files to skip. Kept separate from the walker so the
//! decisions are deterministic and unit-tested without touching a filesystem.

/// Directory names skipped by default — large, machine-generated or system
/// locations that pollute a file index. Case-insensitive.
pub const DEFAULT_EXCLUDES: &[&str] = &[
    "node_modules",
    ".git",
    ".hg",
    ".svn",
    "target",
    "dist",
    "build",
    ".cache",
    ".next",
    "$recycle.bin",
    "system volume information",
];

/// Lowercased, dot-less extension of a file name, or None for dotfiles / names
/// without a usable extension.
pub fn ext_of(name: &str) -> Option<String> {
    let dot = name.rfind('.')?;
    // A leading dot means a dotfile (".gitignore"), not an extension.
    if dot == 0 {
        return None;
    }
    let e = &name[dot + 1..];
    if e.is_empty() || e.chars().any(|c| c.is_whitespace()) {
        return None;
    }
    Some(e.to_lowercase())
}

/// A name is "hidden" if it starts with a dot (the cross-platform heuristic;
/// Windows' hidden attribute is handled separately by the walker if needed).
pub fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Whether a directory should be descended into.
pub fn should_skip_dir(name: &str, excludes: &[String], include_hidden: bool) -> bool {
    if name.is_empty() {
        return true;
    }
    if !include_hidden && is_hidden(name) {
        return true;
    }
    let lower = name.to_lowercase();
    if DEFAULT_EXCLUDES.contains(&lower.as_str()) {
        return true;
    }
    excludes
        .iter()
        .any(|e| !e.is_empty() && !e.contains(['/', '\\']) && e.to_lowercase() == lower)
}

/// Whether a regular file should be added to the index.
pub fn should_index_file(name: &str, include_hidden: bool) -> bool {
    if name.is_empty() {
        return false;
    }
    if !include_hidden && is_hidden(name) {
        return false;
    }
    true
}

/// Whether a full path matches a path-style exclude (one containing a separator),
/// either exactly or as a parent prefix. Separator- and case-insensitive.
pub fn path_is_excluded(path: &str, excludes: &[String]) -> bool {
    let p = path.replace('\\', "/").to_lowercase();
    excludes.iter().any(|e| {
        if !e.contains(['/', '\\']) {
            return false;
        }
        let e = e.replace('\\', "/").to_lowercase();
        let e = e.trim_end_matches('/');
        !e.is_empty() && (p == e || p.starts_with(&format!("{e}/")))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ext_of_handles_normal_dotfiles_and_spaces() {
        assert_eq!(ext_of("report.PDF").as_deref(), Some("pdf"));
        assert_eq!(ext_of("archive.tar.gz").as_deref(), Some("gz"));
        assert_eq!(ext_of(".gitignore"), None);
        assert_eq!(ext_of("README"), None);
        assert_eq!(ext_of("my file. txt"), None);
    }

    #[test]
    fn hidden_detection() {
        assert!(is_hidden(".env"));
        assert!(!is_hidden("visible.txt"));
    }

    #[test]
    fn skips_default_and_custom_dirs() {
        let custom = vec!["Secret".to_string()];
        assert!(should_skip_dir("node_modules", &[], false));
        assert!(should_skip_dir(".git", &[], false));
        assert!(should_skip_dir("Secret", &custom, false));
        assert!(should_skip_dir(".hidden", &[], false));
        assert!(!should_skip_dir(".hidden", &[], true));
        assert!(!should_skip_dir("src", &[], false));
    }

    #[test]
    fn file_indexing_respects_hidden_setting() {
        assert!(should_index_file("notes.md", false));
        assert!(!should_index_file(".secret", false));
        assert!(should_index_file(".secret", true));
        assert!(!should_index_file("", false));
    }

    #[test]
    fn path_exclusion_matches_prefix_case_and_sep_insensitive() {
        let excludes = vec!["C:\\Users\\me\\Private".to_string()];
        assert!(path_is_excluded("c:/users/me/private/file.txt", &excludes));
        assert!(path_is_excluded("C:\\Users\\me\\Private", &excludes));
        assert!(!path_is_excluded("c:/users/me/public/file.txt", &excludes));
        // A bare name (no separator) is not a path exclude.
        assert!(!path_is_excluded("c:/x/private", &["private".to_string()]));
    }
}
