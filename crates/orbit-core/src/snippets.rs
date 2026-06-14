//! Snippet data access over the migrated SQLite connection.
//!
//! A snippet has an optional `keyword` (the trigger for system-wide expansion)
//! and a `content` template (expanded by `@orbit/placeholders` on the renderer
//! side, or injected verbatim by the keyword watcher). Full-text search is kept
//! in sync in the external-content `snippets_fts` table so `list` can do fast
//! prefix matching; an empty query falls back to most-used/most-recent order.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::DbError;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub keyword: Option<String>,
    pub content: String,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub use_count: i64,
}

const COLS: &str =
    "id, name, keyword, content, description, created_at, updated_at, use_count";

fn row_to_snippet(row: &rusqlite::Row<'_>) -> rusqlite::Result<Snippet> {
    Ok(Snippet {
        id: row.get(0)?,
        name: row.get(1)?,
        keyword: row.get(2)?,
        content: row.get(3)?,
        description: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        use_count: row.get(7)?,
    })
}

/// Insert into the external-content FTS index for a known rowid.
fn fts_insert(
    conn: &Connection,
    rowid: i64,
    name: &str,
    content: &str,
    description: Option<&str>,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO snippets_fts(rowid, name, content, description) VALUES(?1, ?2, ?3, ?4)",
        params![rowid, name, content, description],
    )?;
    Ok(())
}

/// Remove a row from the external-content FTS index (FTS5 'delete' command).
fn fts_delete(
    conn: &Connection,
    rowid: i64,
    name: &str,
    content: &str,
    description: Option<&str>,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO snippets_fts(snippets_fts, rowid, name, content, description)
         VALUES('delete', ?1, ?2, ?3, ?4)",
        params![rowid, name, content, description],
    )?;
    Ok(())
}

/// Build a safe FTS5 prefix query from arbitrary user text: each whitespace
/// token becomes a quoted prefix term ANDed together. Returns None when the
/// query has no usable tokens.
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

/// Create a snippet. Caller supplies a stable `id` (e.g. a UUID).
#[allow(clippy::too_many_arguments)]
pub fn create(
    conn: &Connection,
    id: &str,
    name: &str,
    keyword: Option<&str>,
    content: &str,
    description: Option<&str>,
    at: i64,
) -> Result<Snippet, DbError> {
    let keyword = keyword.filter(|k| !k.is_empty());
    conn.execute(
        "INSERT INTO snippets(id, name, keyword, content, description, created_at, updated_at, use_count)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?6, 0)",
        params![id, name, keyword, content, description, at],
    )?;
    let rowid = conn.last_insert_rowid();
    fts_insert(conn, rowid, name, content, description)?;
    get(conn, id)?.ok_or_else(|| {
        DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows)
    })
}

/// Update an existing snippet's fields. Returns the updated row.
pub fn update(
    conn: &Connection,
    id: &str,
    name: &str,
    keyword: Option<&str>,
    content: &str,
    description: Option<&str>,
    at: i64,
) -> Result<Snippet, DbError> {
    let keyword = keyword.filter(|k| !k.is_empty());
    // Pull the old row so we can correct the external-content FTS index.
    let old = get(conn, id)?
        .ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))?;
    let rowid: i64 =
        conn.query_row("SELECT rowid FROM snippets WHERE id = ?1", [id], |r| r.get(0))?;
    fts_delete(conn, rowid, &old.name, &old.content, old.description.as_deref())?;
    conn.execute(
        "UPDATE snippets SET name = ?2, keyword = ?3, content = ?4, description = ?5, updated_at = ?6
         WHERE id = ?1",
        params![id, name, keyword, content, description, at],
    )?;
    fts_insert(conn, rowid, name, content, description)?;
    get(conn, id)?.ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), DbError> {
    if let Some(old) = get(conn, id)? {
        let rowid: i64 =
            conn.query_row("SELECT rowid FROM snippets WHERE id = ?1", [id], |r| r.get(0))?;
        fts_delete(conn, rowid, &old.name, &old.content, old.description.as_deref())?;
        conn.execute("DELETE FROM snippets WHERE id = ?1", [id])?;
    }
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Snippet>, DbError> {
    let sql = format!("SELECT {COLS} FROM snippets WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(row) => Ok(Some(row_to_snippet(row)?)),
        None => Ok(None),
    }
}

/// List snippets. An empty/whitespace query returns the most-used then
/// most-recent snippets; otherwise a prefix FTS match ranked by relevance.
pub fn list(conn: &Connection, query: &str, limit: i64) -> Result<Vec<Snippet>, DbError> {
    let mut out = Vec::new();
    match fts_query(query) {
        None => {
            let sql = format!(
                "SELECT {COLS} FROM snippets
                 ORDER BY use_count DESC, updated_at DESC LIMIT ?1"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([limit], row_to_snippet)?;
            for r in rows {
                out.push(r?);
            }
        }
        Some(match_expr) => {
            let sql = format!(
                "SELECT {} FROM snippets s
                 JOIN snippets_fts f ON f.rowid = s.rowid
                 WHERE snippets_fts MATCH ?1
                 ORDER BY rank, s.use_count DESC LIMIT ?2",
                COLS.split(',')
                    .map(|c| format!("s.{}", c.trim()))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![match_expr, limit], row_to_snippet)?;
            for r in rows {
                out.push(r?);
            }
        }
    }
    Ok(out)
}

/// Bump usage so frequently-used snippets float to the top.
pub fn record_use(conn: &Connection, id: &str, at: i64) -> Result<(), DbError> {
    conn.execute(
        "UPDATE snippets SET use_count = use_count + 1, updated_at = ?2 WHERE id = ?1",
        params![id, at],
    )?;
    Ok(())
}

/// `(keyword, snippet_id)` pairs for snippets that have a non-empty keyword —
/// the input for the system-wide expansion watcher.
pub fn keyword_map(conn: &Connection) -> Result<Vec<(String, String)>, DbError> {
    let mut stmt = conn
        .prepare("SELECT keyword, id FROM snippets WHERE keyword IS NOT NULL AND keyword <> ''")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn create_and_get() {
        let conn = open_in_memory().unwrap();
        let s = create(
            &conn,
            "s1",
            "Address",
            Some("addr"),
            "1 Infinite Loop",
            Some("home"),
            100,
        )
        .unwrap();
        assert_eq!(s.name, "Address");
        assert_eq!(s.keyword.as_deref(), Some("addr"));
        assert_eq!(s.use_count, 0);
        assert_eq!(get(&conn, "s1").unwrap().unwrap().content, "1 Infinite Loop");
    }

    #[test]
    fn empty_keyword_stored_as_null() {
        let conn = open_in_memory().unwrap();
        let s = create(&conn, "s1", "No KW", Some(""), "body", None, 100).unwrap();
        assert_eq!(s.keyword, None);
    }

    #[test]
    fn list_recent_orders_by_use_then_recency() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Alpha", None, "a body", None, 100).unwrap();
        create(&conn, "b", "Beta", None, "b body", None, 200).unwrap();
        record_use(&conn, "a", 300).unwrap();
        let all = list(&conn, "", 50).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, "a", "most-used first");
    }

    #[test]
    fn search_prefix_matches_via_fts() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Greeting", None, "hello there", None, 100).unwrap();
        create(&conn, "b", "Farewell", None, "goodbye now", None, 200).unwrap();
        let hits = list(&conn, "hel", 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "a");
        // Matches against the name field too.
        assert_eq!(list(&conn, "fare", 50).unwrap()[0].id, "b");
    }

    #[test]
    fn update_changes_fields_and_reindexes_fts() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Old Name", Some("old"), "old body", None, 100).unwrap();
        update(&conn, "a", "New Name", Some("new"), "fresh body", Some("d"), 200).unwrap();
        let s = get(&conn, "a").unwrap().unwrap();
        assert_eq!(s.name, "New Name");
        assert_eq!(s.keyword.as_deref(), Some("new"));
        assert_eq!(s.updated_at, 200);
        // FTS reflects the new content and no longer the old.
        assert_eq!(list(&conn, "fresh", 50).unwrap().len(), 1);
        assert!(list(&conn, "old", 50).unwrap().is_empty());
    }

    #[test]
    fn delete_removes_row_and_fts() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Temp", None, "scratch", None, 100).unwrap();
        delete(&conn, "a").unwrap();
        assert!(get(&conn, "a").unwrap().is_none());
        assert!(list(&conn, "scratch", 50).unwrap().is_empty());
    }

    #[test]
    fn keyword_map_excludes_blank_keywords() {
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Has KW", Some("sig"), "body", None, 100).unwrap();
        create(&conn, "b", "No KW", None, "body", None, 100).unwrap();
        let map = keyword_map(&conn).unwrap();
        assert_eq!(map, vec![("sig".to_string(), "a".to_string())]);
    }

    #[test]
    fn fts_query_is_quote_safe() {
        // A query with FTS metacharacters must not error.
        let conn = open_in_memory().unwrap();
        create(&conn, "a", "Quote", None, "she said \"hi\"", None, 100).unwrap();
        let hits = list(&conn, "she \"hi", 50).unwrap();
        assert_eq!(hits.len(), 1);
    }
}
