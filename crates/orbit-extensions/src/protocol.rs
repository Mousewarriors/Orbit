//! Versioned, schema-validated RPC protocol between the host and an extension
//! child process (one-shot request on stdin → response on stdout).
//!
//! The host writes an [`InvokeRequest`] (with the extension's storage snapshot),
//! the child returns an [`InvokeResponse`] carrying list items, brokered effects
//! and storage writes. Both carry the protocol version `v`; a mismatch is
//! rejected so an incompatible extension can never be driven by surprise.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Current protocol version. Bump on any breaking shape change.
pub const PROTOCOL_VERSION: u32 = 1;

/// A declarative, brokered effect an extension asks the host to perform.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Effect {
    OpenUrl { url: String },
    Copy { text: String },
    OpenPath { path: String },
}

/// A list item returned by a `list` command.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ResponseItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    /// Optional action run when the item is selected (brokered like any effect).
    #[serde(default)]
    pub action: Option<Effect>,
}

/// Request sent to the extension on stdin.
#[derive(Debug, Clone, Serialize)]
pub struct InvokeRequest {
    pub v: u32,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub command: String,
    pub query: String,
    pub storage: HashMap<String, String>,
}

impl InvokeRequest {
    pub fn new(command: impl Into<String>, query: impl Into<String>, storage: HashMap<String, String>) -> Self {
        InvokeRequest {
            v: PROTOCOL_VERSION,
            kind: "invoke",
            command: command.into(),
            query: query.into(),
            storage,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Response received from the extension on stdout.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type")]
pub enum InvokeResponse {
    #[serde(rename = "result")]
    Result {
        #[serde(default)]
        v: u32,
        #[serde(default)]
        items: Vec<ResponseItem>,
        #[serde(default)]
        effects: Vec<Effect>,
        #[serde(default, rename = "storageWrites")]
        storage_writes: HashMap<String, String>,
        #[serde(default)]
        toast: Option<String>,
    },
    #[serde(rename = "error")]
    Error {
        #[serde(default)]
        v: u32,
        message: String,
    },
}

impl InvokeResponse {
    pub fn version(&self) -> u32 {
        match self {
            InvokeResponse::Result { v, .. } => *v,
            InvokeResponse::Error { v, .. } => *v,
        }
    }
}

/// Parse + version-check a response. Returns the typed response or an error
/// message (malformed JSON, wrong shape, or protocol-version mismatch).
pub fn parse_response(text: &str) -> Result<InvokeResponse, String> {
    let resp: InvokeResponse =
        serde_json::from_str(text.trim()).map_err(|e| format!("invalid response: {e}"))?;
    if resp.version() != PROTOCOL_VERSION {
        return Err(format!(
            "protocol version mismatch: extension sent v{}, host expects v{}",
            resp.version(),
            PROTOCOL_VERSION
        ));
    }
    Ok(resp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_serialises_with_type_and_version() {
        let req = InvokeRequest::new("gen", "hi", HashMap::new());
        let json = req.to_json();
        assert!(json.contains("\"type\":\"invoke\""));
        assert!(json.contains("\"v\":1"));
        assert!(json.contains("\"command\":\"gen\""));
    }

    #[test]
    fn parses_result_with_items_and_effects() {
        let json = r#"{"v":1,"type":"result",
            "items":[{"id":"a","title":"A","action":{"kind":"copy","text":"x"}}],
            "effects":[{"kind":"open-url","url":"https://x"}],
            "storageWrites":{"k":"v"}}"#;
        let r = parse_response(json).unwrap();
        match r {
            InvokeResponse::Result { items, effects, storage_writes, .. } => {
                assert_eq!(items.len(), 1);
                assert_eq!(items[0].action, Some(Effect::Copy { text: "x".into() }));
                assert_eq!(effects[0], Effect::OpenUrl { url: "https://x".into() });
                assert_eq!(storage_writes.get("k").map(String::as_str), Some("v"));
            }
            _ => panic!("expected result"),
        }
    }

    #[test]
    fn parses_error_variant() {
        let r = parse_response(r#"{"v":1,"type":"error","message":"boom"}"#).unwrap();
        assert!(matches!(r, InvokeResponse::Error { .. }));
    }

    #[test]
    fn rejects_version_mismatch() {
        let err = parse_response(r#"{"v":2,"type":"result"}"#).unwrap_err();
        assert!(err.contains("version mismatch"));
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse_response("not json").is_err());
    }

    #[test]
    fn effect_kebab_case_roundtrip() {
        let e = Effect::OpenPath { path: "/tmp/x".into() };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"kind\":\"open-path\""));
    }
}
