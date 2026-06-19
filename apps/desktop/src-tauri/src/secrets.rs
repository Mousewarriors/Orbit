//! OS secure-storage for credentials (Windows Credential Manager / macOS
//! Keychain / Linux Secret Service via the `keyring` crate).
//!
//! API keys and other secrets are stored ONLY here — never in SQLite, JSON,
//! settings, logs or git (spec §9.5). The renderer stores a secret by name and
//! later asks whether one exists / fetches it at provider-construction time; the
//! value never round-trips through the settings KV.

const SERVICE: &str = "orbit";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    if key.is_empty() || key.len() > 200 {
        return Err("invalid secret key".into());
    }
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_has(key: String) -> Result<bool, String> {
    Ok(secret_get(key)?.is_some())
}
