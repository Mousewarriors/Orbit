//! Orbit-owned supervisor for the certified Orbit Relay sidecar.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
#[cfg(not(test))]
use tauri::AppHandle;
#[cfg(not(test))]
use tauri::Emitter;

#[cfg(not(test))]
type RelayAppHandle = AppHandle;

#[cfg(test)]
type RelayAppHandle = ();

use crate::relay_manifest;
use crate::relay_protocol::{
    id_key, is_protocol_compatible, missing_required_methods, parse_frame, validate_ready,
    JsonRpcRequest, RelayErrorPayload, RelayFrame, RelayReady,
};

pub const EVENT_RELAY_STATE_CHANGED: &str = "relay-state-changed";
pub const EVENT_RELAY_DIAGNOSTICS_UPDATED: &str = "relay-diagnostics-updated";
pub const EVENT_RELAY_EXITED: &str = "relay-exited";
pub const EVENT_RELAY_RECOVERED: &str = "relay-recovered";
pub const EVENT_RELAY_SESSION_STARTED: &str = "relay-session-started";
pub const EVENT_RELAY_SESSION_COMPLETED: &str = "relay-session-completed";
pub const EVENT_RELAY_SESSION_FAILED: &str = "relay-session-failed";
pub const EVENT_RELAY_SESSION_STOPPED: &str = "relay-session-stopped";
pub const EVENT_RELAY_HANDOFF_CREATED: &str = "relay-handoff-created";

const READY_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(1);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_DIAGNOSTIC_LINES: usize = 100;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RelaySupervisorState {
    Stopped,
    Starting,
    AwaitingReady,
    Ready,
    Degraded,
    Restarting,
    Incompatible,
    Failed,
    ShuttingDown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayExpectedMetadata {
    pub relay_version: &'static str,
    pub protocol_version: &'static str,
    pub minimum_client_protocol_version: &'static str,
    pub protocol_compatibility_range: &'static str,
    pub target_triple: &'static str,
    pub sidecar_name: &'static str,
    pub sidecar_file_name: &'static str,
    pub certified_commit: &'static str,
    pub expected_sha256: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatusSnapshot {
    pub state: RelaySupervisorState,
    pub expected: RelayExpectedMetadata,
    pub user_message: String,
    pub technical_detail: Option<String>,
    pub diagnostics: Vec<String>,
    pub ready: Option<RelayReady>,
    pub health: Option<Value>,
    pub capabilities: Option<Value>,
    pub missing_methods: Vec<String>,
    pub pid: Option<u32>,
    pub sidecar_path: Option<String>,
    pub sidecar_sha256: Option<String>,
    pub pending_requests: usize,
    pub last_exit_code: Option<i32>,
    pub last_state_change_ms: i64,
}

#[derive(Debug, Clone)]
pub struct RelayClientError {
    pub code: Option<i64>,
    pub name: Option<String>,
    pub message: String,
    pub data: Option<Value>,
}

impl RelayClientError {
    fn plain(message: impl Into<String>) -> Self {
        RelayClientError {
            code: None,
            name: None,
            message: message.into(),
            data: None,
        }
    }

    pub fn display_message(&self) -> String {
        let base = match (&self.name, self.code) {
            (Some(name), Some(code)) => format!("{name} ({code}): {}", self.message),
            (Some(name), None) => format!("{name}: {}", self.message),
            _ => self.message.clone(),
        };
        if let Some(data) = self.data.as_ref() {
            format!("{base} ({data})")
        } else {
            base
        }
    }
}

impl From<RelayErrorPayload> for RelayClientError {
    fn from(error: RelayErrorPayload) -> Self {
        RelayClientError {
            code: Some(error.code),
            name: Some(error.name),
            message: error.message,
            data: error.data,
        }
    }
}

struct PendingRequest {
    method: String,
    tx: mpsc::Sender<Result<Value, RelayClientError>>,
}

enum WriterCommand {
    Line(String),
    Shutdown,
}

struct SupervisorInner {
    state: RelaySupervisorState,
    user_message: String,
    technical_detail: Option<String>,
    diagnostics: VecDeque<String>,
    ready: Option<RelayReady>,
    health: Option<Value>,
    capabilities: Option<Value>,
    missing_methods: Vec<String>,
    pid: Option<u32>,
    process: Option<Arc<Mutex<Child>>>,
    writer: Option<mpsc::Sender<WriterCommand>>,
    request_counter: u64,
    sidecar_path: Option<String>,
    sidecar_sha256: Option<String>,
    last_exit_code: Option<i32>,
    last_state_change_ms: i64,
}

impl Default for SupervisorInner {
    fn default() -> Self {
        SupervisorInner {
            state: RelaySupervisorState::Stopped,
            user_message: "Relay is stopped.".into(),
            technical_detail: None,
            diagnostics: VecDeque::new(),
            ready: None,
            health: None,
            capabilities: None,
            missing_methods: Vec::new(),
            pid: None,
            process: None,
            writer: None,
            request_counter: 0,
            sidecar_path: None,
            sidecar_sha256: None,
            last_exit_code: None,
            last_state_change_ms: now_ms(),
        }
    }
}

#[derive(Clone, Default)]
pub struct RelaySupervisor {
    inner: Arc<Mutex<SupervisorInner>>,
    pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
}

impl RelaySupervisor {
    pub fn status(&self) -> RelayStatusSnapshot {
        let inner = self.inner.lock().expect("relay supervisor mutex");
        let pending_requests = self.pending.lock().map(|p| p.len()).unwrap_or_default();
        RelayStatusSnapshot {
            state: inner.state,
            expected: RelayExpectedMetadata {
                relay_version: relay_manifest::RELAY_VERSION,
                protocol_version: relay_manifest::PROTOCOL_VERSION,
                minimum_client_protocol_version: relay_manifest::MINIMUM_CLIENT_PROTOCOL_VERSION,
                protocol_compatibility_range: relay_manifest::PROTOCOL_COMPATIBILITY_RANGE,
                target_triple: relay_manifest::TARGET_TRIPLE,
                sidecar_name: relay_manifest::SIDECAR_NAME,
                sidecar_file_name: relay_manifest::SIDECAR_FILE_NAME,
                certified_commit: relay_manifest::CERTIFIED_COMMIT,
                expected_sha256: relay_manifest::EXPECTED_SHA256,
            },
            user_message: inner.user_message.clone(),
            technical_detail: inner.technical_detail.clone(),
            diagnostics: inner.diagnostics.iter().cloned().collect(),
            ready: inner.ready.clone(),
            health: inner.health.clone(),
            capabilities: inner.capabilities.clone(),
            missing_methods: inner.missing_methods.clone(),
            pid: inner.pid,
            sidecar_path: inner.sidecar_path.clone(),
            sidecar_sha256: inner.sidecar_sha256.clone(),
            pending_requests,
            last_exit_code: inner.last_exit_code,
            last_state_change_ms: inner.last_state_change_ms,
        }
    }

    #[cfg(not(test))]
    pub fn start(&self, app: AppHandle) -> Result<RelayStatusSnapshot, String> {
        {
            let inner = self.inner.lock().map_err(|e| e.to_string())?;
            if matches!(
                inner.state,
                RelaySupervisorState::Starting
                    | RelaySupervisorState::AwaitingReady
                    | RelaySupervisorState::Ready
                    | RelaySupervisorState::Restarting
            ) {
                return Ok(self.status());
            }
        }

        let sidecar_path = relay_manifest::resolve_sidecar_path()?;
        relay_manifest::verify_sha256(&sidecar_path)?;
        let sidecar_sha256 = relay_manifest::file_sha256(&sidecar_path)?;
        let mut command = Command::new(&sidecar_path);
        command.args(["rpc", "--stdio"]);

        self.start_command(
            command,
            Some(app),
            sidecar_path.display().to_string(),
            sidecar_sha256,
        )
    }

    #[cfg(test)]
    pub fn start<T>(&self, _app: T) -> Result<RelayStatusSnapshot, String> {
        Err("Relay AppHandle startup is disabled in unit tests".into())
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub fn start_test_command(
        &self,
        program: impl AsRef<std::ffi::OsStr>,
        args: &[&str],
    ) -> Result<RelayStatusSnapshot, String> {
        let mut command = Command::new(program);
        command.args(args);
        self.start_command(command, None, "<test-command>".into(), "<test>".into())
    }

    fn start_command(
        &self,
        mut command: Command,
        app: Option<RelayAppHandle>,
        sidecar_path: String,
        sidecar_sha256: String,
    ) -> Result<RelayStatusSnapshot, String> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        self.clear_pending(RelayClientError::plain("Relay is restarting"));
        self.transition(
            RelaySupervisorState::Starting,
            "Starting Relay...",
            None,
            app.as_ref(),
        );

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.transition(
                    RelaySupervisorState::Failed,
                    "Relay could not be started.",
                    Some(error.to_string()),
                    app.as_ref(),
                );
                return Err(error.to_string());
            }
        };

        let pid = child.id();
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Relay stdin was unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Relay stdout was unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Relay stderr was unavailable".to_string())?;
        let process = Arc::new(Mutex::new(child));
        let (writer_tx, writer_rx) = mpsc::channel::<WriterCommand>();

        {
            let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
            inner.state = RelaySupervisorState::AwaitingReady;
            inner.user_message = "Relay is starting...".into();
            inner.technical_detail = None;
            inner.ready = None;
            inner.health = None;
            inner.capabilities = None;
            inner.missing_methods.clear();
            inner.pid = Some(pid);
            inner.process = Some(process.clone());
            inner.writer = Some(writer_tx);
            inner.sidecar_path = Some(sidecar_path);
            inner.sidecar_sha256 = Some(sidecar_sha256);
            inner.last_exit_code = None;
            inner.last_state_change_ms = now_ms();
        }
        self.emit_status(app.as_ref());

        self.spawn_writer(stdin, writer_rx, app.clone());
        self.spawn_stdout_reader(stdout, app.clone());
        self.spawn_stderr_reader(stderr, app.clone());
        self.spawn_exit_watcher(process, pid, app.clone());
        self.spawn_ready_timeout(pid, app);

        Ok(self.status())
    }

    #[cfg(not(test))]
    pub fn restart(&self, app: AppHandle) -> Result<RelayStatusSnapshot, String> {
        self.transition(
            RelaySupervisorState::Restarting,
            "Restarting Relay...",
            None,
            Some(&app),
        );
        let _ = self.shutdown_with_timeout(SHUTDOWN_TIMEOUT, Some(&app));
        self.start(app)
    }

    #[cfg(test)]
    pub fn restart<T>(&self, _app: T) -> Result<RelayStatusSnapshot, String> {
        Err("Relay AppHandle restart is disabled in unit tests".into())
    }

    #[cfg(not(test))]
    pub fn shutdown(&self, app: AppHandle) -> Result<RelayStatusSnapshot, String> {
        self.shutdown_with_timeout(SHUTDOWN_TIMEOUT, Some(&app))
    }

    #[cfg(test)]
    pub fn shutdown<T>(&self, _app: T) -> Result<RelayStatusSnapshot, String> {
        Ok(self.status())
    }

    pub fn request(&self, method: &str, params: Value) -> Result<Value, RelayClientError> {
        self.request_with_timeout(method, params, REQUEST_TIMEOUT)
    }

    pub fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, RelayClientError> {
        let (id, writer, max_bytes) = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|e| RelayClientError::plain(e.to_string()))?;
            let writer = inner
                .writer
                .clone()
                .ok_or_else(|| RelayClientError::plain("Relay process is not running"))?;
            if matches!(
                inner.state,
                RelaySupervisorState::Incompatible
                    | RelaySupervisorState::Failed
                    | RelaySupervisorState::Stopped
                    | RelaySupervisorState::ShuttingDown
            ) {
                return Err(RelayClientError::plain(format!(
                    "Relay is not available in {:?} state",
                    inner.state
                )));
            }
            if inner.ready.is_none() {
                return Err(RelayClientError::plain("Relay is not ready"));
            }
            inner.request_counter = inner.request_counter.saturating_add(1);
            let id = format!("orbit-{}", inner.request_counter);
            let max_bytes = inner
                .ready
                .as_ref()
                .and_then(|ready| ready.max_request_line_bytes)
                .unwrap_or(MAX_MESSAGE_BYTES)
                .min(MAX_MESSAGE_BYTES);
            (id, writer, max_bytes)
        };

        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id: id.clone(),
            method: method.to_string(),
            params,
        };
        let line = serde_json::to_string(&request)
            .map_err(|e| RelayClientError::plain(format!("could not encode Relay request: {e}")))?
            + "\n";
        if line.len() > max_bytes {
            return Err(RelayClientError::plain(
                "Relay request exceeds maximum line size",
            ));
        }

        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|e| RelayClientError::plain(e.to_string()))?
            .insert(
                id.clone(),
                PendingRequest {
                    method: method.to_string(),
                    tx,
                },
            );

        if writer.send(WriterCommand::Line(line)).is_err() {
            let _ = self.pending.lock().map(|mut p| p.remove(&id));
            return Err(RelayClientError::plain("Relay writer is unavailable"));
        }

        match rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = self.pending.lock().map(|mut p| p.remove(&id));
                Err(RelayClientError::plain(format!(
                    "Relay request {method} timed out after {} ms",
                    timeout.as_millis()
                )))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err(RelayClientError::plain("Relay request was interrupted"))
            }
        }
    }

    fn shutdown_with_timeout(
        &self,
        timeout: Duration,
        app: Option<&RelayAppHandle>,
    ) -> Result<RelayStatusSnapshot, String> {
        let (writer, process) = {
            let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
            inner.state = RelaySupervisorState::ShuttingDown;
            inner.user_message = "Relay is shutting down...".into();
            inner.technical_detail = None;
            inner.last_state_change_ms = now_ms();
            (inner.writer.take(), inner.process.clone())
        };
        self.emit_status(app);

        if let Some(writer) = writer {
            let _ = writer.send(WriterCommand::Shutdown);
        }

        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if self
                .inner
                .lock()
                .map(|inner| inner.pid.is_none())
                .unwrap_or(true)
            {
                self.transition(
                    RelaySupervisorState::Stopped,
                    "Relay is stopped.",
                    None,
                    app,
                );
                return Ok(self.status());
            }
            thread::sleep(Duration::from_millis(25));
        }

        if let Some(process) = process {
            if let Ok(mut child) = process.lock() {
                let _ = child.kill();
            }
        }

        Ok(self.status())
    }

    fn spawn_writer(
        &self,
        mut stdin: std::process::ChildStdin,
        rx: mpsc::Receiver<WriterCommand>,
        app: Option<RelayAppHandle>,
    ) {
        let supervisor = self.clone();
        thread::spawn(move || {
            while let Ok(command) = rx.recv() {
                match command {
                    WriterCommand::Line(line) => {
                        if let Err(error) = stdin.write_all(line.as_bytes()) {
                            supervisor.transport_failed(
                                format!("Relay stdin write failed: {error}"),
                                app.as_ref(),
                            );
                            break;
                        }
                        if let Err(error) = stdin.flush() {
                            supervisor.transport_failed(
                                format!("Relay stdin flush failed: {error}"),
                                app.as_ref(),
                            );
                            break;
                        }
                    }
                    WriterCommand::Shutdown => break,
                }
            }
        });
    }

    fn spawn_stdout_reader(&self, stdout: std::process::ChildStdout, app: Option<RelayAppHandle>) {
        let supervisor = self.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_protocol_line(&mut reader, supervisor.max_message_bytes()) {
                    Ok(Some(line)) => supervisor.handle_stdout_line(line, app.as_ref()),
                    Ok(None) => break,
                    Err(error) => {
                        supervisor.protocol_failed(error, app.as_ref());
                        break;
                    }
                }
            }
        });
    }

    fn spawn_stderr_reader(&self, stderr: std::process::ChildStderr, app: Option<RelayAppHandle>) {
        let supervisor = self.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        let trimmed = line.trim_end_matches(['\r', '\n']).to_string();
                        if !trimmed.is_empty() {
                            supervisor.push_diagnostic(trimmed, app.as_ref());
                        }
                    }
                    Err(error) => {
                        supervisor.push_diagnostic(
                            format!("Relay stderr read failed: {error}"),
                            app.as_ref(),
                        );
                        break;
                    }
                }
            }
        });
    }

    fn spawn_exit_watcher(
        &self,
        process: Arc<Mutex<Child>>,
        pid: u32,
        app: Option<RelayAppHandle>,
    ) {
        let supervisor = self.clone();
        thread::spawn(move || loop {
            let status = {
                let mut child = match process.lock() {
                    Ok(child) => child,
                    Err(_) => {
                        supervisor.mark_exit(pid, None, app.as_ref());
                        return;
                    }
                };
                match child.try_wait() {
                    Ok(Some(status)) => Some(status.code()),
                    Ok(None) => None,
                    Err(_) => Some(None),
                }
            };
            if let Some(code) = status {
                supervisor.mark_exit(pid, code, app.as_ref());
                return;
            }
            thread::sleep(POLL_INTERVAL);
        });
    }

    fn spawn_ready_timeout(&self, pid: u32, app: Option<RelayAppHandle>) {
        let supervisor = self.clone();
        thread::spawn(move || {
            thread::sleep(READY_TIMEOUT);
            let timed_out = {
                let inner = match supervisor.inner.lock() {
                    Ok(inner) => inner,
                    Err(_) => return,
                };
                inner.pid == Some(pid) && inner.ready.is_none()
            };
            if timed_out {
                supervisor.transition(
                    RelaySupervisorState::Degraded,
                    "Relay did not become ready.",
                    Some(format!(
                        "Timed out after {} ms waiting for relay.ready",
                        READY_TIMEOUT.as_millis()
                    )),
                    app.as_ref(),
                );
                supervisor.kill_owned_process(pid);
            }
        });
    }

    fn handle_stdout_line(&self, line: String, app: Option<&RelayAppHandle>) {
        let frame = match parse_frame(&line) {
            Ok(frame) => frame,
            Err(error) => {
                self.protocol_failed(error, app);
                return;
            }
        };

        let startup_frame = {
            let inner = match self.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            inner.ready.is_none()
        };

        match frame {
            RelayFrame::Notification { method, params } => {
                if startup_frame && method != "relay.ready" {
                    self.protocol_failed(
                        format!("Expected relay.ready before {method} notification"),
                        app,
                    );
                    return;
                }
                if method == "relay.ready" {
                    self.handle_ready(params, app);
                } else {
                    self.emit_notification(&method, params.unwrap_or(Value::Null), app);
                }
            }
            RelayFrame::Success { id, result } => {
                if startup_frame {
                    self.protocol_failed("Expected relay.ready before any response", app);
                    return;
                }
                self.complete_pending(&id_key(&id), Ok(result));
            }
            RelayFrame::Failure { id, error } => {
                if startup_frame {
                    self.protocol_failed("Expected relay.ready before any response", app);
                    return;
                }
                self.complete_pending(&id_key(&id), Err(error.into()));
            }
        }
    }

    fn handle_ready(&self, params: Option<Value>, app: Option<&RelayAppHandle>) {
        let ready = match validate_ready(params) {
            Ok(ready) => ready,
            Err(error) => {
                self.protocol_failed(error, app);
                return;
            }
        };

        if !is_protocol_compatible(&ready.protocol_version) {
            {
                let mut inner = match self.inner.lock() {
                    Ok(inner) => inner,
                    Err(_) => return,
                };
                inner.ready = Some(ready.clone());
                inner.state = RelaySupervisorState::Incompatible;
                inner.user_message = "Relay protocol is incompatible with this Orbit build.".into();
                inner.technical_detail = Some(format!(
                    "Relay protocol {} is outside supported v1 range",
                    ready.protocol_version
                ));
                inner.last_state_change_ms = now_ms();
            }
            self.emit_status(app);
            return;
        }

        {
            let mut inner = match self.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            inner.ready = Some(ready);
            inner.state = RelaySupervisorState::AwaitingReady;
            inner.user_message = "Relay is ready; checking health...".into();
            inner.technical_detail = None;
            inner.last_state_change_ms = now_ms();
        }
        self.emit_status(app);

        let supervisor = self.clone();
        let app = app.cloned();
        thread::spawn(move || supervisor.negotiate(app.as_ref()));
    }

    fn negotiate(&self, app: Option<&RelayAppHandle>) {
        let health = self.request_with_timeout("relay.health", Value::Null, REQUEST_TIMEOUT);
        let capabilities =
            self.request_with_timeout("relay.capabilities", Value::Null, REQUEST_TIMEOUT);

        match (health, capabilities) {
            (Ok(health), Ok(capabilities)) => {
                let methods = capabilities
                    .get("methods")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let missing = missing_required_methods(&methods);
                let health_ok = health.get("status").and_then(Value::as_str) == Some("ok");
                {
                    let mut inner = match self.inner.lock() {
                        Ok(inner) => inner,
                        Err(_) => return,
                    };
                    inner.health = Some(health);
                    inner.capabilities = Some(capabilities);
                    inner.missing_methods = missing.clone();
                    inner.state = if health_ok && missing.is_empty() {
                        RelaySupervisorState::Ready
                    } else {
                        RelaySupervisorState::Degraded
                    };
                    inner.user_message = if health_ok && missing.is_empty() {
                        "Relay is ready.".into()
                    } else if !health_ok {
                        "Relay is unhealthy.".into()
                    } else {
                        "Relay is missing required capabilities.".into()
                    };
                    inner.technical_detail = if missing.is_empty() {
                        None
                    } else {
                        Some(format!("Missing methods: {}", missing.join(", ")))
                    };
                    inner.last_state_change_ms = now_ms();
                }
                self.emit_status(app);
                if missing.is_empty() {
                    self.emit_simple(EVENT_RELAY_RECOVERED, app);
                }
            }
            (Err(error), _) | (_, Err(error)) => {
                self.transition(
                    RelaySupervisorState::Degraded,
                    "Relay health negotiation failed.",
                    Some(error.display_message()),
                    app,
                );
            }
        }
    }

    fn complete_pending(&self, key: &str, result: Result<Value, RelayClientError>) {
        let pending = self.pending.lock().ok().and_then(|mut p| p.remove(key));
        if let Some(pending) = pending {
            let _ = pending.tx.send(result);
        } else {
            self.push_diagnostic(
                format!("Relay returned response for unknown id {key}"),
                None,
            );
        }
    }

    fn mark_exit(&self, pid: u32, code: Option<i32>, app: Option<&RelayAppHandle>) {
        let should_emit = {
            let mut inner = match self.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            if inner.pid != Some(pid) {
                return;
            }
            inner.pid = None;
            inner.process = None;
            inner.writer = None;
            inner.ready = None;
            inner.health = None;
            inner.capabilities = None;
            inner.missing_methods.clear();
            inner.last_exit_code = code;
            inner.last_state_change_ms = now_ms();
            if inner.state == RelaySupervisorState::ShuttingDown {
                inner.state = RelaySupervisorState::Stopped;
                inner.user_message = "Relay is stopped.".into();
                inner.technical_detail = None;
            } else {
                inner.state = RelaySupervisorState::Degraded;
                inner.user_message = "Relay exited unexpectedly.".into();
                inner.technical_detail = Some(format!(
                    "Relay process exited with code {}",
                    code.map_or_else(|| "unknown".into(), |c| c.to_string())
                ));
            }
            true
        };

        self.clear_pending(RelayClientError::plain(format!(
            "Relay exited with code {}",
            code.map_or_else(|| "unknown".into(), |c| c.to_string())
        )));
        if should_emit {
            self.emit_status(app);
            #[cfg(not(test))]
            if let Some(app) = app {
                let _ = app.emit(EVENT_RELAY_EXITED, self.status());
            }
        }
    }

    fn transport_failed(&self, detail: String, app: Option<&RelayAppHandle>) {
        self.transition(
            RelaySupervisorState::Degraded,
            "Relay transport failed.",
            Some(detail.clone()),
            app,
        );
        self.clear_pending(RelayClientError::plain(detail));
    }

    fn protocol_failed(&self, detail: impl Into<String>, app: Option<&RelayAppHandle>) {
        let detail = detail.into();
        self.push_diagnostic(format!("Relay protocol error: {detail}"), app);
        self.transition(
            RelaySupervisorState::Degraded,
            "Relay protocol stream is invalid.",
            Some(detail.clone()),
            app,
        );
        self.clear_pending(RelayClientError::plain(detail));
    }

    fn transition(
        &self,
        state: RelaySupervisorState,
        user_message: impl Into<String>,
        technical_detail: Option<String>,
        app: Option<&RelayAppHandle>,
    ) {
        {
            let mut inner = match self.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            inner.state = state;
            inner.user_message = user_message.into();
            inner.technical_detail = technical_detail;
            inner.last_state_change_ms = now_ms();
        }
        self.emit_status(app);
    }

    fn clear_pending(&self, error: RelayClientError) {
        let pending = self
            .pending
            .lock()
            .map(|mut p| p.drain().map(|(_, pending)| pending).collect::<Vec<_>>())
            .unwrap_or_default();
        for request in pending {
            let _ = request.tx.send(Err(RelayClientError {
                message: format!("{}: {}", request.method, error.message),
                ..error.clone()
            }));
        }
    }

    fn max_message_bytes(&self) -> usize {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| {
                inner
                    .ready
                    .as_ref()
                    .and_then(|ready| ready.max_request_line_bytes)
            })
            .unwrap_or(MAX_MESSAGE_BYTES)
            .min(MAX_MESSAGE_BYTES)
    }

    fn push_diagnostic(&self, line: String, app: Option<&RelayAppHandle>) {
        {
            let mut inner = match self.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            inner.diagnostics.push_back(line);
            while inner.diagnostics.len() > MAX_DIAGNOSTIC_LINES {
                inner.diagnostics.pop_front();
            }
        }
        #[cfg(not(test))]
        if let Some(app) = app {
            let _ = app.emit(EVENT_RELAY_DIAGNOSTICS_UPDATED, self.status());
        }
        #[cfg(test)]
        let _ = app;
    }

    fn kill_owned_process(&self, pid: u32) {
        let process = self.inner.lock().ok().and_then(|inner| {
            if inner.pid == Some(pid) {
                inner.process.clone()
            } else {
                None
            }
        });
        if let Some(process) = process {
            if let Ok(mut child) = process.lock() {
                let _ = child.kill();
            }
        }
    }

    fn emit_status(&self, app: Option<&RelayAppHandle>) {
        #[cfg(not(test))]
        if let Some(app) = app {
            let _ = app.emit(EVENT_RELAY_STATE_CHANGED, self.status());
        }
        #[cfg(test)]
        let _ = app;
    }

    fn emit_notification(&self, method: &str, params: Value, app: Option<&RelayAppHandle>) {
        #[cfg(test)]
        {
            let _ = (method, params, app);
            return;
        }
        #[cfg(not(test))]
        {
            let Some(app) = app else {
                return;
            };
            let event = match method {
                "session.started" => Some(EVENT_RELAY_SESSION_STARTED),
                "session.completed" => Some(EVENT_RELAY_SESSION_COMPLETED),
                "session.failed" => Some(EVENT_RELAY_SESSION_FAILED),
                "session.stopped" => Some(EVENT_RELAY_SESSION_STOPPED),
                "handoff.created" => Some(EVENT_RELAY_HANDOFF_CREATED),
                "session.changed" => Some("relay-session-changed"),
                "agent.statusChanged" => Some("relay-agent-status-changed"),
                _ => None,
            };
            if let Some(event) = event {
                let _ = app.emit(event, params);
            }
        }
    }

    fn emit_simple(&self, event: &str, app: Option<&RelayAppHandle>) {
        #[cfg(not(test))]
        if let Some(app) = app {
            let _ = app.emit(event, json!({ "atMs": now_ms() }));
        }
        #[cfg(test)]
        let _ = (event, app);
    }
}

fn read_protocol_line(
    reader: &mut BufReader<std::process::ChildStdout>,
    max_bytes: usize,
) -> Result<Option<String>, String> {
    let mut bytes = Vec::new();
    let read = reader
        .read_until(b'\n', &mut bytes)
        .map_err(|e| e.to_string())?;
    if read == 0 {
        return Ok(None);
    }
    if bytes.len() > max_bytes {
        return Err("Relay stdout frame exceeds configured client limit".into());
    }
    while matches!(bytes.last(), Some(b'\n' | b'\r')) {
        bytes.pop();
    }
    if bytes.is_empty() {
        return Ok(Some(String::new()));
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|e| format!("Relay stdout was not UTF-8: {e}"))
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

    #[test]
    fn fresh_status_is_stopped() {
        let supervisor = RelaySupervisor::default();
        let status = supervisor.status();
        assert_eq!(status.state, RelaySupervisorState::Stopped);
        assert_eq!(status.pending_requests, 0);
    }

    #[test]
    fn request_fails_when_not_ready() {
        let supervisor = RelaySupervisor::default();
        let error = supervisor.request("relay.health", Value::Null).unwrap_err();
        assert!(error.display_message().contains("not running"));
    }

    #[test]
    fn diagnostics_are_bounded() {
        let supervisor = RelaySupervisor::default();
        for index in 0..150 {
            supervisor.push_diagnostic(format!("line {index}"), None);
        }
        let status = supervisor.status();
        assert_eq!(status.diagnostics.len(), MAX_DIAGNOSTIC_LINES);
        assert_eq!(
            status.diagnostics.first().map(String::as_str),
            Some("line 50")
        );
    }

    #[test]
    fn certified_sidecar_reaches_ready_and_answers_health() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(relay_manifest::SIDECAR_FILE_NAME);
        let sha = relay_manifest::file_sha256(&path).expect("certified sidecar hash");
        let temp = std::env::temp_dir().join(format!(
            "orbit-relay-supervisor-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(&temp).expect("isolated Relay home");

        let supervisor = RelaySupervisor::default();
        let mut command = Command::new(&path);
        command
            .args(["rpc", "--stdio"])
            .env("ORBIT_RELAY_HOME", &temp);
        supervisor
            .start_command(command, None, path.display().to_string(), sha)
            .expect("start certified Relay sidecar");

        let deadline = Instant::now() + Duration::from_secs(6);
        let mut final_status = supervisor.status();
        while Instant::now() < deadline {
            final_status = supervisor.status();
            if final_status.state == RelaySupervisorState::Ready {
                break;
            }
            if matches!(
                final_status.state,
                RelaySupervisorState::Failed | RelaySupervisorState::Incompatible
            ) {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(
            final_status.state,
            RelaySupervisorState::Ready,
            "Relay did not reach ready state: {:?} {:?}",
            final_status.state,
            final_status.technical_detail
        );

        let health = supervisor
            .request_with_timeout("relay.health", Value::Null, Duration::from_secs(2))
            .expect("health request through supervisor");
        assert_eq!(health.get("status").and_then(Value::as_str), Some("ok"));

        let _ = supervisor.shutdown_with_timeout(Duration::from_millis(500), None);
        let _ = std::fs::remove_dir_all(&temp);
    }
}
