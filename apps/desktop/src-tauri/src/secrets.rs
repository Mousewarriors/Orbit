//! OS secure-storage for credentials (Windows Credential Manager / macOS
//! Keychain / Linux Secret Service via the `keyring` crate).
//!
//! API keys and other secrets are stored ONLY here — never in SQLite, JSON,
//! settings, logs or git (spec §9.5). The renderer stores a secret by name and
//! later asks whether one exists / fetches it at provider-construction time; the
//! value never round-trips through the settings KV.
//!
//! **Chunking:** a single OS credential blob is size-limited (Windows Credential
//! Manager caps the value well below the size of a large OAuth token set — two
//! JWTs plus a refresh token easily exceed it). So a value longer than
//! `MAX_CHUNK` is transparently split across `"<key>#0"`, `"<key>#1"`, … with the
//! primary entry holding a small marker recording the chunk count. Small secrets
//! (the common case) are still stored as a single entry, unchanged.

const SERVICE: &str = "orbit";

/// Max characters per credential entry. Kept comfortably under the platform cap
/// (Windows allows ~2560 UTF-16 chars) so even large OAuth tokens store cleanly.
const MAX_CHUNK: usize = 1000;

/// Sentinel stored in the primary entry when a value was split. The trailing
/// number is the chunk count. The NUL prefix can't occur in a real token/key.
const CHUNK_MARKER: &str = "\u{0}orbit-chunked:";

fn validate_secret_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 220 {
        return Err("invalid secret key".into());
    }
    if !key
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b':'))
    {
        return Err("secret key contains unsupported characters".into());
    }
    if matches!(
        key,
        "ai.cloud.apikey"
            | "ai.ollama.apikey"
            | "ai.anthropic.apikey"
            | "ai.oauth.openai-codex"
            | "ai.oauth.anthropic-claude"
    ) || is_valid_mcp_secret_key(key)
    {
        return Ok(());
    }
    Err("secret key is not an approved Orbit credential".into())
}

fn is_valid_mcp_secret_key(key: &str) -> bool {
    let Some(rest) = key.strip_prefix("mcp.server:") else {
        return false;
    };
    let Some((server_id, kind)) = rest.rsplit_once('.') else {
        return false;
    };
    matches!(kind, "token" | "apikey" | "oauth")
        && (3..=80).contains(&server_id.len())
        && server_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b':'))
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Split `value` into chunks of at most `MAX_CHUNK` characters (on char
/// boundaries, so multi-byte text is never cut mid-character).
fn split_chunks(value: &str) -> Vec<String> {
    let chars: Vec<char> = value.chars().collect();
    chars
        .chunks(MAX_CHUNK)
        .map(|c| c.iter().collect::<String>())
        .collect()
}

/// Delete any chunk entries `key#0..` until the first missing one.
fn clear_chunks(key: &str) {
    let mut i = 0usize;
    loop {
        let Ok(e) = entry(&format!("{key}#{i}")) else {
            break;
        };
        match e.delete_credential() {
            Ok(()) => i += 1,
            Err(_) => break, // NoEntry or any error → stop scanning
        }
    }
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    validate_secret_key(&key)?;
    // Always clear any prior chunks first so a shrinking value can't leave stragglers.
    clear_chunks(&key);

    if value.chars().count() <= MAX_CHUNK {
        return entry(&key)?.set_password(&value).map_err(|e| e.to_string());
    }

    let chunks = split_chunks(&value);
    for (i, chunk) in chunks.iter().enumerate() {
        entry(&format!("{key}#{i}"))?
            .set_password(chunk)
            .map_err(|e| e.to_string())?;
    }
    entry(&key)?
        .set_password(&format!("{CHUNK_MARKER}{}", chunks.len()))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    validate_secret_key(&key)?;
    match entry(&key)?.get_password() {
        Ok(p) => {
            if let Some(count) = p.strip_prefix(CHUNK_MARKER) {
                let n: usize = count
                    .parse()
                    .map_err(|_| "corrupt chunked secret".to_string())?;
                let mut out = String::new();
                for i in 0..n {
                    let part = entry(&format!("{key}#{i}"))?
                        .get_password()
                        .map_err(|e| e.to_string())?;
                    out.push_str(&part);
                }
                Ok(Some(out))
            } else {
                Ok(Some(p))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    validate_secret_key(&key)?;
    clear_chunks(&key);
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_has(key: String) -> Result<bool, String> {
    validate_secret_key(&key)?;
    Ok(secret_get(key)?.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_values_are_a_single_chunk() {
        assert_eq!(split_chunks("hello").len(), 1);
        assert_eq!(split_chunks(&"x".repeat(MAX_CHUNK)).len(), 1);
    }

    #[test]
    fn long_values_split_and_rejoin_losslessly() {
        let value = "A".repeat(MAX_CHUNK * 3 + 7);
        let chunks = split_chunks(&value);
        assert_eq!(chunks.len(), 4);
        assert!(chunks.iter().all(|c| c.chars().count() <= MAX_CHUNK));
        assert_eq!(chunks.concat(), value);
    }

    #[test]
    fn splits_on_char_boundaries() {
        // Multi-byte chars must never be cut mid-character.
        let value = "\u{00e9}".repeat(MAX_CHUNK + 10);
        let chunks = split_chunks(&value);
        assert_eq!(chunks.concat(), value);
        assert!(chunks.iter().all(|c| c.chars().count() <= MAX_CHUNK));
    }

    #[test]
    fn validates_only_approved_secret_namespaces() {
        for key in [
            "ai.cloud.apikey",
            "ai.ollama.apikey",
            "ai.anthropic.apikey",
            "ai.oauth.openai-codex",
            "ai.oauth.anthropic-claude",
            "mcp.server:agentos.token",
            "mcp.server:team-vault.apikey",
            "mcp.server:corp:gateway.oauth",
        ] {
            validate_secret_key(key).expect(key);
        }
        for key in [
            "",
            "github.token",
            "password",
            "ai.bad/key",
            "ai.anything",
            "ai.oauth.fake",
            "mcp.attacker.token",
            "mcp.server:x.token",
            "mcp.server:agentos.password",
            "mcp.server:bad/slash.token",
            "mcp.bad#0",
        ] {
            assert!(validate_secret_key(key).is_err(), "{key} must be rejected");
        }
    }
}
