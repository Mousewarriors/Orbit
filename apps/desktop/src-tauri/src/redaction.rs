//! Small native redaction helpers for diagnostics that may be shown in the UI,
//! copied into reports, or emitted as Tauri events.

const REDACTED: &str = "[redacted]";

fn token_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':' | b'/' | b'+' | b'=')
}

fn redact_after_markers(input: &str, markers: &[&str]) -> String {
    let mut out = input.to_string();
    for marker in markers {
        let marker_lower = marker.to_ascii_lowercase();
        let mut search_from = 0usize;
        loop {
            let lower = out.to_ascii_lowercase();
            let Some(rel) = lower[search_from..].find(&marker_lower) else {
                break;
            };
            let start = search_from + rel + marker.len();
            let bytes = out.as_bytes();
            let mut end = start;
            while end < bytes.len() && token_char(bytes[end]) {
                end += 1;
            }
            if end > start {
                out.replace_range(start..end, REDACTED);
                search_from = start + REDACTED.len();
            } else {
                search_from = start;
            }
        }
    }
    out
}

fn redact_quoted_values(input: &str, keys: &[&str]) -> String {
    let mut out = input.to_string();
    for key in keys {
        let quoted_key = format!("\"{key}\"");
        let key_lower = quoted_key.to_ascii_lowercase();
        let mut search_from = 0usize;
        loop {
            let lower = out.to_ascii_lowercase();
            let Some(rel) = lower[search_from..].find(&key_lower) else {
                break;
            };
            let key_start = search_from + rel;
            let mut i = key_start + quoted_key.len();
            let bytes = out.as_bytes();
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i >= bytes.len() || !matches!(bytes[i], b':' | b'=') {
                search_from = i;
                continue;
            }
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            let value_start = i;
            if i < bytes.len() && matches!(bytes[i], b'"' | b'\'') {
                let quote = bytes[i];
                i += 1;
                let secret_start = i;
                while i < bytes.len() && bytes[i] != quote {
                    i += 1;
                }
                if i > secret_start {
                    out.replace_range(secret_start..i, REDACTED);
                    search_from = secret_start + REDACTED.len();
                } else {
                    search_from = i.saturating_add(1);
                }
            } else {
                while i < bytes.len() && token_char(bytes[i]) {
                    i += 1;
                }
                if i > value_start {
                    out.replace_range(value_start..i, REDACTED);
                    search_from = value_start + REDACTED.len();
                } else {
                    search_from = i;
                }
            }
        }
    }
    out
}

fn redact_prefixed_tokens(input: &str, prefix: &str, min_len: usize) -> String {
    let mut out = input.to_string();
    let prefix_lower = prefix.to_ascii_lowercase();
    let mut search_from = 0usize;
    loop {
        let lower = out.to_ascii_lowercase();
        let Some(rel) = lower[search_from..].find(&prefix_lower) else {
            break;
        };
        let start = search_from + rel;
        let bytes = out.as_bytes();
        let mut end = start + prefix.len();
        while end < bytes.len() && token_char(bytes[end]) {
            end += 1;
        }
        if end - start >= min_len {
            out.replace_range(start..end, REDACTED);
            search_from = start + REDACTED.len();
        } else {
            search_from = end;
        }
    }
    out
}

fn redact_private_key_blocks(input: &str) -> String {
    let mut out = input.to_string();
    let mut search_from = 0usize;
    loop {
        let lower = out.to_ascii_lowercase();
        let Some(begin_rel) = lower[search_from..].find("-----begin ") else {
            break;
        };
        let begin = search_from + begin_rel;
        let Some(key_rel) = lower[begin..].find(" private key-----") else {
            break;
        };
        let end_search_from = begin + key_rel;
        let Some(end_rel) = lower[end_search_from..].find("-----end ") else {
            break;
        };
        let end_marker_start = end_search_from + end_rel;
        let Some(end_marker_rel) = lower[end_marker_start..].find(" private key-----") else {
            break;
        };
        let block_end = end_marker_start + end_marker_rel + " private key-----".len();
        out.replace_range(begin..block_end, REDACTED);
        search_from = begin + REDACTED.len();
    }
    out
}

/// Redact likely credentials from text before exposing diagnostics. This is a
/// defence-in-depth heuristic, not a parser for every possible secret format.
pub fn redact_secrets(input: &str) -> String {
    let out = redact_private_key_blocks(input);
    let out = redact_after_markers(
        &out,
        &[
            "authorization: bearer ",
            "bearer ",
            "api_key=",
            "api_key: ",
            "api_key:",
            "apikey=",
            "apikey: ",
            "apikey:",
            "api-key=",
            "api-key: ",
            "api-key:",
            "x-api-key=",
            "x-api-key: ",
            "x-api-key:",
            "token=",
            "password=",
            "passwd=",
            "secret=",
            "access_token=",
            "refresh_token=",
            "api key: ",
            "token: ",
            "password: ",
            "secret: ",
        ],
    );
    let out = redact_quoted_values(
        &out,
        &[
            "api_key",
            "apikey",
            "api-key",
            "token",
            "password",
            "passwd",
            "secret",
            "access_token",
            "refresh_token",
        ],
    );
    let out = redact_prefixed_tokens(&out, "sk-", 12);
    redact_prefixed_tokens(&out, "sk_ant_", 12)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_common_key_and_bearer_shapes() {
        let text = "Authorization: Bearer abc.def-123 token=tok_12345 api_key: key-123 x-api-key: xkey-456 sk-testsecret12345";
        let redacted = redact_secrets(text);
        assert!(!redacted.contains("abc.def-123"));
        assert!(!redacted.contains("tok_12345"));
        assert!(!redacted.contains("key-123"));
        assert!(!redacted.contains("xkey-456"));
        assert!(!redacted.contains("sk-testsecret12345"));
        assert!(redacted.contains(REDACTED));
    }

    #[test]
    fn redacts_private_key_blocks() {
        let text = "x -----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY----- y";
        let redacted = redact_secrets(text);
        assert!(!redacted.contains("secret"));
        assert!(redacted.contains(REDACTED));
    }

    #[test]
    fn redacts_multiple_private_key_blocks() {
        let text = "a -----BEGIN PRIVATE KEY-----\none\n-----END PRIVATE KEY----- b -----BEGIN RSA PRIVATE KEY-----\ntwo\n-----END RSA PRIVATE KEY----- c";
        let redacted = redact_secrets(text);
        assert!(!redacted.contains("one"));
        assert!(!redacted.contains("two"));
    }

    #[test]
    fn redacts_json_and_quoted_secret_fields() {
        let text = r#"{"access_token":"ya29.secret","api_key":"key-123","password" = "pw"}"#;
        let redacted = redact_secrets(text);
        assert!(!redacted.contains("ya29.secret"));
        assert!(!redacted.contains("key-123"));
        assert!(!redacted.contains("pw"));
        assert!(redacted.contains(REDACTED));
    }

    #[test]
    fn handles_non_ascii_diagnostics() {
        let redacted = redact_secrets("échec token=abc123 café");
        assert!(redacted.contains("échec"));
        assert!(!redacted.contains("abc123"));
    }

    #[test]
    fn leaves_normal_diagnostics_readable() {
        assert_eq!(
            redact_secrets("Relay ready on pid 42"),
            "Relay ready on pid 42"
        );
    }
}
