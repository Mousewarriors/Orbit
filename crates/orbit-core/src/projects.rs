//! Local project metadata — Orbit-owned enrichments layered on top of Relay's
//! project scanning. Relay is authoritative for discovery and agent compatibility;
//! Orbit persists user preferences (favourite, preferred agent, display name, etc.).

use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ProjectMeta {
    pub path: String,
    pub name: Option<String>,
    pub favourite: bool,
    pub last_opened_at: i64,
    pub preferred_agent: Option<String>,
    pub build_brief: Option<String>,
    pub docs_path: Option<String>,
    pub preview_url: Option<String>,
    pub studio_url: Option<String>,
    pub created_at: i64,
}

pub fn upsert(
    conn: &Connection,
    path: &str,
    name: Option<&str>,
    now_ms: i64,
) -> Result<ProjectMeta, rusqlite::Error> {
    conn.execute(
        "INSERT INTO project_meta (path, name, created_at, last_opened_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(path) DO UPDATE SET
           name = COALESCE(?2, name),
           last_opened_at = ?3",
        params![path, name, now_ms],
    )?;
    get(conn, path)?.ok_or_else(|| {
        rusqlite::Error::QueryReturnedNoRows
    })
}

pub fn get(conn: &Connection, path: &str) -> Result<Option<ProjectMeta>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT path, name, favourite, last_opened_at, preferred_agent,
                build_brief, docs_path, preview_url, studio_url, created_at
         FROM project_meta WHERE path = ?1",
    )?;
    let mut rows = stmt.query_map(params![path], row_to_meta)?;
    Ok(rows.next().transpose()?)
}

pub fn list_recent(
    conn: &Connection,
    limit: i64,
) -> Result<Vec<ProjectMeta>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT path, name, favourite, last_opened_at, preferred_agent,
                build_brief, docs_path, preview_url, studio_url, created_at
         FROM project_meta
         WHERE last_opened_at > 0
         ORDER BY last_opened_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], row_to_meta)?;
    rows.collect()
}

pub fn list_favourites(
    conn: &Connection,
) -> Result<Vec<ProjectMeta>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT path, name, favourite, last_opened_at, preferred_agent,
                build_brief, docs_path, preview_url, studio_url, created_at
         FROM project_meta
         WHERE favourite = 1
         ORDER BY last_opened_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_meta)?;
    rows.collect()
}

pub fn set_favourite(
    conn: &Connection,
    path: &str,
    favourite: bool,
    now_ms: i64,
) -> Result<(), rusqlite::Error> {
    // Ensure row exists before updating
    conn.execute(
        "INSERT INTO project_meta (path, favourite, created_at, last_opened_at)
         VALUES (?1, ?2, ?3, 0)
         ON CONFLICT(path) DO UPDATE SET favourite = ?2",
        params![path, favourite as i32, now_ms],
    )?;
    Ok(())
}

pub fn set_preferred_agent(
    conn: &Connection,
    path: &str,
    agent_id: Option<&str>,
    now_ms: i64,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO project_meta (path, preferred_agent, created_at, last_opened_at)
         VALUES (?1, ?2, ?3, 0)
         ON CONFLICT(path) DO UPDATE SET preferred_agent = ?2",
        params![path, agent_id, now_ms],
    )?;
    Ok(())
}

pub fn touch(
    conn: &Connection,
    path: &str,
    now_ms: i64,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO project_meta (path, last_opened_at, created_at)
         VALUES (?1, ?2, ?2)
         ON CONFLICT(path) DO UPDATE SET last_opened_at = ?2",
        params![path, now_ms],
    )?;
    Ok(())
}

fn row_to_meta(row: &rusqlite::Row) -> Result<ProjectMeta, rusqlite::Error> {
    Ok(ProjectMeta {
        path: row.get(0)?,
        name: row.get(1)?,
        favourite: row.get::<_, i32>(2)? != 0,
        last_opened_at: row.get(3)?,
        preferred_agent: row.get(4)?,
        build_brief: row.get(5)?,
        docs_path: row.get(6)?,
        preview_url: row.get(7)?,
        studio_url: row.get(8)?,
        created_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::open_in_memory;

    fn setup() -> Connection {
        let mut conn = open_in_memory().unwrap();
        crate::run_migrations(&mut conn).unwrap();
        conn
    }

    #[test]
    fn upsert_creates_and_updates() {
        let conn = setup();
        let meta = upsert(&conn, "/test/project", Some("Test"), 1000).unwrap();
        assert_eq!(meta.path, "/test/project");
        assert_eq!(meta.name.as_deref(), Some("Test"));
        assert_eq!(meta.last_opened_at, 1000);
        assert!(!meta.favourite);

        let meta2 = upsert(&conn, "/test/project", None, 2000).unwrap();
        assert_eq!(meta2.name.as_deref(), Some("Test"));
        assert_eq!(meta2.last_opened_at, 2000);
    }

    #[test]
    fn favourite_round_trip() {
        let conn = setup();
        upsert(&conn, "/a", Some("A"), 100).unwrap();
        set_favourite(&conn, "/a", true, 100).unwrap();
        let favs = list_favourites(&conn).unwrap();
        assert_eq!(favs.len(), 1);
        assert!(favs[0].favourite);

        set_favourite(&conn, "/a", false, 200).unwrap();
        assert!(list_favourites(&conn).unwrap().is_empty());
    }

    #[test]
    fn recent_projects_ordered_by_last_opened() {
        let conn = setup();
        upsert(&conn, "/old", Some("Old"), 100).unwrap();
        upsert(&conn, "/new", Some("New"), 200).unwrap();
        let recent = list_recent(&conn, 10).unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].path, "/new");
        assert_eq!(recent[1].path, "/old");
    }

    #[test]
    fn preferred_agent_persists() {
        let conn = setup();
        upsert(&conn, "/p", None, 100).unwrap();
        set_preferred_agent(&conn, "/p", Some("codex-cli"), 100).unwrap();
        let meta = get(&conn, "/p").unwrap().unwrap();
        assert_eq!(meta.preferred_agent.as_deref(), Some("codex-cli"));

        set_preferred_agent(&conn, "/p", None, 200).unwrap();
        let meta = get(&conn, "/p").unwrap().unwrap();
        assert!(meta.preferred_agent.is_none());
    }

    #[test]
    fn touch_updates_last_opened() {
        let conn = setup();
        upsert(&conn, "/t", None, 100).unwrap();
        touch(&conn, "/t", 500).unwrap();
        let meta = get(&conn, "/t").unwrap().unwrap();
        assert_eq!(meta.last_opened_at, 500);
    }
}
