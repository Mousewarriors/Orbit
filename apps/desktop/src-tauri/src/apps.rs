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

/// The dependency-free Start Menu `.lnk` / `.app` / `.desktop` scan (classic
/// Win32 apps). Always available, fast, and used as the synchronous startup
/// index; [`scan_applications`] augments it with Store apps on Windows.
pub fn scan_lnk_apps() -> Vec<AppEntry> {
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

/// Enumerate installed applications, de-duplicated by name (case-insensitive).
///
/// Classic Win32 apps come from the Start Menu `.lnk` scan (always available, no
/// dependencies). On Windows we then merge in `Get-StartApps`, which adds UWP /
/// Microsoft Store apps (Calculator, Terminal, Notepad, …) that have no `.lnk`;
/// those launch via their Explorer AppsFolder moniker. `.lnk` entries win on a
/// name clash because a concrete filesystem path is the most reliable to launch.
pub fn scan_applications() -> Vec<AppEntry> {
    let mut apps = scan_lnk_apps();
    #[cfg(target_os = "windows")]
    {
        let mut seen: std::collections::HashSet<String> =
            apps.iter().map(|a| a.name.to_lowercase()).collect();
        for app in scan_start_apps() {
            if seen.insert(app.name.to_lowercase()) {
                apps.push(app);
            }
        }
        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    }
    apps
}

/// Enumerate Start apps (Win32 + UWP) via `Get-StartApps`, mapping each to an
/// Explorer AppsFolder moniker we can launch. Best-effort: returns an empty list
/// if PowerShell is unavailable, so the `.lnk` baseline always stands.
#[cfg(target_os = "windows")]
fn scan_start_apps() -> Vec<AppEntry> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_start_apps(&String::from_utf8_lossy(&output.stdout))
}

/// Parse the JSON emitted by `Get-StartApps … | ConvertTo-Json` into app entries
/// whose launch path is the Explorer AppsFolder moniker for the app. Pure, so it
/// is unit-tested without spawning PowerShell. `ConvertTo-Json` emits a bare
/// object for a single app and an array for many — both are handled.
#[cfg(target_os = "windows")]
fn parse_start_apps(json: &str) -> Vec<AppEntry> {
    let json = json.trim();
    if json.is_empty() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let items: Vec<&serde_json::Value> = match &value {
        serde_json::Value::Array(a) => a.iter().collect(),
        serde_json::Value::Object(_) => vec![&value],
        _ => return Vec::new(),
    };
    let mut out = Vec::new();
    for item in items {
        let name = item.get("Name").and_then(|v| v.as_str()).unwrap_or("").trim();
        let app_id = item.get("AppID").and_then(|v| v.as_str()).unwrap_or("").trim();
        if name.is_empty() || app_id.is_empty() {
            continue;
        }
        let path = format!(r"shell:AppsFolder\{app_id}");
        out.push(AppEntry {
            id: make_id(&path),
            name: name.to_string(),
            path,
            kind: "store".into(),
        });
    }
    out
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
        // Use the hermetic `.lnk` scan so tests don't spawn PowerShell.
        let _ = scan_lnk_apps();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parses_get_startapps_array_into_launchable_entries() {
        let json = r#"[
            {"Name":"Calculator","AppID":"Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"},
            {"Name":"Terminal","AppID":"Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"}
        ]"#;
        let apps = parse_start_apps(json);
        assert_eq!(apps.len(), 2);
        let calc = &apps[0];
        assert_eq!(calc.name, "Calculator");
        assert_eq!(calc.kind, "store");
        assert_eq!(
            calc.path,
            r"shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"
        );
        assert!(calc.id.starts_with("app."));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parses_single_object_and_skips_incomplete_rows() {
        // ConvertTo-Json emits a bare object when there is exactly one app.
        let single = r#"{"Name":"Calculator","AppID":"Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"}"#;
        assert_eq!(parse_start_apps(single).len(), 1);
        // Rows missing a name or id are dropped; junk input yields nothing.
        let mixed = r#"[{"Name":"","AppID":"x"},{"Name":"Ok","AppID":"y"},{"Name":"No id","AppID":""}]"#;
        let apps = parse_start_apps(mixed);
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].name, "Ok");
        assert!(parse_start_apps("not json").is_empty());
        assert!(parse_start_apps("").is_empty());
    }
}
