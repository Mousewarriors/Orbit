//! Native HTTP bridge.
//!
//! The webview cannot reach localhost (Ollama) or arbitrary MCP endpoints under
//! the app CSP, and has no way to open raw sockets. This module gives the
//! renderer a *narrow, validated* HTTP capability through Rust: a one-shot
//! request (used for Ollama `/api/tags`, non-streaming `/api/chat`, and HTTP MCP
//! JSON-RPC) and a streamed request that emits body chunks as Tauri events (used
//! for Ollama token streaming). Only `http`/`https` URLs are allowed; the URL is
//! validated before any connection is made. This is the activation step for the
//! AI runtime + MCP client that were already built behind injected transports.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(15))
        .user_agent("orbit/0.1")
        .build()
        .expect("failed to build HTTP client")
});

/// In-flight stream cancellation flags, keyed by the renderer-supplied id.
static CANCELS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Serialize, Clone)]
struct StreamEvent {
    id: String,
    /// "chunk" (base64 bytes) | "end" | "error".
    kind: String,
    data: String,
    status: u16,
}

/// Validate the URL scheme and build a request. Rejects anything but http(s).
fn build_request(
    method: &str,
    url: &str,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<reqwest::RequestBuilder, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("only http(s) URLs are allowed".into());
    }
    let m = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("invalid method: {e}"))?;
    let mut rb = CLIENT.request(m, parsed);
    for (k, v) in headers {
        rb = rb.header(k, v);
    }
    if let Some(b) = body {
        rb = rb.body(b);
    }
    Ok(rb)
}

/// One-shot HTTP request. Returns the status + body text (never throws for a
/// non-2xx; the caller inspects `status`). Errors only on transport failures.
#[tauri::command]
pub async fn http_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let rb = build_request(&method, &url, headers, body)?;
    let resp = rb.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, body: text })
}

/// Start a streamed request. Body bytes are emitted as base64 on the
/// `http-stream` event ({ id, kind, data, status }) so the renderer can decode
/// them with a streaming TextDecoder (handling multi-byte boundaries correctly).
/// `http_stream_cancel` stops it.
#[tauri::command]
pub async fn http_stream_open(
    app: AppHandle,
    id: String,
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<(), String> {
    let rb = build_request(&method, &url, headers, body)?;
    let flag = Arc::new(AtomicBool::new(false));
    CANCELS.lock().unwrap().insert(id.clone(), flag.clone());

    tauri::async_runtime::spawn(async move {
        use futures_util::StreamExt;
        let emit = |kind: &str, data: String, status: u16| {
            let _ = app.emit(
                "http-stream",
                StreamEvent { id: id.clone(), kind: kind.into(), data, status },
            );
        };
        match rb.send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if !resp.status().is_success() {
                    let text = resp.text().await.unwrap_or_default();
                    emit("error", format!("HTTP {status}: {text}"), status);
                } else {
                    let mut stream = resp.bytes_stream();
                    let mut failed = false;
                    while let Some(chunk) = stream.next().await {
                        if flag.load(Ordering::Relaxed) {
                            break;
                        }
                        match chunk {
                            Ok(bytes) => {
                                let encoded =
                                    base64::engine::general_purpose::STANDARD.encode(&bytes);
                                emit("chunk", encoded, status);
                            }
                            Err(e) => {
                                emit("error", e.to_string(), status);
                                failed = true;
                                break;
                            }
                        }
                    }
                    if !failed {
                        emit("end", String::new(), status);
                    }
                }
            }
            Err(e) => emit("error", e.to_string(), 0),
        }
        CANCELS.lock().unwrap().remove(&id);
    });
    Ok(())
}

/// Signal an in-flight stream to stop.
#[tauri::command]
pub fn http_stream_cancel(id: String) {
    if let Some(flag) = CANCELS.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_schemes() {
        assert!(build_request("GET", "ftp://example.com", HashMap::new(), None).is_err());
        assert!(build_request("GET", "file:///etc/passwd", HashMap::new(), None).is_err());
        assert!(build_request("GET", "not a url", HashMap::new(), None).is_err());
    }

    #[test]
    fn accepts_http_and_https() {
        assert!(build_request("GET", "http://127.0.0.1:11434/api/tags", HashMap::new(), None).is_ok());
        assert!(build_request("POST", "https://api.example.com/v1", HashMap::new(), Some("{}".into())).is_ok());
    }
}
