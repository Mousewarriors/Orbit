//! External Orbit command ingestion.
//!
//! This is the narrow native boundary used by PowerShell / OS launches. A
//! second process may pass a natural-language request to the already-running
//! app, but the native side only extracts a plain query string. The renderer
//! still resolves that query through the normal audited search/action pipeline.

use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_QUERY_LEN: usize = 2_000;
const QUERY_FLAGS: &[&str] = &["--orbit-query", "--orbit-command", "--orbit-do"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedOrbitCommand {
    pub query: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbitCommandPayload {
    pub query: String,
    pub source: String,
    pub received_at_ms: i64,
}

impl From<ParsedOrbitCommand> for OrbitCommandPayload {
    fn from(value: ParsedOrbitCommand) -> Self {
        Self {
            query: value.query,
            source: value.source,
            received_at_ms: now_ms(),
        }
    }
}

pub fn parse_orbit_command_args(argv: &[String]) -> Option<ParsedOrbitCommand> {
    for (idx, arg) in argv.iter().enumerate() {
        for flag in QUERY_FLAGS {
            if arg == flag {
                if let Some(query) = argv.get(idx + 1).and_then(|s| clean_query(s)) {
                    return Some(ParsedOrbitCommand {
                        query,
                        source: "argv".into(),
                    });
                }
            }

            if let Some(raw) = arg.strip_prefix(&format!("{flag}=")) {
                if let Some(query) = clean_query(raw) {
                    return Some(ParsedOrbitCommand {
                        query,
                        source: "argv".into(),
                    });
                }
            }
        }

        if let Some(query) = parse_orbit_uri(arg) {
            return Some(ParsedOrbitCommand {
                query,
                source: "protocol".into(),
            });
        }
    }
    None
}

fn clean_query(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_QUERY_LEN {
        return None;
    }
    Some(trimmed.to_string())
}

fn parse_orbit_uri(raw: &str) -> Option<String> {
    let rest = raw.strip_prefix("orbit://")?;
    let without_fragment = rest.split('#').next().unwrap_or(rest);
    let (path, query) = without_fragment
        .split_once('?')
        .map_or((without_fragment, ""), |(p, q)| (p, q));

    if !query.is_empty() {
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            let key = percent_decode(key, true);
            if matches!(key.as_str(), "q" | "query" | "text" | "command") {
                if let Some(decoded) = clean_query(&percent_decode(value, true)) {
                    return Some(decoded);
                }
            }
        }
    }

    // Accept `orbit://run/<encoded sentence>` and
    // `orbit://command/<encoded sentence>` as a friendly OS-protocol form.
    let mut segments = path.split('/').filter(|part| !part.is_empty());
    let first = segments.next()?;
    if matches!(first, "run" | "command" | "query") {
        let joined = segments.collect::<Vec<_>>().join(" ");
        if !joined.is_empty() {
            return clean_query(&percent_decode(&joined, true));
        }
    }

    None
}

fn percent_decode(input: &str, plus_as_space: bool) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if plus_as_space && bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_orbit_query_flag_with_next_argument() {
        let parsed = parse_orbit_command_args(&args(&[
            "orbit-desktop.exe",
            "--orbit-query",
            "load up the convention map in paint",
        ]))
        .expect("parsed");
        assert_eq!(parsed.query, "load up the convention map in paint");
        assert_eq!(parsed.source, "argv");
    }

    #[test]
    fn parses_orbit_query_equals_form() {
        let parsed = parse_orbit_command_args(&args(&[
            "orbit-desktop.exe",
            "--orbit-query=find the congregation accounts instructions for KHT",
        ]))
        .expect("parsed");
        assert_eq!(
            parsed.query,
            "find the congregation accounts instructions for KHT"
        );
    }

    #[test]
    fn parses_protocol_query_parameter() {
        let parsed =
            parse_orbit_command_args(&args(&["orbit://command?query=load+up+map+in+paint"]))
                .expect("parsed");
        assert_eq!(parsed.query, "load up map in paint");
        assert_eq!(parsed.source, "protocol");
    }

    #[test]
    fn parses_protocol_path_form() {
        let parsed = parse_orbit_command_args(&args(&["orbit://run/load%20up%20map%20in%20paint"]))
            .expect("parsed");
        assert_eq!(parsed.query, "load up map in paint");
    }

    #[test]
    fn parses_protocol_path_form_with_plus_spaces_for_agent_launch() {
        let parsed = parse_orbit_command_args(&args(&[
            "orbit://run/agent%3A+launch+an+agent+on+Orbit",
        ]))
        .expect("parsed");
        assert_eq!(parsed.query, "agent: launch an agent on Orbit");
        assert_eq!(parsed.source, "protocol");
    }

    #[test]
    fn ignores_empty_and_overlong_queries() {
        assert!(parse_orbit_command_args(&args(&["--orbit-query", "   "])).is_none());
        assert!(parse_orbit_command_args(&args(&[
            "--orbit-query",
            &"x".repeat(MAX_QUERY_LEN + 1),
        ]))
        .is_none());
    }
}
