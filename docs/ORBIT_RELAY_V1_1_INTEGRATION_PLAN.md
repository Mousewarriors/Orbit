# Orbit Relay v1.1 Integration Plan

Created: 2026-06-16

## Source Of Truth Read

Relay references read before implementation:

- `C:\OrbitRelay\CLAUDE_HANDOFF_V1_1.md`
- `C:\OrbitRelay\ORBIT_INTEGRATION_CHECKLIST.md`
- `C:\OrbitRelay\DEGRADED_STATE_MATRIX.md`
- `C:\OrbitRelay\PROTOCOL.md`
- `C:\OrbitRelay\SECURITY.md`
- `C:\OrbitRelay\ARCHITECTURE.md`
- `C:\OrbitRelay\DEVELOPMENT.md`
- `C:\OrbitRelay\FEATURE_MATRIX.md`
- `C:\OrbitRelay\dist\release\manifest.json`
- `C:\OrbitRelay\dist\release\certification-report.json`
- TypeScript SDK: `C:\OrbitRelay\sdk\typescript\src\index.ts`, `test\client.test.ts`
- Fault infrastructure: `C:\OrbitRelay\sdk\typescript\src\fault-server.ts`, `src\fault-scenarios.ts`
- Release scripts: `C:\OrbitRelay\scripts\package-release.ps1`, `certify-claude-integration.ps1`

Orbit references read before implementation:

- `CLAUDE.md`, `HANDOFF.md`, `README.md`, `FEATURE_MATRIX.md`
- `docs\architecture\ARCHITECTURE.md`, `DISTRIBUTION.md`, `AGENTOS_ADAPTER.md`
- `docs\security\SECURITY_MODEL.md`, `THREAT_MODEL.md`
- `package.json`, `Cargo.toml`
- `apps\desktop\package.json`
- `apps\desktop\src-tauri\Cargo.toml`
- `apps\desktop\src-tauri\tauri.conf.json`
- `apps\desktop\src-tauri\src\lib.rs`
- `apps\desktop\src-tauri\src\commands.rs`
- `apps\desktop\src-tauri\src\extension_host.rs`
- `apps\desktop\src\native.ts`
- `apps\desktop\src\App.tsx`

## Repository Audit

- Orbit branch: `codex/orbit-relay-v1.1-integration`.
- Orbit starting commit: `4026af0 wip: checkpoint autonomous Orbit build before Relay integration`.
- Relay branch: `codex/orbit-relay-v1.1-integration-hardening`.
- Relay certified commit: `a1ac82ada113d72533a599d9fafaded95b562bdc`.
- Relay repo status before changes: clean.
- Orbit package manager: npm workspaces, not pnpm on this machine.
- Orbit Cargo workspace members: `orbit-core`, `orbit-extensions`, `orbit-files`, `orbit-input`, `orbit-search`, `orbit-window-manager`, `orbit-desktop`.
- Desktop package: `apps/desktop`, Tauri 2, React 18, Vite.
- Resolved Tauri crate during baseline: `tauri v2.11.2`; desktop `Cargo.toml` currently depends on `tauri = "2"`.
- Tauri config: `apps/desktop/src-tauri/tauri.conf.json`.
- Command registration: `apps/desktop/src-tauri/src/lib.rs` `tauri::generate_handler![...]`.
- Managed native state: `commands::AppState` in `apps/desktop/src-tauri/src/commands.rs`.
- Frontend native boundary: `apps/desktop/src/native.ts`.
- Frontend state entry point: `apps/desktop/src/App.tsx`.
- Existing child-process support: `apps/desktop/src-tauri/src/extension_host.rs` spawns per-invocation Node extension children through `std::process::Command`.
- Existing agent/project/session surface: observational AgentOS sample extension only; no native Relay-backed launch control center exists yet.

## Baseline Verification Before Edits

Passed before edits:

- `npm run lint`
- `npm run typecheck`
- `npm test` (199 tests)
- `cargo test -p orbit-core -p orbit-extensions -p orbit-files -p orbit-input -p orbit-search -p orbit-window-manager` (108 lib tests)
- `cargo check --workspace`
- `npm run build:vite --workspace @orbit/desktop`

Pre-existing failures before edits:

- `cargo fmt --all --check` fails because existing Rust files are not rustfmt-formatted.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` fails on existing warnings in `orbit-window-manager`, `orbit-search`, `orbit-input`, and `orbit-files`.

The final gate requires addressing these formatting and clippy issues or explicitly recording any remaining gate exception. Because they block the requested final certification, cleanup may be included as a bounded verification slice.

## Certified Relay Release

- Source artifact: `C:\OrbitRelay\dist\release\orbit-relay-x86_64-pc-windows-msvc.exe`.
- Standard artifact: `C:\OrbitRelay\dist\release\orbit-relay.exe`.
- Expected SHA-256 for both: `F092C9F798F5CE43E6904855709366F4432A595BE00A4EBBAFC14F13913925B3`.
- Manifest reports Relay version `0.1.0`, protocol `1.1.0`, minimum client protocol `1.0.0`, compatibility range `>=1.0.0 <2.0.0`.
- Certification report passed checksums, manifest, `relay.ready`, `relay.health`, `relay.capabilities`, fake `launch.plan`, TypeScript SDK tests, 18 fault scenarios, packaged conformance.

## Integration Boundary

Orbit owns presentation, navigation, selection, preview, confirmation, UI state, typed IPC, events, diagnostics, restart controls, and integration with existing launcher/settings surfaces.

Relay owns executable discovery, project scanning and inspection, launch planning, plan expiry/tamper checks, process launch, argument handling, ownership, session truth, stop authorization, handoffs, operational store, JSON-RPC framing, compatibility data, and fault semantics.

Orbit must not duplicate Relay's local-agent discovery, project scanner, launch-plan validator, process ownership checks, handoff validator, operational journal, or protocol fixtures.

## Sidecar Placement And Packaging

Tauri 2 sidecars use `bundle.externalBin`, with the configured path relative to `src-tauri/tauri.conf.json` and an actual platform-suffixed executable on disk. For this app:

- Controlled source in Orbit: `apps/desktop/src-tauri/binaries/orbit-relay-x86_64-pc-windows-msvc.exe`.
- Tauri config entry: `"externalBin": ["binaries/orbit-relay"]`.
- Runtime launch: Orbit resolves the packaged sidecar next to the app executable,
  falling back to `src-tauri/binaries` in development, then spawns it with
  `std::process::Command`.
- No Tauri shell plugin or frontend shell access is needed; Relay spawning stays
  native-only.

The certified sidecar will be copied from `C:\OrbitRelay\dist\release` only after verifying SHA-256. Orbit runtime code must never depend on `C:\OrbitRelay`. Tauri `externalBin` handles packaging, while Rust owns runtime path resolution and process spawning.

Relay metadata will live in a maintainable Rust module, likely `relay_manifest.rs`, containing expected version, protocol, target triple, checksum, sidecar logical name, and source-upgrade notes.

Upgrade procedure:

1. Copy a new certified Relay release into a staging path.
2. Verify release manifest and executable SHA-256.
3. Replace `apps/desktop/src-tauri/binaries/orbit-relay-<target>.exe`.
4. Update Orbit's expected version/checksum constants and docs.
5. Run transport, fault, app, and packaging gates.
6. Commit the sidecar and checksum metadata together.

## Checksum Verification

There are two verification layers:

- Build/release verification: a script/test checks the bundled sidecar file against the expected SHA-256 and fails if mismatched.
- Runtime status: Relay status includes sidecar checksum state where practical. Development mismatch and missing-sidecar states become degraded and launches are blocked.

Runtime should not perform heavy hashing on every hot path. It can hash during supervisor startup/restart and cache the result.

## Relay Supervisor Lifecycle

Add one cohesive Rust supervisor, likely `apps/desktop/src-tauri/src/relay_supervisor.rs`, owned by `AppState`.

Responsibilities:

- Spawn sidecar with `rpc --stdio`.
- Prevent duplicate instances from Orbit.
- Consume stdout and stderr separately.
- Parse complete-line JSONL frames.
- Wait for initial `relay.ready`.
- Validate protocol compatibility and advertised fields.
- Generate unique request IDs.
- Track pending requests.
- Correlate concurrent out-of-order responses.
- Dispatch notifications.
- Enforce request timeouts.
- Reject pending requests on timeout or process exit.
- Retain bounded diagnostics.
- Support controlled restart with bounded attempts/backoff.
- Shut down gracefully by closing stdin where possible; kill only the child Orbit owns if shutdown exceeds its bound.

Supervisor states:

- `stopped`
- `starting`
- `awaiting-ready`
- `ready`
- `degraded`
- `restarting`
- `incompatible`
- `failed`
- `shutting-down`

The state object should carry a human-facing summary, technical detail, ready payload, health result, capabilities result, diagnostics tail, process pid, last exit, and missing methods.

Startup point:

- Initialize `AppState` early as it is now.
- Start Relay after core Orbit state is managed and after tray/window setup is underway, without blocking app startup.
- Expose startup progress through `relay_status`.

Shutdown:

- Hook Tauri lifecycle exit/cleanup to request supervisor shutdown.
- Bound waiting.
- Avoid holding `AppState` locks during shutdown waits.

## JSON-RPC Transport Design

Protocol:

- UTF-8 newline-delimited JSON.
- One complete JSON object per line.
- No partial-message parsing beyond accumulating bytes until newline.
- Stdout is protocol-only.
- Stderr is diagnostics-only.
- Client request line limit defaults to Relay's advertised `maxRequestLineBytes`, capped at 1 MiB before ready.

Rust model:

- `RelayRequest { jsonrpc, id, method, params }`
- `RelayResponse::Success { id, result }`
- `RelayResponse::Failure { id, error }`
- `RelayNotification { method, params }`
- `RelayErrorPayload { code, name, message, data }`
- `RelayReady` with version, range, methods, notifications, capabilities.

Concurrency:

- Request IDs: `orbit-<monotonic counter>` or `orbit-<epoch>-<counter>`.
- Pending map key: exact JSON-RPC ID string.
- Pending entries contain response sender, method, deadline metadata.
- Writer path takes a short lock only to write/send; no lock is held while waiting for a response.
- Responses resolve by ID, not by order.
- Unknown response IDs are protocol errors and diagnostics.

Threading:

- The supervisor uses `std::process::Command` with piped stdin, stdout, and stderr.
- Reader threads consume stdout/stderr so output buffers never clog.
- A command channel serializes writes to child stdin.
- Graceful shutdown drops/closes stdin first, then performs a bounded kill of the
  owned child if it does not exit.

Compatibility:

- `relay.ready` must arrive before requests.
- Protocol major must be `1`.
- Required methods must include `relay.health`, `relay.capabilities`, `agents.list`, `agents.get`, `projects.scan`, `projects.inspect`, `launch.plan`, `launch.execute`, `sessions.list`, `sessions.get`, `sessions.stop`, `handoffs.create`, `handoffs.validate`, `events.list`.
- Missing required methods becomes degraded/partially capable; missing launch/session methods blocks launch controls.

## Tauri Command Boundary

Add typed commands, no raw unrestricted Relay bridge:

- `relay_status`
- `relay_health`
- `relay_capabilities`
- `relay_list_agents`
- `relay_get_agent`
- `relay_scan_projects`
- `relay_inspect_project`
- `relay_create_launch_plan`
- `relay_execute_launch`
- `relay_list_sessions`
- `relay_get_session`
- `relay_stop_session`
- `relay_create_handoff`
- `relay_validate_handoff`
- `relay_restart`

Input validation:

- Non-empty agent IDs, session IDs, plan IDs, handoff IDs.
- Bounded path strings.
- Canonicalization where Orbit needs to reason about paths; Relay remains authoritative for root policy.
- `relay_execute_launch` accepts only a Relay plan ID plus `confirm: true`; it must not accept executable, args, cwd, or command text from the frontend.
- If `confirm` is false or omitted, Rust rejects before calling Relay.

Events emitted to the renderer:

- `relay-state-changed`
- `relay-diagnostics-updated`
- `relay-exited`
- `relay-recovered`
- `relay-session-started`
- `relay-session-completed`
- `relay-session-failed`
- `relay-session-stopped`
- `relay-handoff-created`

Events should be typed at the native wrapper level in `native.ts`; renderer listeners should unregister on cleanup.

## Frontend Event Flow And State Model

Add native wrappers in `apps/desktop/src/native.ts` for all Relay commands and events.

Add a focused React surface rather than a developer-only page:

- `AgentCenterView` or `RelayControlCenterView`.
- It can be opened from a built-in command such as "Agent Control Center".
- It should live in the existing launcher view stack, alongside Clipboard, Snippets, Quicklinks, Notes, Extension list, All Commands.

State model:

- `relay`: status, explanation, diagnostics, health, capabilities.
- `agents`: list, selected agent, loading/error.
- `projects`: scan results, selected project, inspection, loading/error.
- `launch`: current plan, preview, warnings, expiry, confirmation state, execute result/error.
- `sessions`: list, selected session, loading/error, stop-in-progress.

Fetch sequence:

1. On view open, call `relay_status`.
2. If ready, call/listen for health/capabilities and `agents.list`.
3. Scan projects through Relay only.
4. Inspect selected project through Relay only.
5. Create launch plan with selected agent/project.
6. Render returned preview.
7. Require explicit confirmation control.
8. Execute with `{ planId, confirm: true }`.
9. Refresh sessions and subscribe to session notifications.

No permanent spinners: every loading state must have a bounded error or degraded fallback.

## Launch Confirmation Enforcement

Frontend:

- `launch.execute` button is disabled until a current plan is present and the user explicitly confirms.
- Cancel clears the plan.
- Expired/tampered/rejected errors clear or invalidate the plan and prompt re-planning.

Rust:

- `relay_execute_launch(plan_id, confirm)` rejects unless `confirm == true`.
- Command signature must not accept executable, args, cwd, shell text, environment, or replacement path.

Relay:

- Remains authoritative for plan expiry, tamper protection, executable validation, argument handling, and launch rejection.

## Session Ownership Semantics

Relay is the source of truth for sessions.

Orbit UI displays:

- agent
- project
- status
- start/end times
- ownership
- stoppable state
- failure details

Stop button is enabled only when Relay data indicates the session is owned and stoppable. Detached sessions must be labelled as detached and not safely stoppable. Orbit must not infer ownership from PID alone, including after Relay restart.

After restart or crash, Orbit refreshes `sessions.list` and treats old sessions according to Relay's reconciled ownership.

## Degraded States And Recovery Policy

Map at least these conditions to clear UI states:

- bundled sidecar missing
- checksum mismatch
- spawn failure
- readiness timeout
- exit before ready
- incompatible protocol
- malformed stdout protocol line
- oversized stdout frame
- stderr diagnostics
- request timeout
- unexpected EOF/process exit
- child crash
- failed restart
- method unavailable
- store unavailable
- launch-plan expiry
- launch-plan tamper/replay rejection
- launch rejection
- process not owned
- session detached after Relay restart
- pending requests interrupted by exit

Recovery:

- Keep unrelated Orbit features usable.
- Preserve last-valid Relay cache for read-only display.
- Block launches when Relay is not ready/compatible.
- Allow manual restart when retry-safe.
- Use bounded automatic retry during startup only; avoid infinite loops.
- On restart success, re-run readiness negotiation, health, capabilities, agents, projects if visible, and sessions.

## Security Boundaries

Never add:

- arbitrary shell execution
- `Invoke-Expression`
- `eval`
- model-generated command concatenation
- raw generic Relay method exposed to the frontend without an allowlist
- direct Hermes/OpenClaw launch
- launch execute without plan and confirmation

Do:

- Validate all frontend input in Rust.
- Parse and validate all protocol messages.
- Keep stderr separate from JSON-RPC stdout.
- Bound diagnostics.
- Redact or avoid sensitive logs.
- Fail closed for protocol incompatibility and unsafe launch conditions.

## Modules And Files To Add Or Modify

Expected Rust additions:

- `apps/desktop/src-tauri/src/relay_manifest.rs`
- `apps/desktop/src-tauri/src/relay_protocol.rs`
- `apps/desktop/src-tauri/src/relay_supervisor.rs`
- `apps/desktop/src-tauri/src/relay_commands.rs` or Relay section in `commands.rs`
- `apps/desktop/src-tauri/binaries/orbit-relay-x86_64-pc-windows-msvc.exe`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/src/lib.rs`

Expected frontend additions:

- `apps/desktop/src/components/AgentCenterView.tsx`
- `apps/desktop/src/relayViewModel.ts` or similar pure helpers
- `apps/desktop/src/relayViewModel.test.ts`

Expected frontend modifications:

- `apps/desktop/src/native.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/builtins.ts`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/components/AllCommandsView.tsx` only if command browse needs Relay awareness.

Expected docs:

- `docs/ORBIT_RELAY_INTEGRATION.md`
- `docs/ORBIT_RELAY_TROUBLESHOOTING.md`
- Updates to `docs/architecture/ARCHITECTURE.md`, `docs/architecture/DISTRIBUTION.md`, `FEATURE_MATRIX.md`, and this plan.

## Test Strategy

Rust unit tests:

- readiness parsing
- compatibility decisions
- request ID generation
- concurrent response correlation
- timeout cleanup
- structured error mapping
- notification mapping
- bounded diagnostics
- pending rejection on exit
- launch confirmation enforcement
- stoppable-state helper
- path input validation
- checksum validation

Rust integration tests:

- real certified sidecar smoke: ready, health, capabilities.
- fault server scenarios: healthy, delayed ready, never ready, exit before ready, malformed stdout, stderr noise, protocol incompatible, method timeout, request error, notification burst, out-of-order responses, oversized message, store unavailable, agent unavailable, project outside roots, plan expired, session failed.
- paths with spaces and Unicode where Relay supports the operation.

Frontend tests:

- status rendering
- degraded/unavailable states
- agent list
- project list/inspection
- launch preview
- explicit confirmation/cancel
- session display
- disabled stop for detached/unowned
- restart controls
- no false success state

End-to-end/manual-safe smoke:

- Start Orbit with bundled Relay.
- Confirm `relay.ready`, health, capabilities.
- Use temporary project and harmless fake agent data where Relay can discover it.
- Request plan, show preview, confirm, execute harmless launch, see session, observe lifecycle.
- Confirm shutdown leaves no unwanted owned Relay process.

Packaging proof:

- `npm run build --workspace @orbit/desktop`
- Inspect produced bundle/installer for sidecar inclusion.
- Smoke launch packaged app or sidecar path resolution where practical.

## Ordered Implementation Phases

1. Plan and record baseline.
2. Verify/copy certified sidecar and wire Tauri `externalBin`.
3. Add Relay protocol types, checksum verifier, and compatibility helpers.
4. Add supervisor transport and state machine.
5. Add typed Tauri commands and frontend wrappers.
6. Add Agent Control Center view with status, agents, projects, preview/confirm launch, sessions, stop/restart.
7. Add degraded-state and recovery tests using fault server.
8. Add docs and upgrade/troubleshooting notes.
9. Run full gates and production packaging.
10. Verify `C:\OrbitRelay` remains clean.

## Rollback Plan

- Revert Relay-specific commits only.
- Remove `bundle.externalBin` entry and sidecar binary if packaging breaks.
- Leave unrelated Orbit features and existing extension/file/search behavior untouched.
- Because Relay state is external to Orbit's SQLite, rollback should not require DB migrations unless a later phase adds Orbit-side persistence.

## Acceptance Criteria

- Certified sidecar is bundled and checksum-matched.
- Orbit does not require `C:\OrbitRelay` at runtime.
- Relay starts with `rpc --stdio`.
- `relay.ready` gates readiness.
- Protocol compatibility is validated.
- Concurrent requests correlate by ID.
- Notifications update UI state.
- Stderr is diagnostics-only.
- Agents/projects/inspection/launch/sessions come from Relay.
- Launch requires plan preview and explicit confirmation.
- Rust command layer rejects unconfirmed execution.
- Stop is enabled only for Relay-owned stoppable sessions.
- Degraded states are visible and recoverable where safe.
- Pending requests are rejected on timeout/exit.
- Shutdown is bounded and avoids duplicate owned Relay processes.
- Existing Orbit features continue to pass tests.
- Production Tauri build includes the sidecar and resolves it without `C:\OrbitRelay`.
- Docs match the implementation.
- `C:\OrbitRelay` remains clean.

## Known Risks And Mitigations

- Existing Rust fmt/clippy gates are red before Relay work. Mitigation: include bounded cleanup or record as a blocker; do not mix semantic Relay work with broad formatting unless needed for final gates.
- Tauri shell plugin sidecar child may not expose a direct stdin-close API. Mitigation: test shutdown behavior early; if needed, use Tauri sidecar packaging for bundling and carefully resolve the sidecar path for `std::process` while documenting why.
- Full production Tauri build can be slow and depends on local bundlers. Mitigation: run after focused gates pass, record exact artifact path or blocker.
- Real local agent discovery depends on the machine environment. Mitigation: use Relay's fake-agent-safe certification patterns and fault server for automated tests.
- UI scope can expand quickly. Mitigation: ship a focused Agent Control Center within the existing launcher stack before adding broader AgentOS redesign.
