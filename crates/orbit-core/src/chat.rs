//! AI Chat data access — persistent conversations and their messages.
//!
//! A chat is a titled conversation; messages are ordered within it by a
//! monotonic `seq` so a regenerate/edit can drop everything from a point
//! forward, and a branch can copy a prefix into a new chat. There is no
//! cross-table foreign key (matching the app's code-defined-id convention);
//! deleting a chat removes its messages explicitly.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::DbError;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Chat {
    pub id: String,
    pub title: String,
    pub pinned: bool,
    pub archived: bool,
    pub model: Option<String>,
    pub parent_chat_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ChatMessage {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub content: String,
    pub model: Option<String>,
    pub seq: i64,
    pub created_at: i64,
}

const CHAT_COLS: &str = "id, title, pinned, archived, model, parent_chat_id, created_at, updated_at";
const MSG_COLS: &str = "id, chat_id, role, content, model, seq, created_at";

fn row_to_chat(row: &rusqlite::Row<'_>) -> rusqlite::Result<Chat> {
    Ok(Chat {
        id: row.get(0)?,
        title: row.get(1)?,
        pinned: row.get::<_, i64>(2)? != 0,
        archived: row.get::<_, i64>(3)? != 0,
        model: row.get(4)?,
        parent_chat_id: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn row_to_msg(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: row.get(0)?,
        chat_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        model: row.get(4)?,
        seq: row.get(5)?,
        created_at: row.get(6)?,
    })
}

pub fn create_chat(conn: &Connection, id: &str, title: &str, at: i64) -> Result<Chat, DbError> {
    conn.execute(
        "INSERT INTO chats(id, title, created_at, updated_at) VALUES(?1, ?2, ?3, ?3)",
        params![id, title, at],
    )?;
    get_chat(conn, id)?.ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
}

pub fn get_chat(conn: &Connection, id: &str) -> Result<Option<Chat>, DbError> {
    let sql = format!("SELECT {CHAT_COLS} FROM chats WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(row) => Ok(Some(row_to_chat(row)?)),
        None => Ok(None),
    }
}

/// List chats (excluding archived). Empty query → pinned-then-recent; otherwise
/// a case-insensitive title substring match.
pub fn list_chats(conn: &Connection, query: &str, limit: i64) -> Result<Vec<Chat>, DbError> {
    let q = query.trim();
    let mut out = Vec::new();
    if q.is_empty() {
        let sql = format!(
            "SELECT {CHAT_COLS} FROM chats WHERE archived = 0
             ORDER BY pinned DESC, updated_at DESC LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([limit], row_to_chat)?;
        for r in rows {
            out.push(r?);
        }
    } else {
        let like = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
        let sql = format!(
            "SELECT {CHAT_COLS} FROM chats WHERE archived = 0 AND title LIKE ?1 ESCAPE '\\'
             ORDER BY pinned DESC, updated_at DESC LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![like, limit], row_to_chat)?;
        for r in rows {
            out.push(r?);
        }
    }
    Ok(out)
}

pub fn rename_chat(conn: &Connection, id: &str, title: &str, at: i64) -> Result<(), DbError> {
    conn.execute(
        "UPDATE chats SET title = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, title, at],
    )?;
    Ok(())
}

pub fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> Result<(), DbError> {
    conn.execute(
        "UPDATE chats SET pinned = ?2 WHERE id = ?1",
        params![id, pinned as i64],
    )?;
    Ok(())
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool) -> Result<(), DbError> {
    conn.execute(
        "UPDATE chats SET archived = ?2 WHERE id = ?1",
        params![id, archived as i64],
    )?;
    Ok(())
}

pub fn delete_chat(conn: &Connection, id: &str) -> Result<(), DbError> {
    conn.execute("DELETE FROM chat_messages WHERE chat_id = ?1", [id])?;
    conn.execute("DELETE FROM chats WHERE id = ?1", [id])?;
    Ok(())
}

fn next_seq(conn: &Connection, chat_id: &str) -> Result<i64, DbError> {
    let max: Option<i64> = conn.query_row(
        "SELECT MAX(seq) FROM chat_messages WHERE chat_id = ?1",
        [chat_id],
        |r| r.get(0),
    )?;
    Ok(max.map(|m| m + 1).unwrap_or(0))
}

pub fn add_message(
    conn: &Connection,
    id: &str,
    chat_id: &str,
    role: &str,
    content: &str,
    model: Option<&str>,
    at: i64,
) -> Result<ChatMessage, DbError> {
    let seq = next_seq(conn, chat_id)?;
    conn.execute(
        "INSERT INTO chat_messages(id, chat_id, role, content, model, seq, created_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, chat_id, role, content, model, seq, at],
    )?;
    conn.execute(
        "UPDATE chats SET updated_at = ?2 WHERE id = ?1",
        params![chat_id, at],
    )?;
    let sql = format!("SELECT {MSG_COLS} FROM chat_messages WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(row) => Ok(row_to_msg(row)?),
        None => Err(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows)),
    }
}

pub fn list_messages(conn: &Connection, chat_id: &str) -> Result<Vec<ChatMessage>, DbError> {
    let sql = format!("SELECT {MSG_COLS} FROM chat_messages WHERE chat_id = ?1 ORDER BY seq ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([chat_id], row_to_msg)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Delete every message in a chat with `seq >= from_seq` (used by regenerate /
/// edit-and-resend, which drop the tail and re-generate it).
pub fn delete_messages_from(conn: &Connection, chat_id: &str, from_seq: i64) -> Result<(), DbError> {
    conn.execute(
        "DELETE FROM chat_messages WHERE chat_id = ?1 AND seq >= ?2",
        params![chat_id, from_seq],
    )?;
    Ok(())
}

/// Branch: create a new chat copying every message of `from_chat` with
/// `seq <= upto_seq`. Returns the new chat. Message ids are derived from the new
/// chat id + original seq so they stay unique.
pub fn branch_chat(
    conn: &Connection,
    new_id: &str,
    from_chat: &str,
    upto_seq: i64,
    title: &str,
    at: i64,
) -> Result<Chat, DbError> {
    conn.execute(
        "INSERT INTO chats(id, title, parent_chat_id, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?4)",
        params![new_id, title, from_chat, at],
    )?;
    let src = list_messages(conn, from_chat)?;
    for m in src.iter().filter(|m| m.seq <= upto_seq) {
        conn.execute(
            "INSERT INTO chat_messages(id, chat_id, role, content, model, seq, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                format!("{new_id}:{}", m.seq),
                new_id,
                m.role,
                m.content,
                m.model,
                m.seq,
                at
            ],
        )?;
    }
    get_chat(conn, new_id)?.ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn create_list_and_messages_round_trip() {
        let conn = open_in_memory().unwrap();
        create_chat(&conn, "c1", "First chat", 100).unwrap();
        add_message(&conn, "m1", "c1", "user", "hello", None, 110).unwrap();
        let a = add_message(&conn, "m2", "c1", "assistant", "hi there", Some("llama3.1"), 120).unwrap();
        assert_eq!(a.seq, 1);
        let msgs = list_messages(&conn, "c1").unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].content, "hello");
        assert_eq!(msgs[1].model.as_deref(), Some("llama3.1"));
        // updated_at advances with the latest message.
        assert_eq!(get_chat(&conn, "c1").unwrap().unwrap().updated_at, 120);
    }

    #[test]
    fn list_orders_pinned_then_recent_and_searches_title() {
        let conn = open_in_memory().unwrap();
        create_chat(&conn, "a", "Rust questions", 100).unwrap();
        create_chat(&conn, "b", "Dinner ideas", 200).unwrap();
        set_pinned(&conn, "a", true).unwrap();
        assert_eq!(list_chats(&conn, "", 50).unwrap()[0].id, "a");
        let found = list_chats(&conn, "dinner", 50).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "b");
    }

    #[test]
    fn delete_from_drops_the_tail() {
        let conn = open_in_memory().unwrap();
        create_chat(&conn, "c", "x", 100).unwrap();
        add_message(&conn, "m0", "c", "user", "q1", None, 1).unwrap();
        add_message(&conn, "m1", "c", "assistant", "a1", None, 2).unwrap();
        add_message(&conn, "m2", "c", "user", "q2", None, 3).unwrap();
        // Drop everything from seq 1 onward (keep only the first message).
        delete_messages_from(&conn, "c", 1).unwrap();
        let msgs = list_messages(&conn, "c").unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "q1");
        // A new message reuses seq 1 (max+1 of the remaining).
        let next = add_message(&conn, "m3", "c", "assistant", "a1b", None, 4).unwrap();
        assert_eq!(next.seq, 1);
    }

    #[test]
    fn delete_chat_removes_messages() {
        let conn = open_in_memory().unwrap();
        create_chat(&conn, "c", "x", 1).unwrap();
        add_message(&conn, "m", "c", "user", "hi", None, 2).unwrap();
        delete_chat(&conn, "c").unwrap();
        assert!(get_chat(&conn, "c").unwrap().is_none());
        assert!(list_messages(&conn, "c").unwrap().is_empty());
    }

    #[test]
    fn branch_copies_prefix_and_records_parent() {
        let conn = open_in_memory().unwrap();
        create_chat(&conn, "c", "orig", 1).unwrap();
        add_message(&conn, "m0", "c", "user", "q1", None, 1).unwrap();
        add_message(&conn, "m1", "c", "assistant", "a1", None, 2).unwrap();
        add_message(&conn, "m2", "c", "user", "q2", None, 3).unwrap();
        let branch = branch_chat(&conn, "c2", "c", 1, "branched", 10).unwrap();
        assert_eq!(branch.parent_chat_id.as_deref(), Some("c"));
        let msgs = list_messages(&conn, "c2").unwrap();
        assert_eq!(msgs.len(), 2); // seq 0 and 1 only
        assert_eq!(msgs[1].content, "a1");
    }

    #[test]
    fn archived_hidden_but_recoverable() {
        let conn = open_in_memory().unwrap();
        create_chat(&conn, "c", "x", 1).unwrap();
        set_archived(&conn, "c", true).unwrap();
        assert!(list_chats(&conn, "", 50).unwrap().is_empty());
        set_archived(&conn, "c", false).unwrap();
        assert_eq!(list_chats(&conn, "", 50).unwrap().len(), 1);
    }
}
