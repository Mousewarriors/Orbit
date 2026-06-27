//! Native stdio MCP host.
//!
//! Many MCP servers (including AgentOS's own Second Brain server at
//! `node C:\AgentOS\server\mcp\server.js`) speak JSON-RPC 2.0 over a long-lived
//! child process's stdin/stdout (newline-delimited), not HTTP. The webview can
//! neither spawn a process nor hold a pipe open, so this module gives the
//! renderer a *narrow* capability: open a named connection to a configured
//! command, exchange one JSON-RPC request/response at a time, and close it.
//!
//! Safety boundary: the command + args come from user-entered, persisted MCP
//! server config (exactly how every MCP client — Claude Desktop, Codex, … —
//! configures a stdio server). We do not interpret the payload; we only frame
//! bytes and route a response back by its JSON-RPC `id`. stdout is the protocol
//! channel; stderr is drained to a bounded ring buffer for diagnostics so a
//! chatty server can never deadlock on a full pipe.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Hard ceiling on how long a single request waits for its response.
const MAX_TIMEOUT_MS: u64 = 120_000;
/// How many stderr lines we retain per connection for diagnostics.
const STDERR_RING: usize = 60;

struct StdioConn {
    /// Serialises a full write→read cycle so concurrent requests can't steal
    /// each other's response line.
    io: Mutex<ConnIo>,
    stderr: Arc<Mutex<VecDeque<String>>>,
}

struct ConnIo {
    stdin: ChildStdin,
    rx: Receiver<String>,
    child: Child,
}

static CONNS: LazyLock<Mutex<HashMap<String, Arc<StdioConn>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn validate_connection_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return Err("invalid MCP connection id".into());
    }
    Ok(())
}

/// Orbit currently supports the common local Node MCP-server shape only:
/// `node <absolute-script> [bounded args...]`, with the script contained by the
/// configured working directory. This deliberately rejects arbitrary binaries
/// and inline `node -e` execution at the native IPC boundary.
fn validate_process_spec(
    command: &str,
    args: &[String],
    cwd: Option<&str>,
) -> Result<Option<std::path::PathBuf>, String> {
    let executable = std::path::Path::new(command)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(command)
        .to_ascii_lowercase();
    if executable != "node" && executable != "node.exe" {
        return Err("only Node-based stdio MCP servers are supported".into());
    }
    if args.is_empty() || args.len() > 32 {
        return Err("a bounded MCP server script and arguments are required".into());
    }
    if args.iter().any(|arg| arg.len() > 4096 || arg.contains('\0')) {
        return Err("invalid MCP server argument".into());
    }
    if args[0].starts_with('-') {
        return Err("inline Node execution is not allowed for MCP servers".into());
    }

    let script = std::path::PathBuf::from(&args[0]);
    if !script.is_absolute() || !script.is_file() {
        return Err("MCP server script must be an existing absolute file".into());
    }
    let extension = script
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "js" | "mjs" | "cjs") {
        return Err("MCP server script must be a JavaScript module".into());
    }

    let canonical_script = script
        .canonicalize()
        .map_err(|e| format!("could not resolve MCP server script: {e}"))?;
    let canonical_cwd = match cwd.filter(|d| !d.trim().is_empty()) {
        Some(dir) => {
            let path = std::path::PathBuf::from(dir);
            if !path.is_absolute() || !path.is_dir() {
                return Err("MCP working directory must be an existing absolute directory".into());
            }
            let canonical = path
                .canonicalize()
                .map_err(|e| format!("could not resolve MCP working directory: {e}"))?;
            if !canonical_script.starts_with(&canonical) {
                return Err("MCP server script must be inside its working directory".into());
            }
            Some(canonical)
        }
        None => canonical_script.parent().map(std::path::Path::to_path_buf),
    };
    Ok(canonical_cwd)
}

/// Does this JSON-RPC line carry the `id` we're waiting for? Responses echo the
/// request id; notifications (no id) and stray ids are skipped.
fn line_matches_id(line: &str, want: &serde_json::Value) -> bool {
    serde_json::from_str::<serde_json::Value>(line)
        .ok()
        .and_then(|v| v.get("id").cloned())
        .map(|id| &id == want)
        .unwrap_or(false)
}

/// Open a stdio MCP connection under `id`. Replaces any existing connection with
/// the same id (killing the old child). `command` is the executable, `args` its
/// arguments, `cwd` an optional working directory.
#[tauri::command]
pub fn mcp_stdio_open(
    id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    validate_connection_id(&id)?;
    if command.trim().is_empty() {
        return Err("command required".into());
    }
    let validated_cwd = validate_process_spec(&command, &args, cwd.as_deref())?;

    // Tear down any prior connection with this id first.
    let _ = mcp_stdio_close(id.clone());

    let mut cmd = Command::new(&command);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = validated_cwd.as_ref() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: don't flash a console for the child.
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start '{command}': {e}"))?;

    let stdin = child.stdin.take().ok_or("child has no stdin")?;
    let stdout = child.stdout.take().ok_or("child has no stdout")?;
    let stderr = child.stderr.take().ok_or("child has no stderr")?;

    // stdout reader thread → channel of protocol lines.
    let (tx, rx) = channel::<String>();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if tx.send(l).is_err() {
                        break; // receiver dropped: connection closed
                    }
                }
                Err(_) => break,
            }
        }
    });

    // stderr drain thread → bounded ring buffer (prevents pipe deadlock).
    let ring = Arc::new(Mutex::new(VecDeque::<String>::with_capacity(STDERR_RING)));
    let ring_w = ring.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let line = crate::redaction::redact_secrets(&line);
            let mut r = ring_w.lock().unwrap();
            if r.len() == STDERR_RING {
                r.pop_front();
            }
            r.push_back(line);
        }
    });

    let conn = Arc::new(StdioConn {
        io: Mutex::new(ConnIo { stdin, rx, child }),
        stderr: ring,
    });
    CONNS.lock().unwrap().insert(id, conn);
    Ok(())
}

/// Send one JSON-RPC request line and return the matching response line. Errors
/// only on transport failure (no connection, write failed, timeout); protocol
/// errors come back inside the returned JSON.
#[tauri::command]
pub fn mcp_stdio_request(
    id: String,
    request: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let conn = CONNS
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or("no such MCP connection")?;

    let want = serde_json::from_str::<serde_json::Value>(&request)
        .ok()
        .and_then(|v| v.get("id").cloned())
        .ok_or("request has no JSON-RPC id")?;

    let budget = Duration::from_millis(timeout_ms.unwrap_or(30_000).min(MAX_TIMEOUT_MS));
    let deadline = Instant::now() + budget;

    let mut io = conn.io.lock().unwrap();

    // Write the request line.
    {
        let line = format!("{}\n", request.trim_end());
        io.stdin
            .write_all(line.as_bytes())
            .and_then(|_| io.stdin.flush())
            .map_err(|e| format!("write failed: {e}"))?;
    }

    // Read until the matching response, the deadline, or the pipe closing.
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("MCP request timed out".into());
        }
        match io.rx.recv_timeout(remaining) {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue;
                }
                if line_matches_id(&line, &want) {
                    return Ok(line);
                }
                // A notification or unrelated line: keep reading.
            }
            Err(RecvTimeoutError::Timeout) => return Err("MCP request timed out".into()),
            Err(RecvTimeoutError::Disconnected) => {
                let tail = conn.stderr.lock().unwrap();
                let hint: Vec<&str> = tail.iter().rev().take(3).map(|s| s.as_str()).collect();
                return Err(format!(
                    "MCP server exited unexpectedly{}",
                    if hint.is_empty() {
                        String::new()
                    } else {
                        format!(": {}", hint.join(" | "))
                    }
                ));
            }
        }
    }
}

/// Recent stderr lines from a connection (diagnostics; never the protocol).
#[tauri::command]
pub fn mcp_stdio_logs(id: String) -> Result<Vec<String>, String> {
    let conn = CONNS.lock().unwrap().get(&id).cloned();
    match conn {
        Some(c) => Ok(c
            .stderr
            .lock()
            .unwrap()
            .iter()
            .map(|line| crate::redaction::redact_secrets(line))
            .collect()),
        None => Ok(vec![]),
    }
}

/// Close a connection and kill its child process. Idempotent.
#[tauri::command]
pub fn mcp_stdio_close(id: String) -> Result<(), String> {
    if let Some(conn) = CONNS.lock().unwrap().remove(&id) {
        if let Ok(mut io) = conn.io.lock() {
            let _ = io.child.kill();
            let _ = io.child.wait();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{}-{stamp}", std::process::id()))
    }
    use serde_json::json;

    #[test]
    fn matches_numeric_id() {
        let line = r#"{"jsonrpc":"2.0","id":2,"result":{}}"#;
        assert!(line_matches_id(line, &json!(2)));
        assert!(!line_matches_id(line, &json!(3)));
    }

    #[test]
    fn skips_notifications_and_garbage() {
        let notif = r#"{"jsonrpc":"2.0","method":"notifications/progress"}"#;
        assert!(!line_matches_id(notif, &json!(1)));
        assert!(!line_matches_id("not json at all", &json!(1)));
        assert!(!line_matches_id("", &json!(1)));
    }

    #[test]
    fn rejects_arbitrary_or_inline_processes() {
        assert!(validate_process_spec("powershell", &["x.ps1".into()], None).is_err());
        assert!(validate_process_spec("node", &["-e".into(), "process.exit()".into()], None)
            .is_err());
    }

    #[test]
    fn validates_a_script_contained_by_its_working_directory() {
        let root = unique_temp_dir("orbit-mcp-spec");
        std::fs::create_dir_all(&root).unwrap();
        let script = root.join("server.mjs");
        std::fs::write(&script, "process.exit(0)").unwrap();
        let args = vec![script.to_string_lossy().to_string()];
        assert!(validate_process_spec("node", &args, root.to_str()).is_ok());
        let _ = std::fs::remove_dir_all(root);
    }

    /// Real round-trip against a tiny stdio JSON-RPC responder, when `node` is
    /// available (CI + the dev machine). Exercises spawn → write → framed read →
    /// close exactly like a real MCP server.
    #[test]
    fn round_trip_against_node_echo() {
        let probe = Command::new("node").arg("--version").output();
        if probe.map(|o| !o.status.success()).unwrap_or(true) {
            eprintln!("skipping: node not available");
            return;
        }
        let script = r#"
            const rl = require('readline').createInterface({ input: process.stdin });
            rl.on('line', (l) => {
              const m = JSON.parse(l);
              process.stderr.write('got ' + m.id + '\n');
              process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { echo: m.method } }) + '\n');
            });
        "#;
        let root = unique_temp_dir("orbit-mcp-echo");
        std::fs::create_dir_all(&root).expect("temp root");
        let script_path = root.join("echo.cjs");
        std::fs::write(&script_path, script).expect("write echo script");
        let cid = "test-echo".to_string();
        mcp_stdio_open(
            cid.clone(),
            "node".into(),
            vec![script_path.to_string_lossy().to_string()],
            Some(root.to_string_lossy().to_string()),
        )
        .expect("open");

        let req = r#"{"jsonrpc":"2.0","id":7,"method":"ping"}"#.to_string();
        let resp = mcp_stdio_request(cid.clone(), req, Some(10_000)).expect("request");
        let v: serde_json::Value = serde_json::from_str(&resp).unwrap();
        assert_eq!(v["id"], json!(7));
        assert_eq!(v["result"]["echo"], json!("ping"));

        mcp_stdio_close(cid).expect("close");
        let _ = std::fs::remove_dir_all(root);
    }
}
