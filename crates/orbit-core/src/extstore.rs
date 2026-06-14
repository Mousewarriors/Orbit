//! Per-extension namespaced key/value storage + enable/disable state.
//!
//! Every row is scoped by `ext_id`, and the native broker is the only caller, so
//! an extension can only ever see its own namespace — the cross-extension
//! isolation boundary required by the security model. Values are opaque strings.

use std::collections::HashMap;

use rusqlite::{params, Connection};

use crate::db::DbError;

/// Read one value from an extension's namespace.
pub fn get(conn: &Connection, ext_id: &str, key: &str) -> Result<Option<String>, DbError> {
    let mut stmt =
        conn.prepare("SELECT value FROM extension_storage WHERE ext_id = ?1 AND key = ?2")?;
    let mut rows = stmt.query(params![ext_id, key])?;
    match rows.next()? {
        Some(r) => Ok(Some(r.get(0)?)),
        None => Ok(None),
    }
}

/// Write one value into an extension's namespace.
pub fn set(conn: &Connection, ext_id: &str, key: &str, value: &str, at: i64) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO extension_storage(ext_id, key, value, updated_at) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(ext_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![ext_id, key, value, at],
    )?;
    Ok(())
}

/// Delete one key from an extension's namespace.
pub fn delete(conn: &Connection, ext_id: &str, key: &str) -> Result<(), DbError> {
    conn.execute(
        "DELETE FROM extension_storage WHERE ext_id = ?1 AND key = ?2",
        params![ext_id, key],
    )?;
    Ok(())
}

/// Snapshot the whole namespace for one extension (passed into an invocation).
pub fn all(conn: &Connection, ext_id: &str) -> Result<HashMap<String, String>, DbError> {
    let mut stmt = conn.prepare("SELECT key, value FROM extension_storage WHERE ext_id = ?1")?;
    let rows = stmt.query_map([ext_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = HashMap::new();
    for r in rows {
        let (k, v) = r?;
        out.insert(k, v);
    }
    Ok(out)
}

/// Remove every key for one extension (used when uninstalling/clearing).
pub fn clear(conn: &Connection, ext_id: &str) -> Result<(), DbError> {
    conn.execute("DELETE FROM extension_storage WHERE ext_id = ?1", [ext_id])?;
    Ok(())
}

/// Whether an extension is enabled (default true if no row exists).
pub fn is_enabled(conn: &Connection, ext_id: &str) -> Result<bool, DbError> {
    let mut stmt = conn.prepare("SELECT enabled FROM extension_state WHERE ext_id = ?1")?;
    let mut rows = stmt.query([ext_id])?;
    match rows.next()? {
        Some(r) => Ok(r.get::<_, i64>(0)? != 0),
        None => Ok(true),
    }
}

/// Persist an extension's enabled flag.
pub fn set_enabled(conn: &Connection, ext_id: &str, enabled: bool) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO extension_state(ext_id, enabled) VALUES(?1, ?2)
         ON CONFLICT(ext_id) DO UPDATE SET enabled = excluded.enabled",
        params![ext_id, enabled as i64],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn set_get_delete_roundtrip() {
        let conn = open_in_memory().unwrap();
        assert_eq!(get(&conn, "ext.a", "k").unwrap(), None);
        set(&conn, "ext.a", "k", "v", 1).unwrap();
        assert_eq!(get(&conn, "ext.a", "k").unwrap().as_deref(), Some("v"));
        set(&conn, "ext.a", "k", "v2", 2).unwrap(); // upsert
        assert_eq!(get(&conn, "ext.a", "k").unwrap().as_deref(), Some("v2"));
        delete(&conn, "ext.a", "k").unwrap();
        assert_eq!(get(&conn, "ext.a", "k").unwrap(), None);
    }

    #[test]
    fn namespaces_are_isolated() {
        let conn = open_in_memory().unwrap();
        set(&conn, "ext.a", "secret", "A", 1).unwrap();
        set(&conn, "ext.b", "secret", "B", 1).unwrap();
        // Each extension only sees its own value for the same key.
        assert_eq!(get(&conn, "ext.a", "secret").unwrap().as_deref(), Some("A"));
        assert_eq!(get(&conn, "ext.b", "secret").unwrap().as_deref(), Some("B"));
        let a = all(&conn, "ext.a").unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a.get("secret").map(String::as_str), Some("A"));
        clear(&conn, "ext.a").unwrap();
        assert!(all(&conn, "ext.a").unwrap().is_empty());
        // Clearing one namespace leaves the other intact.
        assert_eq!(get(&conn, "ext.b", "secret").unwrap().as_deref(), Some("B"));
    }

    #[test]
    fn enabled_defaults_true_and_persists() {
        let conn = open_in_memory().unwrap();
        assert!(is_enabled(&conn, "ext.a").unwrap());
        set_enabled(&conn, "ext.a", false).unwrap();
        assert!(!is_enabled(&conn, "ext.a").unwrap());
        set_enabled(&conn, "ext.a", true).unwrap();
        assert!(is_enabled(&conn, "ext.a").unwrap());
    }
}
