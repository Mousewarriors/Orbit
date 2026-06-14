//! Extension manifest (`manifest.json`) parsing + validation.
//!
//! This is the host-side trust boundary for third-party extensions: every field
//! is bounded and identifiers are constrained so a malicious manifest can't
//! smuggle traversal, odd command modes, or unknown permissions past the host.
//! Mirrors the renderer-side `@orbit/validation` manifest schema.

use serde::Deserialize;

/// Command modes the host understands (a subset of the renderer's enum that the
/// runtime can actually execute today).
pub const ALLOWED_MODES: &[&str] = &["no-view", "list"];

/// Permissions the broker can enforce.
pub const ALLOWED_PERMISSIONS: &[&str] = &[
    "clipboard.read",
    "clipboard.write",
    "files.read",
    "files.write",
    "apps.launch",
    "apps.enumerate",
    "window.manage",
    "system.commands",
    "network",
    "selected-text.read",
    "text.insert",
    "browser.context",
    "calendar.read",
    "calendar.write",
    "ai",
    "shell.execute",
    "secure-storage",
];

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CommandDef {
    pub name: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    pub mode: String,
    #[serde(default)]
    pub keywords: Vec<String>,
}

fn default_main() -> String {
    "index.mjs".to_string()
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Manifest {
    pub name: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub commands: Vec<CommandDef>,
    /// Entry script (relative, no traversal). Defaults to `index.mjs`.
    #[serde(default = "default_main")]
    pub main: String,
}

fn is_safe_identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes().next().is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_safe_main(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 200
        && !s.contains("..")
        && !s.starts_with('/')
        && !s.starts_with('\\')
        && !s.contains(':') // rejects C:\ and url-like
}

impl Manifest {
    /// Validate all bounds/identifiers. Returns a human-readable error on failure.
    pub fn validate(&self) -> Result<(), String> {
        if !is_safe_identifier(&self.name) {
            return Err("manifest.name must be lowercase alphanumeric with dashes (<=64)".into());
        }
        if self.title.trim().is_empty() || self.title.chars().count() > 120 {
            return Err("manifest.title must be 1–120 chars".into());
        }
        if self.commands.is_empty() {
            return Err("manifest must declare at least one command".into());
        }
        if self.commands.len() > 100 {
            return Err("too many commands".into());
        }
        for c in &self.commands {
            if !is_safe_identifier(&c.name) {
                return Err(format!("command name '{}' is not a safe identifier", c.name));
            }
            if c.title.trim().is_empty() || c.title.chars().count() > 120 {
                return Err(format!("command '{}' title must be 1–120 chars", c.name));
            }
            if !ALLOWED_MODES.contains(&c.mode.as_str()) {
                return Err(format!(
                    "command '{}' mode '{}' is not supported (use {:?})",
                    c.name, c.mode, ALLOWED_MODES
                ));
            }
        }
        if self.permissions.len() > 20 {
            return Err("too many permissions".into());
        }
        for p in &self.permissions {
            if !ALLOWED_PERMISSIONS.contains(&p.as_str()) {
                return Err(format!("unknown permission '{p}'"));
            }
        }
        if !is_safe_main(&self.main) {
            return Err("manifest.main must be a relative path without traversal".into());
        }
        Ok(())
    }
}

/// Parse + validate a manifest from JSON text.
pub fn parse(json: &str) -> Result<Manifest, String> {
    let manifest: Manifest = serde_json::from_str(json).map_err(|e| format!("invalid manifest JSON: {e}"))?;
    manifest.validate()?;
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"{
        "name":"dev-utils","title":"Dev Utils","description":"d","version":"0.1.0",
        "author":"orbit","permissions":["clipboard.write"],
        "commands":[{"name":"gen","title":"Generate","mode":"no-view"},
                    {"name":"hist","title":"History","mode":"list"}]
    }"#;

    #[test]
    fn parses_valid_manifest() {
        let m = parse(VALID).unwrap();
        assert_eq!(m.name, "dev-utils");
        assert_eq!(m.commands.len(), 2);
        assert_eq!(m.main, "index.mjs"); // default
        assert!(m.permissions.contains(&"clipboard.write".to_string()));
    }

    #[test]
    fn rejects_bad_identifier() {
        let bad = VALID.replace("\"name\":\"dev-utils\"", "\"name\":\"Dev Utils!\"");
        assert!(parse(&bad).is_err());
    }

    #[test]
    fn rejects_unknown_permission() {
        let bad = VALID.replace("clipboard.write", "root.everything");
        assert!(parse(&bad).is_err());
    }

    #[test]
    fn rejects_unsupported_mode() {
        let bad = VALID.replace("\"mode\":\"list\"", "\"mode\":\"menu-bar\"");
        assert!(parse(&bad).is_err());
    }

    #[test]
    fn rejects_traversal_in_main() {
        let bad = VALID.replace(
            "\"commands\"",
            "\"main\":\"../../evil.mjs\",\"commands\"",
        );
        assert!(parse(&bad).is_err());
    }

    #[test]
    fn rejects_empty_commands() {
        let bad = r#"{"name":"x","title":"X","commands":[]}"#;
        assert!(parse(bad).is_err());
    }
}
