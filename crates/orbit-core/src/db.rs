//! Thin data-access helpers over a migrated SQLite connection.

use rusqlite::{params, Connection};

use crate::migrations;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("migration error: {0}")]
    Migration(#[from] migrations::MigrationError),
}

/// Open (or create) a database at `path`, enable sane pragmas, and migrate it.
pub fn open(path: &str) -> Result<Connection, DbError> {
    let mut conn = Connection::open(path)?;
    configure(&conn)?;
    migrations::run(&mut conn)?;
    Ok(conn)
}

/// Open an in-memory database (used by tests and ephemeral contexts).
pub fn open_in_memory() -> Result<Connection, DbError> {
    let mut conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrations::run(&mut conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

/// Get a setting value, or None if unset.
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, DbError> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query([key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

/// Upsert a setting value.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Record a command use, bumping count and timestamp atomically.
pub fn record_command_usage(conn: &Connection, command_id: &str, at: i64) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO command_usage(command_id, use_count, last_used_at)
         VALUES(?1, 1, ?2)
         ON CONFLICT(command_id) DO UPDATE SET
            use_count = use_count + 1,
            last_used_at = excluded.last_used_at",
        params![command_id, at],
    )?;
    Ok(())
}

/// (command_id, use_count, last_used_at) for ranking signals.
pub fn usage_snapshot(conn: &Connection) -> Result<Vec<(String, i64, i64)>, DbError> {
    let mut stmt =
        conn.prepare("SELECT command_id, use_count, last_used_at FROM command_usage")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_roundtrip() {
        let conn = open_in_memory().unwrap();
        assert_eq!(get_setting(&conn, "theme").unwrap(), None);
        set_setting(&conn, "theme", "dark").unwrap();
        assert_eq!(get_setting(&conn, "theme").unwrap(), Some("dark".into()));
        set_setting(&conn, "theme", "light").unwrap();
        assert_eq!(get_setting(&conn, "theme").unwrap(), Some("light".into()));
    }

    #[test]
    fn usage_accumulates() {
        let conn = open_in_memory().unwrap();
        record_command_usage(&conn, "cmd.a", 100).unwrap();
        record_command_usage(&conn, "cmd.a", 200).unwrap();
        let snap = usage_snapshot(&conn).unwrap();
        assert_eq!(snap, vec![("cmd.a".to_string(), 2, 200)]);
    }
}
