//! Bounded capture of an extension's recent stderr output (pure).
//!
//! Extensions write structured diagnostics to stderr (stdout is reserved for the
//! one-shot protocol response). The host captures that stream per invocation and
//! keeps only the most recent tail so Settings can surface "recent logs" without
//! letting a chatty or malicious extension balloon memory. Trimming is done here,
//! in pure code, so it is unit-tested independently of the OS plumbing.

/// Hard cap on retained stderr bytes (keep the *tail* — most recent output).
pub const MAX_LOG_BYTES: usize = 4_000;
/// Hard cap on retained stderr lines (keep the *last* N).
pub const MAX_LOG_LINES: usize = 50;

/// Trim raw stderr to the most recent [`MAX_LOG_LINES`] lines and
/// [`MAX_LOG_BYTES`] bytes, returning `None` when there's nothing meaningful to
/// show (empty or whitespace-only). The result keeps the *end* of the stream
/// (the latest output) and is guaranteed to be valid UTF-8 on a char boundary.
pub fn bound_logs(raw: &str) -> Option<String> {
    if raw.trim().is_empty() {
        return None;
    }
    // Keep the last N non-trailing-empty lines.
    let mut lines: Vec<&str> = raw.lines().collect();
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    if lines.len() > MAX_LOG_LINES {
        lines = lines.split_off(lines.len() - MAX_LOG_LINES);
    }
    let mut out = lines.join("\n");

    // Then bound by bytes, trimming from the front and snapping to a char
    // boundary so we never split a multi-byte sequence.
    if out.len() > MAX_LOG_BYTES {
        let mut start = out.len() - MAX_LOG_BYTES;
        while start < out.len() && !out.is_char_boundary(start) {
            start += 1;
        }
        out = out[start..].to_string();
    }

    let trimmed = out.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_or_blank_yields_none() {
        assert_eq!(bound_logs(""), None);
        assert_eq!(bound_logs("   \n\t \n"), None);
    }

    #[test]
    fn short_output_passes_through_trimmed() {
        assert_eq!(bound_logs("hello\nworld\n"), Some("hello\nworld".to_string()));
    }

    #[test]
    fn keeps_only_the_last_lines() {
        let raw: String = (0..200).map(|i| format!("line {i}\n")).collect();
        let out = bound_logs(&raw).expect("non-empty");
        let kept: Vec<&str> = out.lines().collect();
        assert_eq!(kept.len(), MAX_LOG_LINES);
        // The very last produced line must be retained; the first must be dropped.
        assert_eq!(*kept.last().unwrap(), "line 199");
        assert!(!out.contains("line 0\n"));
    }

    #[test]
    fn bounds_total_bytes_to_the_tail() {
        // One enormous single line that blows the byte budget but not the line cap.
        let raw = "x".repeat(MAX_LOG_BYTES * 3);
        let out = bound_logs(&raw).expect("non-empty");
        assert!(out.len() <= MAX_LOG_BYTES);
        // It's the tail we keep, so still all 'x'.
        assert!(out.chars().all(|c| c == 'x'));
    }

    #[test]
    fn surfaces_structured_sdk_stderr_lines() {
        // The SDK writes structured JSON diagnostics to stderr (stdout is the
        // protocol channel). The capture path must surface those lines verbatim.
        let raw = concat!(
            r#"{"ts":"2026-06-15T15:34:02.349Z","level":"error","msg":"handler-threw","fields":{"command":"boom"}}"#,
            "\n",
            r#"{"ts":"2026-06-15T15:34:02.350Z","level":"warn","msg":"slow-handler"}"#,
            "\n",
        );
        let out = bound_logs(raw).expect("non-empty");
        assert!(out.contains("handler-threw"));
        assert!(out.contains("slow-handler"));
        assert_eq!(out.lines().count(), 2);
    }

    #[test]
    fn never_splits_a_multibyte_char() {
        // Fill just past the byte cap with 3-byte chars; trimming must land on a
        // char boundary (no panic, valid UTF-8).
        let raw = "✓".repeat(MAX_LOG_BYTES); // 3 bytes each → well over the cap
        let out = bound_logs(&raw).expect("non-empty");
        assert!(out.len() <= MAX_LOG_BYTES);
        assert!(out.chars().all(|c| c == '✓'));
    }
}
