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

Defence-in-depth: validation exists in TS **and** the native layer re-checks
(e.g. `open_url` independently rejects non-http(s)/mailto schemes).

## Planned controls

- **Secret vault** in OS secure storage (Windows Credential Manager / macOS
  Keychain); secrets never enter renderer state or logs (redaction).
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
