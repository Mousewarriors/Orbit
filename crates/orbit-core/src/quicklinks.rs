//! Quicklink data access over the migrated SQLite connection.
//!
//! A Quicklink is a saved, parameterisable target: a website, a web search
//! template (`https://…?q={query}`), a file/folder path, or a `mailto:` link. The
//! `target` may contain `@orbit/placeholders` tokens resolved at launch time. The
//! set is small, so `list` uses simple case-insensitive LIKE matching over
//! title/alias/target rather than FTS.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::DbError;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Quicklink {
    pub id: String,
    pub title: String,
    pub target: String,
    pub icon: Option<String>,
    pub alias: Option<String>,
    pub hotkey: Option<String>,
    pub browser: Option<String>,
    pub pinned: bool,
    pub created_at: i64,
}

const COLS: &str = "id, title, target, icon, alias, hotkey, browser, pinned, created_at";

fn row_to_quicklink(row: &rusqlite::Row<'_>) -> rusqlite::Result<Quicklink> {
    Ok(Quicklink {
        id: row.get(0)?,
        title: row.get(1)?,
        target: row.get(2)?,
        icon: row.get(3)?,
        alias: row.get(4)?,
        hotkey: row.get(5)?,
        browser: row.get(6)?,
        pinned: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
    })
}

/// Create a Quicklink with a caller-supplied stable id.
pub fn create(
    conn: &Connection,
    id: &str,
    title: &str,
    target: &str,
    alias: Option<&str>,
    at: i64,
) -> Result<Quicklink, DbError> {
    let alias = alias.filter(|a| !a.is_empty());
    conn.execute(
        "INSERT INTO quicklinks(id, title, target, alias, pinned, created_at)
         VALUES(?1, ?2, ?3, ?4, 0, ?5)",
        params![id, title, target, alias, at],
    )?;
    get(conn, id)?.ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
}

/// Update a Quicklink's title/target/alias.
pub fn update(
    conn: &Connection,
    id: &str,
    title: &str,
    target: &str,
    alias: Option<&str>,
) -> Result<Quicklink, DbError> {
    let alias = alias.filter(|a| !a.is_empty());
    conn.execute(
        "UPDATE quicklinks SET title = ?2, target = ?3, alias = ?4 WHERE id = ?1",
        params![id, title, target, alias],
    )?;
    get(conn, id)?.ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), DbError> {
    conn.execute("DELETE FROM quicklinks WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> Result<(), DbError> {
    conn.execute(
        "UPDATE quicklinks SET pinned = ?2 WHERE id = ?1",
        params![id, pinned as i64],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Quicklink>, DbError> {
    let sql = format!("SELECT {COLS} FROM quicklinks WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(row) => Ok(Some(row_to_quicklink(row)?)),
        None => Ok(None),
    }
}

/// List Quicklinks. An empty query returns pinned-then-recent; otherwise a
/// case-insensitive substring match over title, alias and target.
pub fn list(conn: &Connection, query: &str, limit: i64) -> Result<Vec<Quicklink>, DbError> {
    let q = query.trim();
    let mut out = Vec::new();
    if q.is_empty() {
        let sql = format!(
            "SELECT {COLS} FROM quicklinks ORDER BY pinned DESC, created_at DESC LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([limit], row_to_quicklink)?;
        for r in rows {
            out.push(r?);
        }
    } else {
        let like = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
        let sql = format!(
            "SELECT {COLS} FROM quicklinks
             WHERE title LIKE ?1 ESCAPE '\\' COLLATE NOCASE
                OR alias LIKE ?1 ESCAPE '\\' COLLATE NOCASE
                OR target LIKE ?1 ESCAPE '\\' COLLATE NOCASE
             ORDER BY pinned DESC, created_at DESC LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![like, limit], row_to_quicklink)?;
        for r in rows {
            out.push(r?);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn create_get_update_delete() {
        let conn = open_in_memory().unwrap();
        let q = create(
            &conn,
            "q1",
            "GitHub",
            "https://github.com",
            Some("gh"),
            100,
        )
        .unwrap();
        assert_eq!(q.title, "GitHub");
        assert_eq!(q.alias.as_deref(), Some("gh"));
        assert!(!q.pinned);

        update(&conn, "q1", "GitHub Search", "https://github.com/search?q={query}", Some("ghs"))
            .unwrap();
        let u = get(&conn, "q1").unwrap().unwrap();
        assert_eq!(u.title, "GitHub Search");
        assert!(u.target.contains("{query}"));

        delete(&conn, "q1").unwrap();
        assert!(get(&conn, "q1").unwrap().is_none());
    }

    #[test]
    fn list_filters_by_title_alias_target() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "GitHub", "https://github.com", Some("gh"), 100).unwrap();
        create(&conn, "b", "Google", "https://google.com/search?q={query}", Some("g"), 200).unwrap();
        assert_eq!(list(&conn, "git", 50).unwrap().len(), 1);
        assert_eq!(list(&conn, "gh", 50).unwrap()[0].id, "a"); // alias
        assert_eq!(list(&conn, "google.com", 50).unwrap()[0].id, "b"); // target
        assert_eq!(list(&conn, "", 50).unwrap().len(), 2);
    }

    #[test]
    fn pinned_sorts_first() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Alpha", "https://a.com", None, 100).unwrap();
        create(&conn, "b", "Beta", "https://b.com", None, 200).unwrap();
        set_pinned(&conn, "a", true).unwrap();
        let all = list(&conn, "", 50).unwrap();
        assert_eq!(all[0].id, "a", "pinned first despite older");
    }

    #[test]
    fn like_wildcards_are_escaped() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Plain", "https://a.com", None, 100).unwrap();
        // A query of "%" must not match everything.
        assert!(list(&conn, "%", 50).unwrap().is_empty());
    }
}
