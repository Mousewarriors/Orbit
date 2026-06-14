//! Notes data access over the migrated SQLite connection.
//!
//! A note is a title + Markdown-oriented body, stored locally. Full-text search
//! over title+body is kept in sync in the external-content `notes_fts` table so
//! `list` does fast prefix matching; an empty query returns pinned-then-recent.
//! Archived notes are hidden from the default list but kept for recovery.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::DbError;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub pinned: bool,
    pub archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

const COLS: &str = "id, title, body, pinned, archived, created_at, updated_at";

fn row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        pinned: row.get::<_, i64>(3)? != 0,
        archived: row.get::<_, i64>(4)? != 0,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn fts_insert(conn: &Connection, rowid: i64, title: &str, body: &str) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO notes_fts(rowid, title, body) VALUES(?1, ?2, ?3)",
        params![rowid, title, body],
    )?;
    Ok(())
}

fn fts_delete(conn: &Connection, rowid: i64, title: &str, body: &str) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', ?1, ?2, ?3)",
        params![rowid, title, body],
    )?;
    Ok(())
}

fn fts_query(query: &str) -> Option<String> {
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|t| t.replace('"', "\"\""))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

pub fn create(
    conn: &Connection,
    id: &str,
    title: &str,
    body: &str,
    at: i64,
) -> Result<Note, DbError> {
    conn.execute(
        "INSERT INTO notes(id, title, body, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?4)",
        params![id, title, body, at],
    )?;
    let rowid = conn.last_insert_rowid();
    fts_insert(conn, rowid, title, body)?;
    get(conn, id)?.ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
}

pub fn update(
    conn: &Connection,
    id: &str,
    title: &str,
    body: &str,
    at: i64,
) -> Result<Note, DbError> {
    let old = get(conn, id)?.ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))?;
    let rowid: i64 = conn.query_row("SELECT rowid FROM notes WHERE id = ?1", [id], |r| r.get(0))?;
    fts_delete(conn, rowid, &old.title, &old.body)?;
    conn.execute(
        "UPDATE notes SET title = ?2, body = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, title, body, at],
    )?;
    fts_insert(conn, rowid, title, body)?;
    get(conn, id)?.ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
}

pub fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> Result<(), DbError> {
    conn.execute(
        "UPDATE notes SET pinned = ?2 WHERE id = ?1",
        params![id, pinned as i64],
    )?;
    Ok(())
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool) -> Result<(), DbError> {
    conn.execute(
        "UPDATE notes SET archived = ?2 WHERE id = ?1",
        params![id, archived as i64],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), DbError> {
    if let Some(old) = get(conn, id)? {
        let rowid: i64 =
            conn.query_row("SELECT rowid FROM notes WHERE id = ?1", [id], |r| r.get(0))?;
        fts_delete(conn, rowid, &old.title, &old.body)?;
        conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
    }
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Note>, DbError> {
    let sql = format!("SELECT {COLS} FROM notes WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(row) => Ok(Some(row_to_note(row)?)),
        None => Ok(None),
    }
}

/// List notes (excluding archived). Empty query → pinned-then-recent; otherwise
/// a prefix FTS match over title + body.
pub fn list(conn: &Connection, query: &str, limit: i64) -> Result<Vec<Note>, DbError> {
    let mut out = Vec::new();
    match fts_query(query) {
        None => {
            let sql = format!(
                "SELECT {COLS} FROM notes WHERE archived = 0
                 ORDER BY pinned DESC, updated_at DESC LIMIT ?1"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([limit], row_to_note)?;
            for r in rows {
                out.push(r?);
            }
        }
        Some(expr) => {
            let select = COLS
                .split(',')
                .map(|c| format!("n.{}", c.trim()))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT {select} FROM notes n JOIN notes_fts f ON f.rowid = n.rowid
                 WHERE notes_fts MATCH ?1 AND n.archived = 0
                 ORDER BY rank, n.updated_at DESC LIMIT ?2"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![expr, limit], row_to_note)?;
            for r in rows {
                out.push(r?);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn create_update_get() {
        let conn = open_in_memory().unwrap();
        create(&conn, "n1", "Shopping", "milk, eggs", 100).unwrap();
        let n = get(&conn, "n1").unwrap().unwrap();
        assert_eq!(n.title, "Shopping");
        assert_eq!(n.updated_at, 100);
        update(&conn, "n1", "Shopping list", "milk, eggs, bread", 200).unwrap();
        let u = get(&conn, "n1").unwrap().unwrap();
        assert_eq!(u.body, "milk, eggs, bread");
        assert_eq!(u.updated_at, 200);
    }

    #[test]
    fn search_matches_title_and_body_and_reindexes() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Recipes", "pancake batter", 100).unwrap();
        create(&conn, "b", "Travel", "flight to Rome", 200).unwrap();
        assert_eq!(list(&conn, "panc", 50).unwrap().len(), 1);
        assert_eq!(list(&conn, "rome", 50).unwrap()[0].id, "b");
        update(&conn, "a", "Recipes", "waffle batter", 300).unwrap();
        assert!(list(&conn, "pancake", 50).unwrap().is_empty());
        assert_eq!(list(&conn, "waffle", 50).unwrap().len(), 1);
    }

    #[test]
    fn pinned_then_recent_ordering() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Old", "x", 100).unwrap();
        create(&conn, "b", "New", "y", 200).unwrap();
        set_pinned(&conn, "a", true).unwrap();
        let all = list(&conn, "", 50).unwrap();
        assert_eq!(all[0].id, "a");
    }

    #[test]
    fn archived_hidden_from_list_but_recoverable() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Keep", "x", 100).unwrap();
        set_archived(&conn, "a", true).unwrap();
        assert!(list(&conn, "", 50).unwrap().is_empty());
        assert!(get(&conn, "a").unwrap().unwrap().archived);
        set_archived(&conn, "a", false).unwrap();
        assert_eq!(list(&conn, "", 50).unwrap().len(), 1);
    }

    #[test]
    fn delete_removes_row_and_fts() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Temp", "scratch", 100).unwrap();
        delete(&conn, "a").unwrap();
        assert!(get(&conn, "a").unwrap().is_none());
        assert!(list(&conn, "scratch", 50).unwrap().is_empty());
    }
}
