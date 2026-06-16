//! Orbit Relay JSON-RPC 2.0 protocol helpers.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const REQUIRED_METHODS: &[&str] = &[
    "relay.health",
    "relay.capabilities",
    "agents.list",
    "agents.get",
    "projects.scan",
    "projects.inspect",
    "launch.plan",
    "launch.execute",
    "sessions.list",
    "sessions.get",
    "sessions.stop",
    "handoffs.create",
    "handoffs.validate",
    "events.list",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayReady {
    pub implementation_version: String,
    pub protocol_version: String,
    pub minimum_client_protocol_version: String,
    pub protocol_compatibility_range: Option<String>,
    pub max_request_line_bytes: Option<usize>,
    #[serde(default)]
    pub methods: Vec<String>,
    #[serde(default)]
    pub notifications: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RelayErrorPayload {
    pub code: i64,
    pub name: String,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: &'static str,
    pub id: String,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RelayFrame {
    Notification {
        method: String,
        params: Option<Value>,
    },
    Success {
        id: Value,
        result: Value,
    },
    Failure {
        id: Value,
        error: RelayErrorPayload,
    },
}

#[derive(Debug, Deserialize)]
struct IncomingFrame {
    jsonrpc: Option<String>,
    id: Option<Value>,
    method: Option<String>,
    params: Option<Value>,
    result: Option<Value>,
    error: Option<RelayErrorPayload>,
}

pub fn parse_frame(line: &str) -> Result<RelayFrame, String> {
    let frame: IncomingFrame =
        serde_json::from_str(line).map_err(|e| format!("invalid JSON on Relay stdout: {e}"))?;
    if frame.jsonrpc.as_deref() != Some("2.0") {
        return Err("Relay stdout frame is missing jsonrpc 2.0".into());
    }
    if let Some(method) = frame.method {
        if frame.id.is_some() {
            return Err("Relay notification must not include an id".into());
        }
        return Ok(RelayFrame::Notification {
            method,
            params: frame.params,
        });
    }
    let Some(id) = frame.id else {
        return Err("Relay response is missing id".into());
    };
    if let Some(error) = frame.error {
        return Ok(RelayFrame::Failure { id, error });
    }
    if let Some(result) = frame.result {
        return Ok(RelayFrame::Success { id, result });
    }
    Err("Relay response has neither result nor error".into())
}

pub fn id_key(id: &Value) -> String {
    match id {
        Value::String(value) => value.clone(),
        _ => serde_json::to_string(id).unwrap_or_else(|_| "null".to_string()),
    }
}

pub fn is_protocol_compatible(protocol_version: &str) -> bool {
    protocol_version.split('.').next() == Some("1")
}

pub fn missing_required_methods(methods: &[String]) -> Vec<String> {
    REQUIRED_METHODS
        .iter()
        .filter(|method| !methods.iter().any(|item| item == **method))
        .map(|method| (*method).to_string())
        .collect()
}

pub fn validate_ready(value: Option<Value>) -> Result<RelayReady, String> {
    let Some(value) = value else {
        return Err("relay.ready params are missing".into());
    };
    let ready: RelayReady = serde_json::from_value(value)
        .map_err(|e| format!("relay.ready params are invalid: {e}"))?;
    if ready.implementation_version.trim().is_empty() {
        return Err("relay.ready is missing implementationVersion".into());
    }
    if ready.protocol_version.trim().is_empty() {
        return Err("relay.ready is missing protocolVersion".into());
    }
    if ready.minimum_client_protocol_version.trim().is_empty() {
        return Err("relay.ready is missing minimumClientProtocolVersion".into());
    }
    Ok(ready)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_success_response() {
        let frame = parse_frame(r#"{"jsonrpc":"2.0","id":"a","result":{"ok":true}}"#).unwrap();
        assert!(matches!(frame, RelayFrame::Success { .. }));
    }

    #[test]
    fn parses_error_response() {
        let frame = parse_frame(
            r#"{"jsonrpc":"2.0","id":"a","error":{"code":-32008,"name":"plan_expired","message":"expired"}}"#,
        )
        .unwrap();
        match frame {
            RelayFrame::Failure { error, .. } => assert_eq!(error.name, "plan_expired"),
            _ => panic!("expected failure"),
        }
    }

    #[test]
    fn parses_ready_notification() {
        let frame = parse_frame(
            r#"{"jsonrpc":"2.0","method":"relay.ready","params":{"implementationVersion":"0.1.0","protocolVersion":"1.1.0","minimumClientProtocolVersion":"1.0.0"}}"#,
        )
        .unwrap();
        match frame {
            RelayFrame::Notification { method, params } => {
                assert_eq!(method, "relay.ready");
                let ready = validate_ready(params).unwrap();
                assert_eq!(ready.protocol_version, "1.1.0");
            }
            _ => panic!("expected notification"),
        }
    }

    #[test]
    fn rejects_non_object_lines() {
        assert!(parse_frame("[]").is_err());
        assert!(parse_frame("not json").is_err());
    }

    #[test]
    fn classifies_protocol_major() {
        assert!(is_protocol_compatible("1.1.0"));
        assert!(!is_protocol_compatible("2.0.0"));
    }

    #[test]
    fn reports_missing_methods() {
        let missing = missing_required_methods(&["relay.health".to_string()]);
        assert!(missing.contains(&"launch.plan".to_string()));
    }
}
