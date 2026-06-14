//! Clipboard-history data access over the migrated SQLite connection.
//!
//! Entries are de-duplicated by a content hash: re-copying the same text moves
//! the existing entry to the top rather than creating a duplicate. Pinned
//! entries are retained by `clear` and `prune`.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::DbError;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ClipboardEntry {
    pub id: i64,
    pub kind: String,
    pub content: String,
    pub preview: String,
    pub source_app: Option<String>,
    pub sensitive: bool,
    pub pinned: bool,
    pub created_at: i64,
}

/// FNV-1a hash of the content, hex-encoded — stable across runs for dedupe.
pub fn content_hash(content: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in content.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn preview_of(content: &str) -> String {
    let trimmed = content.trim();
    let one_line: String = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() > 120 {
        let truncated: String = one_line.chars().take(117).collect();
        format!("{truncated}…")
    } else {
        one_line
    }
}

/// Insert a text entry, collapsing duplicates by hash (bumps `created_at`).
/// Returns the row id of the (new or existing) entry.
pub fn insert_text(
    conn: &Connection,
    content: &str,
    source_app: Option<&str>,
    sensitive: bool,
    created_at: i64,
) -> Result<i64, DbError> {
    let hash = content_hash(content);
    let preview = preview_of(content);
    conn.execute(
        "INSERT INTO clipboard_entries(kind, content, preview, source_app, sensitive, created_at, hash)
         VALUES('text', ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(hash) WHERE hash IS NOT NULL
         DO UPDATE SET created_at = excluded.created_at",
        params![content, preview, source_app, sensitive as i32, created_at, hash],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM clipboard_entries WHERE hash = ?1",
        [hash],
        |r| r.get(0),
    )?;
    Ok(id)
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClipboardEntry> {
    Ok(ClipboardEntry {
        id: row.get(0)?,
        kind: row.get(1)?,
        content: row.get(2)?,
        preview: row.get(3)?,
        source_app: row.get(4)?,
        sensitive: row.get::<_, i32>(5)? != 0,
        pinned: row.get::<_, i32>(6)? != 0,
        created_at: row.get(7)?,
    })
}

/// List entries, optionally filtered by a case-insensitive substring of the
/// content. Pinned entries sort first, then most-recent.
pub fn list(conn: &Connection, query: &str, limit: i64) -> Result<Vec<ClipboardEntry>, DbError> {
    let sql = "SELECT id, kind, content, preview, source_app, sensitive, pinned, created_at
               FROM clipboard_entries
               WHERE (?1 = '' OR content LIKE '%' || ?1 || '%')
               ORDER BY pinned DESC, created_at DESC
               LIMIT ?2";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![query, limit], row_to_entry)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM clipboard_entries WHERE id = ?1", [id])?;
    Ok(())
}

/// Delete all non-pinned entries. Returns the number removed.
pub fn clear(conn: &Connection) -> Result<usize, DbError> {
    let n = conn.execute("DELETE FROM clipboard_entries WHERE pinned = 0", [])?;
    Ok(n)
}

pub fn set_pinned(conn: &Connection, id: i64, pinned: bool) -> Result<(), DbError> {
    conn.execute(
        "UPDATE clipboard_entries SET pinned = ?2 WHERE id = ?1",
        params![id, pinned as i32],
    )?;
    Ok(())
}

/// Keep at most `max` non-pinned entries, deleting the oldest beyond that.
pub fn prune(conn: &Connection, max: i64) -> Result<usize, DbError> {
    let n = conn.execute(
        "DELETE FROM clipboard_entries
         WHERE pinned = 0 AND id NOT IN (
             SELECT id FROM clipboard_entries WHERE pinned = 0
             ORDER BY created_at DESC LIMIT ?1
         )",
        [max],
    )?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn insert_and_list() {
        let conn = open_in_memory().unwrap();
        insert_text(&conn, "hello world", Some("Editor"), false, 100).unwrap();
        insert_text(&conn, "second", None, false, 200).unwrap();
        let all = list(&conn, "", 50).unwrap();
        assert_eq!(all.len(), 2);
        // Most recent first.
        assert_eq!(all[0].content, "second");
        assert_eq!(all[1].source_app.as_deref(), Some("Editor"));
    }

    #[test]
    fn duplicates_collapse_and_bump() {
        let conn = open_in_memory().unwrap();
        let id1 = insert_text(&conn, "dup", None, false, 100).unwrap();
        insert_text(&conn, "other", None, false, 150).unwrap();
        let id2 = insert_text(&conn, "dup", None, false, 200).unwrap();
        assert_eq!(id1, id2, "same content reuses the row");
        let all = list(&conn, "", 50).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].content, "dup", "bumped to top by new timestamp");
    }

    #[test]
    fn search_filters_by_content() {
        let conn = open_in_memory().unwrap();
        insert_text(&conn, "apple pie", None, false, 100).unwrap();
        insert_text(&conn, "banana split", None, false, 200).unwrap();
        let hits = list(&conn, "apple", 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].content, "apple pie");
    }

    #[test]
    fn clear_keeps_pinned() {
        let conn = open_in_memory().unwrap();
        let keep = insert_text(&conn, "keep", None, false, 100).unwrap();
        insert_text(&conn, "drop", None, false, 200).unwrap();
        set_pinned(&conn, keep, true).unwrap();
        let removed = clear(&conn).unwrap();
        assert_eq!(removed, 1);
        let all = list(&conn, "", 50).unwrap();
        assert_eq!(all.len(), 1);
        assert!(all[0].pinned);
    }

    #[test]
    fn prune_caps_non_pinned() {
        let conn = open_in_memory().unwrap();
        for i in 0..5 {
            insert_text(&conn, &format!("item {i}"), None, false, i as i64).unwrap();
        }
        let removed = prune(&conn, 3).unwrap();
        assert_eq!(removed, 2);
        assert_eq!(list(&conn, "", 50).unwrap().len(), 3);
    }

    #[test]
    fn preview_is_single_line_and_bounded() {
        assert_eq!(preview_of("  a\n\n  b   c "), "a b c");
        assert_eq!(content_hash("x"), content_hash("x"));
        assert_ne!(content_hash("x"), content_hash("y"));
    }
}
