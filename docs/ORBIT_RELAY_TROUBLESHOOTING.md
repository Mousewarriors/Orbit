# Orbit Relay Troubleshooting

Open `Agent Control Center` and switch to `Diagnostics` first. It shows the
supervisor state, sidecar path, SHA-256, PID, missing methods, and stderr tail.

## Common States

- `stopped`: Relay is not running. Use Restart Relay.
- `awaiting-ready`: process spawned, waiting for `relay.ready`.
- `ready`: health and required capabilities passed.
- `degraded`: Relay started or answered but something is unsafe or incomplete.
- `incompatible`: Relay protocol major is not supported by this Orbit build.
- `failed`: sidecar could not be started or verified.
- `shutting-down`: Orbit is closing or restarting Relay.

## What To Check

- Missing sidecar: packaged builds should have `orbit-relay.exe` beside
  `orbit-desktop.exe`; development builds use
  `apps/desktop/src-tauri/binaries/orbit-relay-x86_64-pc-windows-msvc.exe`.
- Checksum mismatch: replace the binary with the certified release and update
  `relay_manifest.rs` only when the certification report changes.
- Ready timeout: run the sidecar manually with `rpc --stdio`; stdout must emit
  `relay.ready` as the first protocol message.
- Malformed stdout: Relay stdout must contain JSON-RPC lines only. Diagnostics
  belong on stderr.
- Incompatible protocol: Orbit accepts protocol major `1`; a `2.x` Relay requires
  an Orbit client update.
- Missing methods: `relay.capabilities` must advertise all required methods in
  `relay_protocol.rs`.
- Request timeout: check diagnostics for a blocked Relay store or long-running
  project scan.
- Store unavailable: Relay owns its operational store. Fix Relay's data directory
  permissions or restart with a valid `ORBIT_RELAY_HOME`.
- Plan expired: create a fresh launch plan and confirm that one.
- Detached session: Orbit will display it but will not stop it unless Relay marks
  it safely stoppable.

## Manual Sidecar Smoke

```powershell
apps/desktop/src-tauri/binaries/orbit-relay-x86_64-pc-windows-msvc.exe --version
```

For protocol smoke, prefer the automated Rust test:

```powershell
cargo test -p orbit-desktop relay_supervisor::tests::certified_sidecar_reaches_ready_and_answers_health --locked
```

## Recovery Rules

Orbit keeps non-Relay launcher features usable when Relay is degraded. Launches
stay blocked until Relay is ready, compatible, healthy, and advertising the
required launch/session methods.
