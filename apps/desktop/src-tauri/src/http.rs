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
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
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
fn build_request_with_client(
    client: &reqwest::Client,
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
    let mut rb = client.request(m, parsed);
    for (k, v) in headers {
        rb = rb.header(k, v);
    }
    if let Some(b) = body {
        rb = rb.body(b);
    }
    Ok(rb)
}

fn build_request(
    method: &str,
    url: &str,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<reqwest::RequestBuilder, String> {
    build_request_with_client(&CLIENT, method, url, headers, body)
}

fn ipv4_is_forbidden(ip: Ipv4Addr) -> bool {
    ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || ip.octets()[0] == 0
        || ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1])
        || ip.octets()[0] == 169 && ip.octets()[1] == 254
        || ip.octets()[0] == 192 && ip.octets()[1] == 0
        || ip.octets()[0] == 192 && ip.octets()[1] == 88 && ip.octets()[2] == 99
        || ip.octets()[0] == 198 && (ip.octets()[1] == 18 || ip.octets()[1] == 19)
        || ip.octets()[0] >= 240
}

fn ipv6_is_unique_local(ip: Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xfe00) == 0xfc00
}

fn ipv6_is_unicast_link_local(ip: Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xffc0) == 0xfe80
}

fn ipv6_is_documentation(ip: Ipv6Addr) -> bool {
    ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8
}

fn ipv6_is_special_purpose(ip: Ipv6Addr) -> bool {
    ip.segments()[0] == 0x0100 || (ip.segments()[0] == 0x2001 && ip.segments()[1] <= 0x01ff)
}

fn ip_is_forbidden(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ipv4_is_forbidden(ip),
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return ipv4_is_forbidden(mapped);
            }
            ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_multicast()
                || ipv6_is_unique_local(ip)
                || ipv6_is_unicast_link_local(ip)
                || ipv6_is_documentation(ip)
                || ipv6_is_special_purpose(ip)
        }
    }
}

fn validate_http_mcp_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("HTTP MCP endpoints must use https".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("HTTP MCP endpoints must not include credentials in the URL".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "HTTP MCP endpoint must include a host".to_string())?;
    let lower_host = host.trim_end_matches('.').to_ascii_lowercase();
    if lower_host == "localhost"
        || lower_host.ends_with(".localhost")
        || lower_host.ends_with(".local")
    {
        return Err("HTTP MCP endpoints must not target loopback or local hosts".into());
    }
    let ip_literal = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = ip_literal.parse::<IpAddr>() {
        if ip_is_forbidden(ip) {
            return Err("HTTP MCP endpoint resolves to a forbidden address".into());
        }
    }
    Ok(parsed)
}

fn resolve_http_mcp_addresses(url: &reqwest::Url) -> Result<(String, Vec<SocketAddr>), String> {
    let host = url
        .host_str()
        .ok_or_else(|| "HTTP MCP endpoint must include a host".to_string())?;
    let host_for_resolution = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "HTTP MCP endpoint must include a port".to_string())?;
    let addrs = (host_for_resolution.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| format!("could not resolve HTTP MCP endpoint: {e}"))?
        .collect::<Vec<_>>();
    if addrs.is_empty() {
        return Err("HTTP MCP endpoint resolved to no addresses".into());
    }
    if addrs.iter().any(|addr| ip_is_forbidden(addr.ip())) {
        return Err("HTTP MCP endpoint resolves to a forbidden address".into());
    }
    Ok((host_for_resolution, addrs))
}

fn build_mcp_request(
    method: &str,
    url: &str,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<reqwest::RequestBuilder, String> {
    let parsed = validate_http_mcp_url(url)?;
    let (host, addrs) = resolve_http_mcp_addresses(&parsed)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .resolve_to_addrs(&host, &addrs)
        .user_agent("orbit/0.1 mcp")
        .build()
        .map_err(|e| format!("failed to build HTTP MCP client: {e}"))?;
    build_request_with_client(&client, method, parsed.as_str(), headers, body)
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

/// One-shot HTTP request for Streamable HTTP MCP only. This deliberately has a
/// narrower policy than general provider traffic: public HTTPS, no URL secrets,
/// no loopback/private/reserved destinations after DNS resolution, and redirects
/// are terminal errors rather than followed.
#[tauri::command]
pub async fn http_mcp_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let rb = build_mcp_request(&method, &url, headers, body)?;
    let resp = rb.send().await.map_err(|e| e.to_string())?;
    if resp.status().is_redirection() {
        return Err("HTTP MCP redirects are not allowed".into());
    }
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
                StreamEvent {
                    id: id.clone(),
                    kind: kind.into(),
                    data,
                    status,
                },
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
        assert!(build_request(
            "GET",
            "http://127.0.0.1:11434/api/tags",
            HashMap::new(),
            None
        )
        .is_ok());
        assert!(build_request(
            "POST",
            "https://api.example.com/v1",
            HashMap::new(),
            Some("{}".into())
        )
        .is_ok());
    }

    #[test]
    fn http_mcp_requires_https_public_hosts_without_url_credentials() {
        assert!(validate_http_mcp_url("http://mcp.example.com").is_err());
        assert!(validate_http_mcp_url("https://user:pass@mcp.example.com").is_err());
        assert!(validate_http_mcp_url("https://localhost/mcp").is_err());
        assert!(validate_http_mcp_url("https://service.local/mcp").is_err());
        assert!(validate_http_mcp_url("https://127.0.0.1/mcp").is_err());
        assert!(validate_http_mcp_url("https://10.0.0.8/mcp").is_err());
        assert!(validate_http_mcp_url("https://172.16.0.8/mcp").is_err());
        assert!(validate_http_mcp_url("https://192.168.1.8/mcp").is_err());
        assert!(validate_http_mcp_url("https://169.254.169.254/mcp").is_err());
        assert!(validate_http_mcp_url("https://192.0.0.1/mcp").is_err());
        assert!(validate_http_mcp_url("https://198.18.0.1/mcp").is_err());
        assert!(validate_http_mcp_url("https://198.19.255.255/mcp").is_err());
        assert!(validate_http_mcp_url("https://[::1]/mcp").is_err());
        assert!(validate_http_mcp_url("https://[fc00::1]/mcp").is_err());
        assert!(validate_http_mcp_url("https://[::ffff:192.168.1.1]/mcp").is_err());
        assert!(validate_http_mcp_url("https://[::ffff:c0a8:101]/mcp").is_err());
        assert!(validate_http_mcp_url("https://8.8.8.8/mcp").is_ok());
        assert!(validate_http_mcp_url("https://mcp.example.com/rpc").is_ok());
    }

    #[test]
    fn http_mcp_address_classifier_rejects_non_public_dns_results() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "100.64.0.1",
            "169.254.169.254",
            "172.16.0.1",
            "192.0.0.1",
            "192.168.0.1",
            "198.18.0.1",
            "198.19.255.255",
            "203.0.113.1",
        ] {
            assert!(ip_is_forbidden(ip.parse::<IpAddr>().expect(ip)), "{ip} must be forbidden");
        }
        assert!(!ip_is_forbidden("8.8.8.8".parse::<IpAddr>().unwrap()));
        let parsed = validate_http_mcp_url("https://mcp.example.com/rpc").expect("shape valid");
        // This assertion documents the preflight DNS hook without depending on a
        // live network result in CI; direct forbidden hosts are rejected above.
        assert_eq!(parsed.scheme(), "https");
    }
}
