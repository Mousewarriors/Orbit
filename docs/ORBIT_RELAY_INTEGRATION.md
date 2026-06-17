# Orbit Relay Integration

Orbit integrates Orbit Relay v1.1 as a certified native sidecar. The renderer never
talks to Relay directly and never receives raw shell, argv, cwd, or unrestricted
JSON-RPC access.

## Certified Sidecar

- Source release: `C:\OrbitRelay\dist\release\orbit-relay-x86_64-pc-windows-msvc.exe`
- Bundled path: `apps/desktop/src-tauri/binaries/orbit-relay-x86_64-pc-windows-msvc.exe`
- Tauri bundle entry: `"externalBin": ["binaries/orbit-relay"]`
- Relay version: `0.1.0`
- Protocol version: `1.1.0`
- Compatibility range: `>=1.0.0 <2.0.0`
- Certified commit: `a1ac82ada113d72533a599d9fafaded95b562bdc`
- SHA-256: `F092C9F798F5CE43E6904855709366F4432A595BE00A4EBBAFC14F13913925B3`

Runtime resolution is native-only. Orbit first looks next to the app executable
for Tauri's packaged `orbit-relay.exe`, then for the target-suffixed name, then
falls back to `src-tauri/binaries` in development. It verifies the SHA-256 before
spawning `orbit-relay rpc --stdio`.

## Native Boundary

The Rust supervisor owns:

- sidecar resolution and checksum verification
- spawning Relay with piped stdin/stdout/stderr
- newline-delimited JSON-RPC 2.0 framing
- `relay.ready` gating
- protocol-major compatibility checks
- health/capabilities negotiation
- request ID generation and pending response correlation
- bounded request timeouts and diagnostics
- Relay notifications forwarded as Tauri events
- bounded shutdown/restart of the Relay process Orbit owns

Typed Tauri commands live in `commands.rs`. The frontend can call only the
allowlisted Relay methods exposed there.

## Launch Safety

Launch is always two-step:

1. `launch.plan` with `{ agentId, project }`
2. preview in the Agent Control Center
3. explicit user confirmation
4. `launch.execute` with `{ planId, confirm: true }`

`relay_execute_launch` rejects `confirm: false` before calling Relay. Orbit never
accepts executable, args, cwd, or command text from the renderer.

## UI Surface

The built-in command `Agent Control Center` opens `AgentCenterView`.

The view shows Relay status, agents, projects, inspection, launch preview,
confirmation, sessions, stop controls, and diagnostics. Session stop is enabled
only when Relay reports the session is safely stoppable.

## Verification

Focused checks:

```powershell
cargo check -p orbit-desktop --locked
cargo test -p orbit-desktop relay_ --locked
npm run typecheck --workspace @orbit/desktop
npm test
```

The Relay Rust test set includes a certified sidecar smoke test that reaches
`relay.ready` and answers `relay.health` through Orbit's supervisor.

## Project Scan Root

`projects.scan` always requires an explicit root — Relay does not accept a
rootless call and returns `Invalid_params (-32602)` if one is attempted.

Orbit enforces the root requirement locally:

1. On first mount, the Agent Control Center hydrates the scan root from the
   `relay.scan.root` setting key. If no persisted value exists the user's home
   directory (resolved by Tauri's trusted path resolver) is used as the default.
2. The Scan Projects button is disabled until hydration completes, Relay reaches
   `ready`, and the root field contains a non-empty path.
3. Before invoking `projects.scan` the root is trimmed. An empty result shows
   "Choose a project folder before scanning." locally — the raw Relay error is
   never exposed for this preventable case.
4. After a successful scan the trimmed root is persisted to `relay.scan.root`
   via the existing `set_setting` command. The value is restored on every
   subsequent launch, including after a Windows restart.
5. No automatic scan occurs on mount. The user must press **Scan** explicitly.

## Upgrade Procedure

1. Copy the new certified Relay executable into `apps/desktop/src-tauri/binaries`.
2. Update `relay_manifest.rs` version/protocol/commit/checksum constants.
3. Keep `tauri.conf.json` `externalBin` pointed at the unsuffixed logical name.
4. Run the focused checks above plus the desktop build.
5. Update this document and troubleshooting notes with any protocol changes.
