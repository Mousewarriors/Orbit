//! OAuth loopback redirect server.
//!
//! Subscription sign-in (ChatGPT/Codex, Claude) uses the OAuth Authorization
//! Code + PKCE flow: the browser is sent to the provider's authorize page and
//! redirected back to a loopback URL like `http://localhost:1455/auth/callback?
//! code=…&state=…`. The webview can't open raw sockets, so this module gives the
//! renderer a *narrow* native capability: bind a **one-shot** loopback HTTP
//! server on `127.0.0.1:<port>`, accept a single request, hand the `code`/`state`
//! back to the renderer via the `oauth-callback` event, and shut down.
//!
//! Only loopback is bound (never a public interface); the server accepts exactly
//! one connection, has an overall deadline, and can be cancelled. Tokens
//! themselves are exchanged by the renderer through the existing HTTP bridge and
//! stored in OS secure storage — they never pass through this module.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Pending loopback listeners, keyed by the renderer-supplied request id, so a
/// flow can be cancelled (e.g. on timeout) before the redirect arrives.
static OAUTH_CANCELS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Clone)]
struct OauthCallback {
    #[serde(rename = "requestId")]
    request_id: String,
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// The small HTML page shown in the browser after the redirect is captured.
const DONE_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Orbit</title>\
<style>body{font-family:system-ui;background:#0b0b0d;color:#eee;display:flex;height:100vh;\
margin:0;align-items:center;justify-content:center}div{text-align:center}</style></head>\
<body><div><h2>You're signed in.</h2><p>You can close this tab and return to Orbit.</p></div></body></html>";

/// Parse the `code`/`state`/`error` query params out of an HTTP request's first
/// line (`GET /callback?code=…&state=… HTTP/1.1`).
fn parse_request_target(line: &str) -> (Option<String>, Option<String>, Option<String>) {
    let target = line.split_whitespace().nth(1).unwrap_or("");
    // Build an absolute URL so the robust query parser can do the work.
    let url = match reqwest::Url::parse(&format!("http://localhost{target}")) {
        Ok(u) => u,
        Err(_) => return (None, None, None),
    };
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "state" => state = Some(v.into_owned()),
            "error" => error = Some(v.into_owned()),
            _ => {}
        }
    }
    (code, state, error)
}

/// Accept a single redirect connection (or stop on cancel/deadline). Returns the
/// parsed callback, or `Err` with a reason ("cancelled" / "timed out" / IO).
fn accept_one(
    listener: &TcpListener,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Result<(Option<String>, Option<String>, Option<String>), String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("listener config failed: {e}"))?;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        if Instant::now() >= deadline {
            return Err("timed out".into());
        }
        match listener.accept() {
            Ok((mut stream, _addr)) => {
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let text = String::from_utf8_lossy(&buf[..n]);
                let first_line = text.lines().next().unwrap_or("");
                let parsed = parse_request_target(first_line);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                    DONE_PAGE.len(),
                    DONE_PAGE
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
                return Ok(parsed);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(60));
            }
            Err(e) => return Err(format!("accept failed: {e}")),
        }
    }
}

/// Bind the loopback callback server and start waiting (in a background thread)
/// for the single redirect. Returns the actually-bound port once listening, so
/// the renderer can safely open the browser afterwards. The result is delivered
/// on the `oauth-callback` event ({ requestId, code, state, error }).
#[tauri::command]
pub fn oauth_listen(
    app: AppHandle,
    request_id: String,
    port: u16,
    path: String,
    timeout_ms: u64,
) -> Result<u16, String> {
    // Bind synchronously (before returning) so there is no race with the browser
    // redirect. Loopback only — never a public interface.
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("cannot bind 127.0.0.1:{port} for OAuth redirect: {e}"))?;
    let bound_port = listener.local_addr().map(|a| a.port()).unwrap_or(port);

    let cancel = Arc::new(AtomicBool::new(false));
    OAUTH_CANCELS
        .lock()
        .unwrap()
        .insert(request_id.clone(), cancel.clone());

    let _ = path; // path is informational; any redirect to the bound port is accepted
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.clamp(1_000, 600_000));

    std::thread::spawn(move || {
        let payload = match accept_one(&listener, &cancel, deadline) {
            Ok((code, state, error)) => OauthCallback {
                request_id: request_id.clone(),
                code,
                state,
                error,
            },
            Err(reason) => OauthCallback {
                request_id: request_id.clone(),
                code: None,
                state: None,
                error: Some(reason),
            },
        };
        OAUTH_CANCELS.lock().unwrap().remove(&request_id);
        let _ = app.emit("oauth-callback", payload);
    });

    Ok(bound_port)
}

/// Cancel a pending loopback listener.
#[tauri::command]
pub fn oauth_cancel(request_id: String) {
    if let Some(flag) = OAUTH_CANCELS.lock().unwrap().get(&request_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_code_and_state_from_request_line() {
        let (code, state, error) =
            parse_request_target("GET /auth/callback?code=abc123&state=xyz HTTP/1.1");
        assert_eq!(code.as_deref(), Some("abc123"));
        assert_eq!(state.as_deref(), Some("xyz"));
        assert_eq!(error, None);
    }

    #[test]
    fn parses_error_param() {
        let (code, _state, error) =
            parse_request_target("GET /callback?error=access_denied HTTP/1.1");
        assert_eq!(code, None);
        assert_eq!(error.as_deref(), Some("access_denied"));
    }

    #[test]
    fn tolerates_a_garbage_request_line() {
        let (code, state, error) = parse_request_target("not a real request line");
        assert!(code.is_none() && state.is_none() && error.is_none());
    }

    #[test]
    fn url_decodes_query_values() {
        let (code, _s, _e) = parse_request_target("GET /cb?code=a%2Bb%2Fc HTTP/1.1");
        assert_eq!(code.as_deref(), Some("a+b/c"));
    }
}
