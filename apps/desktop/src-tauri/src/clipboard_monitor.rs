//! Background clipboard monitor.
//!
//! Polls the OS clipboard for text changes (poll-based for portability) and
//! records new content into the local history with duplicate collapsing and a
//! retention cap. A lightweight heuristic flags likely secrets as `sensitive`
//! so the UI can mask them; password-manager exclusion lists come later.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::commands::AppState;

const POLL_INTERVAL: Duration = Duration::from_millis(700);
const RETENTION: i64 = 500;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Heuristic: a single token mixing ≥3 character classes looks like a secret.
fn looks_sensitive(s: &str) -> bool {
    let t = s.trim();
    if t.len() < 8 || t.len() > 64 || t.chars().any(char::is_whitespace) {
        return false;
    }
    let has_lower = t.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = t.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = t.chars().any(|c| c.is_ascii_digit());
    let has_symbol = t.chars().any(|c| !c.is_alphanumeric());
    (has_lower as u8 + has_upper as u8 + has_digit as u8 + has_symbol as u8) >= 3
}

fn read_clipboard_text() -> Option<String> {
    arboard::Clipboard::new().ok()?.get_text().ok()
}

/// Spawn the monitor thread. Errors are swallowed (clipboard may be temporarily
/// locked by another process); the loop simply tries again next tick.
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = String::new();
        loop {
            std::thread::sleep(POLL_INTERVAL);
            let Some(text) = read_clipboard_text() else {
                continue;
            };
            if text.is_empty() || text == last {
                continue;
            }
            last = text.clone();

            let Some(state) = app.try_state::<AppState>() else {
                continue;
            };
            let Ok(conn) = state.db.lock() else { continue };
            let sensitive = looks_sensitive(&text);
            if orbit_core::clipboard::insert_text(&conn, &text, None, sensitive, now_ms()).is_ok() {
                let _ = orbit_core::clipboard::prune(&conn, RETENTION);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::looks_sensitive;

    #[test]
    fn flags_passwordy_tokens() {
        assert!(looks_sensitive("Tr0ub4dor&3"));
        assert!(looks_sensitive("aB3$xY9zQ1"));
    }

    #[test]
    fn ignores_prose_and_short_tokens() {
        assert!(!looks_sensitive("the quick brown fox"));
        assert!(!looks_sensitive("hello"));
        assert!(!looks_sensitive("just-a-slug-here"));
    }
}
