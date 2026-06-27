# Security Model

Orbit executes OS actions, will run third-party extensions and MCP servers, and
handles secrets. Security is therefore a first-class concern. This document
describes the threat model and the controls — both implemented and planned.

## Trust boundaries

1. **Renderer → Native.** The renderer is treated as semi-trusted (it runs our
   own code but loads remote content in future AI/extension views). All native
   capability is behind the IPC surface in `commands.rs`, each command
   validating inputs and returning `Result<_, String>`. A strict CSP is set in
   `tauri.conf.json`.
2. **Host → Extension** (planned). Extensions run in an isolated child process
   with permission-scoped APIs and per-extension storage; JS sandboxing alone is
   never relied upon — OS process isolation + a permission broker is the boundary.
3. **External input → Orbit.** Deeplinks, browser content, clipboard data, file
   contents and tool output are **untrusted**.

## Threats considered

Malicious extension / compromised update; malicious MCP server; prompt injection
via retrieved content; clipboard-secret leakage; deeplink/command/path/SQL
injection; secret exposure in logs or renderer; updater compromise;
cross-extension data access; AI tool misuse.

## Implemented controls (this build)

| Control | Where |
| --- | --- |
| Deeplinks parse to a small **allowlist** of validated routes; no generic "run arbitrary command" route | `validation/deeplink.ts` (tested) |
| Path-traversal rejection & root containment | `validation/safety.ts::isPathWithin` / `isSafeRelativePath` |
| Shell-metacharacter rejection for any unavoidable shell arg | `validation/safety.ts::isSafeShellArgument` |
| External URL scheme allowlist (http/https/mailto only) | `validation/safety.ts` + `open_url` command (native re-check) |
| **No `eval`** anywhere; calculator is a hand-written recursive-descent parser | `calculator/parser.ts` |
| Manifest hardening: bounded lengths, constrained identifiers, no `..`/absolute icon paths, enumerated permissions | `validation/manifest.ts` (tested) |
| Native commands validate inputs and never interpolate into a shell (apps launched via OS opener with a trusted indexed path) | `commands.rs::launch_path` / `open_url` |
| Activation shortcut is parsed/validated before (re)registration; an invalid or already-claimed accelerator returns a clear error and leaves the previous binding intact | `commands.rs::set_activation_shortcut` |
| Settings is a second webview of the **same** bundle/origin under the same CSP; it reaches native only through the typed IPC surface (no extra origin trust) | `open_settings` + `main.tsx` hash route |
| Snippet keyboard hook never logs/persists raw keystrokes; the buffer holds only the trailing chars needed to match a keyword and resets on focus/navigation breaks; self-injected events are tagged and ignored | `snippet_watcher.rs` + `orbit_input::trigger` |
| Clipboard capture is user-disableable and honoured live; nothing leaves the device | `clipboard_monitor.rs` (`privacy.clipboard.enabled`) |
| Extensions run as isolated child processes (never in the renderer/host); they affect Orbit only via a versioned, schema-validated RPC | `extension_host.rs` + `orbit-extensions::protocol` |
| Extension effects + item actions are permission-brokered against the manifest (undeclared ⇒ dropped, never performed) | `orbit-extensions::permission` (tested) |
| Extension storage is namespaced per extension; no cross-extension reads/writes | `orbit-core::extstore` (tested) |
| Crash-loop protection auto-disables a repeatedly failing/hanging extension; invocations time out and the child is killed | `orbit-extensions::crash` + `extension_host` |
| Extension manifests are validated host-side (bounded fields, safe ids, no traversal in `main`, known permissions/modes) | `orbit-extensions::manifest` (tested) |
| Provider/OAuth credentials live in OS secure storage only; native secret access accepts only known provider/OAuth key names plus a narrow `mcp.server:<id>.(token\|apikey\|oauth)` pattern for schema-referenced MCP credentials, and chunks large token sets without writing them to settings | `secrets.rs` + provider settings/loaders (tested) |

Defence-in-depth: validation exists in TS **and** the native layer re-checks
(e.g. `open_url` independently rejects non-http(s)/mailto schemes).

**Residual risks (this build):** the snippet LL keyboard hook is a high-privilege
surface — it is **opt-in / off by default**, has a controllable lifecycle, and
cannot inject into higher-integrity (elevated) windows from a non-elevated Orbit
(a Windows boundary we deliberately do not bypass). The local SQLite store
(clipboard/snippets/notes/extension storage) is **not yet encrypted at rest**.
**Extensions are process-isolated but not yet OS-sandboxed**: the child has the
privileges of `node` (run from PATH), so the broker governs what *Orbit* does on
the extension's behalf, not what the child process can do directly (fs/network).
OS sandboxing (AppContainer / job objects), a bundled runtime, and an extension
secrets API are tracked as future work (see
[../architecture/EXTENSION_RUNTIME.md](../architecture/EXTENSION_RUNTIME.md)).

## Planned controls

- Broaden secret redaction coverage in every future export/logging surface as
  new diagnostics are added.
- **Permission broker** in Rust enforcing manifest-declared permissions per
  extension; graceful permission-denied states.
- **Extension isolation**: child-process execution, memory/time limits, crash
  detection with automatic disablement after repeated crashes.
- **Signed updates** with manifest signature verification; DB backup before
  risky migrations.
- **AI tool gating**: validate tool name/args, confirm destructive actions,
  budgets/step limits, treat retrieved content as data not instructions.
- **OAuth 2.0 + PKCE** for desktop extensions; no confidential client secrets in
  public extensions.

See [THREAT_MODEL.md](THREAT_MODEL.md) for the attacker-goal breakdown.
