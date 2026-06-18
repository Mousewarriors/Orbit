//! Forward-only schema migrations driven by SQLite's `user_version` pragma.
//!
//! Each migration is an idempotent-on-fresh SQL script applied in order. The
//! current schema version is stored in `user_version`; on startup we apply every
//! migration whose index is greater than the stored version, inside a single
//! transaction per migration so a failure leaves the database on the last good
//! version. Data is therefore preserved across app updates.

use rusqlite::Connection;

/// Ordered list of migrations. NEVER reorder or edit a shipped migration —
/// append a new one. Index 0 → user_version 1, etc.
pub const MIGRATIONS: &[&str] = &[
    // 0001 — foundational tables for the Phase 1 vertical slice.
    r#"
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
    );

    CREATE TABLE commands (
        id        TEXT PRIMARY KEY NOT NULL,
        title     TEXT NOT NULL,
        subtitle  TEXT,
        category  TEXT NOT NULL,
        mode      TEXT NOT NULL,
        source    TEXT NOT NULL,
        enabled   INTEGER NOT NULL DEFAULT 1
    );

    -- Customisations & usage are keyed by LOGICAL command id. Built-in and
    -- extension commands are defined in code and may not have a row in
    -- `commands`, so these intentionally have no foreign key to it.
    CREATE TABLE command_customisations (
        command_id TEXT PRIMARY KEY NOT NULL,
        alias      TEXT,
        hotkey     TEXT,
        favourite  INTEGER NOT NULL DEFAULT 0,
        pinned     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE command_usage (
        command_id   TEXT PRIMARY KEY NOT NULL,
        use_count    INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_usage_last_used ON command_usage(last_used_at DESC);

    CREATE TABLE applications (
        id          TEXT PRIMARY KEY NOT NULL,
        name        TEXT NOT NULL,
        path        TEXT NOT NULL,
        icon_path   TEXT,
        kind        TEXT NOT NULL DEFAULT 'app',
        indexed_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_apps_name ON applications(name);
    "#,
    // 0002 — clipboard history with sensitivity flag and source app.
    r#"
    CREATE TABLE clipboard_entries (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        kind         TEXT NOT NULL,           -- text | rtf | url | color | image | files | html
        content      TEXT,                    -- text payload or path reference
        preview      TEXT,
        source_app   TEXT,
        sensitive    INTEGER NOT NULL DEFAULT 0,
        pinned       INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL,
        hash         TEXT                     -- for duplicate collapsing
    );
    CREATE INDEX idx_clip_created ON clipboard_entries(created_at DESC);
    CREATE UNIQUE INDEX idx_clip_hash ON clipboard_entries(hash) WHERE hash IS NOT NULL;
    "#,
    // 0003 — snippets and quicklinks with full-text search over snippet bodies.
    r#"
    CREATE TABLE snippets (
        id          TEXT PRIMARY KEY NOT NULL,
        name        TEXT NOT NULL,
        keyword     TEXT,
        content     TEXT NOT NULL,
        description TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        use_count   INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_snippets_keyword ON snippets(keyword);

    CREATE VIRTUAL TABLE snippets_fts USING fts5(
        name, content, description, content='snippets', content_rowid='rowid'
    );

    CREATE TABLE quicklinks (
        id          TEXT PRIMARY KEY NOT NULL,
        title       TEXT NOT NULL,
        target      TEXT NOT NULL,
        icon        TEXT,
        alias       TEXT,
        hotkey      TEXT,
        browser     TEXT,
        pinned      INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
    );
    "#,
    // 0004 — local file index with full-text search over name + path. The path
    // is the natural key; an external-content FTS table mirrors name/path for
    // fast prefix search. Content is NOT indexed here (metadata only).
    r#"
    CREATE TABLE files (
        path        TEXT PRIMARY KEY NOT NULL,
        name        TEXT NOT NULL,
        parent      TEXT NOT NULL,
        ext         TEXT,                    -- lowercased, no dot; NULL for none/dirs
        kind        TEXT NOT NULL,           -- 'file' | 'dir'
        size        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER,                 -- ms; NULL where the OS can't report it
        modified_at INTEGER NOT NULL DEFAULT 0,
        indexed_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_files_modified ON files(modified_at DESC);
    CREATE INDEX idx_files_ext ON files(ext);
    CREATE INDEX idx_files_kind ON files(kind);

    CREATE VIRTUAL TABLE files_fts USING fts5(
        name, path, content='files', content_rowid='rowid'
    );
    "#,
    // 0005 — local notes with full-text search over title + body.
    r#"
    CREATE TABLE notes (
        id          TEXT PRIMARY KEY NOT NULL,
        title       TEXT NOT NULL DEFAULT '',
        body        TEXT NOT NULL DEFAULT '',
        pinned      INTEGER NOT NULL DEFAULT 0,
        archived    INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_notes_updated ON notes(updated_at DESC);

    CREATE VIRTUAL TABLE notes_fts USING fts5(
        title, body, content='notes', content_rowid='rowid'
    );
    "#,
    // 0006 — per-extension namespaced key/value storage. The (ext_id, key) pair
    // is the natural key; values are opaque strings owned by the extension. The
    // native broker is the only writer, so an extension can never read or write
    // another extension's namespace.
    r#"
    CREATE TABLE extension_storage (
        ext_id     TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (ext_id, key)
    );

    CREATE TABLE extension_state (
        ext_id     TEXT PRIMARY KEY NOT NULL,
        enabled    INTEGER NOT NULL DEFAULT 1
    );
    "#,
    // 0007 — OPTIONAL file-content index (off by default). A standalone FTS5
    // table keyed by path, populated only when the user enables content indexing.
    // Kept separate from `files_fts` so the always-on metadata search is
    // unaffected, and cleared wholesale on each rebuild (so no per-row FTS delete
    // dance is needed — paths are unique within a rebuild).
    r#"
    CREATE VIRTUAL TABLE files_content_fts USING fts5(path UNINDEXED, content);
    "#,
    // 0008 — Local project metadata for the Control Center. Relay owns project
    // scanning and discovery; Orbit persists user-owned enrichments (favourite,
    // preferred agent, last opened, display name override). The path is the
    // natural key, matching Relay's project identity.
    r#"
    CREATE TABLE project_meta (
        path            TEXT PRIMARY KEY NOT NULL,
        name            TEXT,
        favourite       INTEGER NOT NULL DEFAULT 0,
        last_opened_at  INTEGER NOT NULL DEFAULT 0,
        preferred_agent TEXT,
        build_brief     TEXT,
        docs_path       TEXT,
        preview_url     TEXT,
        studio_url      TEXT,
        created_at      INTEGER NOT NULL
    );
    CREATE INDEX idx_project_meta_last_opened ON project_meta(last_opened_at DESC);
    CREATE INDEX idx_project_meta_favourite ON project_meta(favourite) WHERE favourite = 1;
    "#,
    // 0009 — persistent AI Chat: conversations and their messages. A message's
    // `seq` orders it within a chat (so regenerate/edit can drop everything from
    // a point forward); `parent_chat_id` records a branch origin. Messages are
    // deleted with their chat (enforced in code — no cross-table FK so the schema
    // matches the rest of the app's code-defined-id convention).
    r#"
    CREATE TABLE chats (
        id             TEXT PRIMARY KEY NOT NULL,
        title          TEXT NOT NULL DEFAULT '',
        pinned         INTEGER NOT NULL DEFAULT 0,
        archived       INTEGER NOT NULL DEFAULT 0,
        model          TEXT,
        parent_chat_id TEXT,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
    );
    CREATE INDEX idx_chats_updated ON chats(updated_at DESC);

    CREATE TABLE chat_messages (
        id         TEXT PRIMARY KEY NOT NULL,
        chat_id    TEXT NOT NULL,
        role       TEXT NOT NULL,        -- 'user' | 'assistant' | 'system'
        content    TEXT NOT NULL,
        model      TEXT,
        seq        INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_chat_messages_chat ON chat_messages(chat_id, seq);
    "#,
];

#[derive(Debug, thiserror::Error)]
pub enum MigrationError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// Current schema version (number of migrations).
pub fn target_version() -> i64 {
    MIGRATIONS.len() as i64
}

/// Read the database's current schema version from `user_version`.
pub fn current_version(conn: &Connection) -> Result<i64, MigrationError> {
    let v: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    Ok(v)
}

/// Apply all pending migrations. Returns the number applied.
pub fn run(conn: &mut Connection) -> Result<usize, MigrationError> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let from = current_version(conn)?;
    let to = target_version();
    let mut applied = 0;
    for version in from..to {
        let sql = MIGRATIONS[version as usize];
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        // user_version cannot be parameterised; value is a trusted integer.
        tx.execute_batch(&format!("PRAGMA user_version = {};", version + 1))?;
        tx.commit()?;
        applied += 1;
    }
    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_all_migrations_on_fresh_db() {
        let mut conn = Connection::open_in_memory().unwrap();
        let applied = run(&mut conn).unwrap();
        assert_eq!(applied, MIGRATIONS.len());
        assert_eq!(current_version(&conn).unwrap(), target_version());
    }

    #[test]
    fn is_idempotent_when_run_twice() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();
        let second = run(&mut conn).unwrap();
        assert_eq!(second, 0, "no migrations should reapply");
    }

    #[test]
    fn expected_tables_exist() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();
        for table in [
            "settings",
            "commands",
            "clipboard_entries",
            "snippets",
            "quicklinks",
            "files",
            "notes",
            "extension_storage",
            "project_meta",
            "chats",
            "chat_messages",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "table {table} should exist");
        }
    }
}
