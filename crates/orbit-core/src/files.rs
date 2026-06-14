//! Local file-index data access over the migrated SQLite connection.
//!
//! The index stores **metadata only** (name, path, extension, size, times) — no
//! file contents. `path` is the natural key. An external-content `files_fts`
//! table mirrors name + path so `search` can do fast prefix matching over both;
//! results are ranked by FTS relevance then recency. Rebuilds are transactional:
//! [`clear`] empties the table and FTS, then [`insert`] batches new rows.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::DbError;

/// A row in the file index, returned to the renderer.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileRecord {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub ext: Option<String>,
    pub kind: String,
    pub size: i64,
    pub created_at: Option<i64>,
    pub modified_at: i64,
}

/// Input for indexing a single filesystem entry.
#[derive(Debug, Clone)]
pub struct FileInput {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub ext: Option<String>,
    pub kind: String,
    pub size: i64,
    pub created_at: Option<i64>,
    pub modified_at: i64,
}

/// Optional filters for a file search.
#[derive(Debug, Clone, Default)]
pub struct FileFilters {
    /// Restrict to a kind: "file" or "dir".
    pub kind: Option<String>,
    /// Restrict to a specific (lowercased, dot-less) extension.
    pub ext: Option<String>,
    /// Only entries modified at/after this epoch-ms.
    pub modified_after: Option<i64>,
}

const COLS: &str = "path, name, parent, ext, kind, size, created_at, modified_at";

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileRecord> {
    Ok(FileRecord {
        path: row.get(0)?,
        name: row.get(1)?,
        parent: row.get(2)?,
        ext: row.get(3)?,
        kind: row.get(4)?,
        size: row.get(5)?,
        created_at: row.get(6)?,
        modified_at: row.get(7)?,
    })
}

/// Build a safe FTS5 prefix query: each whitespace token becomes a quoted prefix
/// term, ANDed. Returns None when there are no usable tokens.
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

/// Remove every indexed file and reset the FTS mirror. Used before a full
/// rebuild so stale entries never linger.
pub fn clear(conn: &Connection) -> Result<(), DbError> {
    conn.execute("DELETE FROM files", [])?;
    // Rebuild the external-content FTS from the (now empty) content table.
    conn.execute("INSERT INTO files_fts(files_fts) VALUES('rebuild')", [])?;
    Ok(())
}

/// Insert (or replace) a single entry and keep the FTS mirror in sync. Safe to
/// call repeatedly for the same path (used by incremental reindex).
pub fn insert(conn: &Connection, f: &FileInput, indexed_at: i64) -> Result<(), DbError> {
    // If the path already exists, remove its FTS row first so we don't duplicate.
    if let Some(rowid) = rowid_for(conn, &f.path)? {
        let old = get(conn, &f.path)?;
        if let Some(o) = old {
            fts_delete(conn, rowid, &o.name, &o.path)?;
        }
        conn.execute("DELETE FROM files WHERE path = ?1", [&f.path])?;
    }
    conn.execute(
        "INSERT INTO files(path, name, parent, ext, kind, size, created_at, modified_at, indexed_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            f.path,
            f.name,
            f.parent,
            f.ext,
            f.kind,
            f.size,
            f.created_at,
            f.modified_at,
            indexed_at
        ],
    )?;
    let rowid = conn.last_insert_rowid();
    fts_insert(conn, rowid, &f.name, &f.path)?;
    Ok(())
}

fn rowid_for(conn: &Connection, path: &str) -> Result<Option<i64>, DbError> {
    let mut stmt = conn.prepare("SELECT rowid FROM files WHERE path = ?1")?;
    let mut rows = stmt.query([path])?;
    match rows.next()? {
        Some(r) => Ok(Some(r.get(0)?)),
        None => Ok(None),
    }
}

fn fts_insert(conn: &Connection, rowid: i64, name: &str, path: &str) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO files_fts(rowid, name, path) VALUES(?1, ?2, ?3)",
        params![rowid, name, path],
    )?;
    Ok(())
}

fn fts_delete(conn: &Connection, rowid: i64, name: &str, path: &str) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO files_fts(files_fts, rowid, name, path) VALUES('delete', ?1, ?2, ?3)",
        params![rowid, name, path],
    )?;
    Ok(())
}

/// Fetch a single record by path.
pub fn get(conn: &Connection, path: &str) -> Result<Option<FileRecord>, DbError> {
    let sql = format!("SELECT {COLS} FROM files WHERE path = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([path])?;
    match rows.next()? {
        Some(row) => Ok(Some(row_to_record(row)?)),
        None => Ok(None),
    }
}

/// Number of indexed entries.
pub fn count(conn: &Connection) -> Result<i64, DbError> {
    Ok(conn.query_row("SELECT count(*) FROM files", [], |r| r.get(0))?)
}

/// Search the index. An empty query returns the most recently modified entries
/// (subject to filters); otherwise a prefix FTS match over name + path ranked by
/// relevance then recency.
pub fn search(
    conn: &Connection,
    query: &str,
    filters: &FileFilters,
    limit: i64,
) -> Result<Vec<FileRecord>, DbError> {
    // Build the optional filter clause + bound parameters shared by both paths.
    let mut clauses: Vec<String> = Vec::new();
    let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(kind) = filters.kind.as_ref().filter(|k| !k.is_empty()) {
        clauses.push("f.kind = ?".into());
        binds.push(Box::new(kind.clone()));
    }
    if let Some(ext) = filters.ext.as_ref().filter(|e| !e.is_empty()) {
        clauses.push("f.ext = ?".into());
        binds.push(Box::new(ext.to_lowercase()));
    }
    if let Some(after) = filters.modified_after {
        clauses.push("f.modified_at >= ?".into());
        binds.push(Box::new(after));
    }

    let select = COLS
        .split(',')
        .map(|c| format!("f.{}", c.trim()))
        .collect::<Vec<_>>()
        .join(", ");

    let (sql, fts_first) = match fts_query(query) {
        Some(expr) => {
            let mut where_parts = vec!["files_fts MATCH ?".to_string()];
            where_parts.extend(clauses.iter().cloned());
            (
                format!(
                    "SELECT {select} FROM files f JOIN files_fts ft ON ft.rowid = f.rowid
                     WHERE {} ORDER BY ft.rank, f.modified_at DESC LIMIT ?",
                    where_parts.join(" AND ")
                ),
                Some(expr),
            )
        }
        None => {
            let where_sql = if clauses.is_empty() {
                String::new()
            } else {
                format!("WHERE {}", clauses.join(" AND "))
            };
            (
                format!(
                    "SELECT {select} FROM files f {where_sql}
                     ORDER BY f.modified_at DESC LIMIT ?"
                ),
                None,
            )
        }
    };

    let mut stmt = conn.prepare(&sql)?;
    // Assemble params in positional order: [MATCH], filters…, limit.
    let mut params_vec: Vec<&dyn rusqlite::ToSql> = Vec::new();
    if let Some(expr) = fts_first.as_ref() {
        params_vec.push(expr);
    }
    for b in &binds {
        params_vec.push(b.as_ref());
    }
    params_vec.push(&limit);

    let rows = stmt.query_map(params_vec.as_slice(), row_to_record)?;
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

    fn f(path: &str, name: &str, ext: Option<&str>, kind: &str, modified: i64) -> FileInput {
        FileInput {
            path: path.into(),
            name: name.into(),
            parent: "/root".into(),
            ext: ext.map(|e| e.into()),
            kind: kind.into(),
            size: 10,
            created_at: Some(1),
            modified_at: modified,
        }
    }

    #[test]
    fn insert_and_get() {
        let conn = open_in_memory().unwrap();
        insert(&conn, &f("/root/a.txt", "a.txt", Some("txt"), "file", 100), 1).unwrap();
        let rec = get(&conn, "/root/a.txt").unwrap().unwrap();
        assert_eq!(rec.name, "a.txt");
        assert_eq!(rec.ext.as_deref(), Some("txt"));
        assert_eq!(count(&conn).unwrap(), 1);
    }

    #[test]
    fn reinsert_same_path_replaces_without_duplicating() {
        let conn = open_in_memory().unwrap();
        insert(&conn, &f("/root/a.txt", "a.txt", Some("txt"), "file", 100), 1).unwrap();
        insert(&conn, &f("/root/a.txt", "a.txt", Some("txt"), "file", 200), 2).unwrap();
        assert_eq!(count(&conn).unwrap(), 1);
        assert_eq!(get(&conn, "/root/a.txt").unwrap().unwrap().modified_at, 200);
        // FTS still matches exactly once.
        let hits = search(&conn, "a", &FileFilters::default(), 50).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn search_matches_name_and_path_prefix() {
        let conn = open_in_memory().unwrap();
        insert(&conn, &f("/root/report.pdf", "report.pdf", Some("pdf"), "file", 100), 1).unwrap();
        insert(&conn, &f("/root/notes.md", "notes.md", Some("md"), "file", 200), 1).unwrap();
        assert_eq!(search(&conn, "rep", &FileFilters::default(), 50).unwrap().len(), 1);
        // Path fragment also matches via the indexed path column.
        assert_eq!(search(&conn, "root", &FileFilters::default(), 50).unwrap().len(), 2);
    }

    #[test]
    fn empty_query_orders_by_recency() {
        let conn = open_in_memory().unwrap();
        insert(&conn, &f("/root/old", "old", None, "file", 100), 1).unwrap();
        insert(&conn, &f("/root/new", "new", None, "file", 300), 1).unwrap();
        let all = search(&conn, "", &FileFilters::default(), 50).unwrap();
        assert_eq!(all[0].name, "new", "most recent first");
    }

    #[test]
    fn filters_by_ext_and_kind() {
        let conn = open_in_memory().unwrap();
        insert(&conn, &f("/root/a.txt", "a.txt", Some("txt"), "file", 100), 1).unwrap();
        insert(&conn, &f("/root/a.md", "a.md", Some("md"), "file", 100), 1).unwrap();
        insert(&conn, &f("/root/sub", "sub", None, "dir", 100), 1).unwrap();
        let only_md = FileFilters {
            ext: Some("md".into()),
            ..Default::default()
        };
        let hits = search(&conn, "a", &only_md, 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].ext.as_deref(), Some("md"));

        let only_dirs = FileFilters {
            kind: Some("dir".into()),
            ..Default::default()
        };
        let dirs = search(&conn, "", &only_dirs, 50).unwrap();
        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0].kind, "dir");
    }

    #[test]
    fn clear_empties_index_and_fts() {
        let conn = open_in_memory().unwrap();
        insert(&conn, &f("/root/a.txt", "a.txt", Some("txt"), "file", 100), 1).unwrap();
        clear(&conn).unwrap();
        assert_eq!(count(&conn).unwrap(), 0);
        assert!(search(&conn, "a", &FileFilters::default(), 50).unwrap().is_empty());
    }

    #[test]
    fn search_query_is_quote_safe() {
        let conn = open_in_memory().unwrap();
        insert(&conn, &f("/root/wei\"rd.txt", "wei\"rd.txt", Some("txt"), "file", 100), 1).unwrap();
        // Must not error on FTS metacharacters.
        let _ = search(&conn, "wei\"rd", &FileFilters::default(), 50).unwrap();
    }
}
