# Orbit Relay v1.1 Integration — Independent Audit Report

Date: 2026-06-17
Auditor: Claude Opus 4.8 (independent of the implementing model)
Branch: `claude/orbit-relay-v1.1-independent-audit`

## Scope

Independent audit of the Orbit Relay v1.1 integration into Orbit, covering:

- Commits `3871006` (integration) and `e286097` (project-root persistence fix)
- Base commit: `4026af0` (pre-integration checkpoint)
- Integration scope: 21 files changed, +3748 lines

Relay certified commit: `a1ac82ada113d72533a599d9fafaded95b562bdc`

## Architecture Summary

Orbit integrates the certified Relay binary as a Tauri `externalBin` sidecar. The Rust supervisor (`relay_supervisor.rs`) spawns the Relay process with `rpc --stdio`, manages its lifecycle over piped stdin/stdout/stderr, and exposes narrow typed Tauri commands to the React frontend. The frontend's Agent Control Center view provides agent selection, project scanning, launch planning with explicit confirmation, session management, and diagnostics.

Key boundary: Orbit owns presentation, navigation, and typed IPC. Relay owns executable discovery, project scanning, launch planning, process ownership, session truth, and JSON-RPC framing.

## Commits Reviewed

| Commit | Description |
|--------|-------------|
| `4026af0` | Pre-integration baseline |
| `3871006` | `feat: integrate certified Orbit Relay v1.1 into Orbit` |
| `e286097` | `fix(relay): persist and validate project scan root` |

## Evidence Gathered

### Baseline checks (all passed before audit edits)

| Check | Result |
|-------|--------|
| `npm run lint` | Pass (0 warnings) |
| `npm run typecheck` | Pass (10 workspaces) |
| `npm test` (Vitest) | 227/227 pass |
| `cargo test -p orbit-desktop --locked` | 35/35 pass, 1 ignored |
| `cargo check --workspace --locked` | Pass |
| `cargo fmt --all --check` | **Fails** — pre-existing, not introduced by integration |
| `cargo clippy -p orbit-desktop` | Warnings only in `relay_supervisor.rs` (test-cfg `clone_on_copy`, needless `return`) and pre-existing crates |

### Sidecar checksum verification

| Artifact | SHA-256 |
|----------|---------|
| Certified source (`C:\OrbitRelay\dist\release\orbit-relay-x86_64-pc-windows-msvc.exe`) | `F092C9F798F5CE43E6904855709366F4432A595BE00A4EBBAFC14F13913925B3` |
| Bundled in Orbit (`apps/desktop/src-tauri/binaries/orbit-relay-x86_64-pc-windows-msvc.exe`) | `F092C9F798F5CE43E6904855709366F4432A595BE00A4EBBAFC14F13913925B3` |
| Packaged in release (`target/release/orbit-relay.exe`) | `F092C9F798F5CE43E6904855709366F4432A595BE00A4EBBAFC14F13913925B3` |
| Expected constant in `relay_manifest.rs` | `F092C9F798F5CE43E6904855709366F4432A595BE00A4EBBAFC14F13913925B3` |
| **All match** | **Yes** |

### Runtime `C:\OrbitRelay` dependency scan

Only 2 files reference `C:\OrbitRelay`:
- `docs/ORBIT_RELAY_INTEGRATION.md` — documentation only
- `docs/ORBIT_RELAY_V1_1_INTEGRATION_PLAN.md` — documentation only

**No runtime, build-time, or test dependency on `C:\OrbitRelay`.** The production application resolves the sidecar from `externalBin` packaging only.

### Manual JSON-RPC smoke test

Spawned the bundled sidecar with `rpc --stdio` and isolated `ORBIT_RELAY_HOME`:

```
READY protocolVersion= 1.1.0 impl= 0.1.0 maxLine= 1048576
READY methods count= 14 minClient= 1.0.0
OK relay.health => {"status":"ok","storeHealthy":true,...}
OK relay.capabilities => {"adapters":["codex-cli","claude-code-cli",...]}
```

### Production build

| Artifact | Path | Size |
|----------|------|------|
| Release executable | `target\release\orbit-desktop.exe` | 6.12 MB |
| Packaged sidecar | `target\release\orbit-relay.exe` | 0.77 MB |
| MSI installer | `target\release\bundle\msi\Orbit_0.1.0_x64_en-US.msi` | 3.21 MB |
| NSIS installer | `target\release\bundle\nsis\Orbit_0.1.0_x64-setup.exe` | 2.41 MB |

## Findings by Severity

### BLOCKER

None found.

### HIGH

None found.

### MEDIUM

#### M1: `status()` panicked on poisoned mutex (FIXED)

**Location:** `relay_supervisor.rs:200`
**Before:** `self.inner.lock().expect("relay supervisor mutex")`
**Risk:** If any supervisor thread panics while holding the inner lock, `status()` would crash the entire Tauri application. Called from the `relay_status` Tauri command on every frontend poll.
**Fix:** Changed to `match self.inner.lock() { Ok(inner) => inner, Err(poisoned) => poisoned.into_inner() }` — recovers the data even from a poisoned mutex.
**Realistic risk:** Low in practice (no code under the lock can panic in normal operation), but the fix is defensive and zero-cost.
**Regression test:** `status_survives_poisoned_mutex` — intentionally poisons the mutex and verifies `status()` still returns without panic.

### LOW

#### L1: Clippy `clone_on_copy` in test cfg (FIXED)

**Location:** `relay_supervisor.rs:350-353`
**Issue:** `app.clone()` calls on `Option<()>` (test-only type alias for `RelayAppHandle`). In production builds, `RelayAppHandle = AppHandle` requires `clone()`.
**Fix:** Added `#[allow(clippy::clone_on_copy)]` on `start_command`.

#### L2: Needless `return` in test-cfg block (FIXED)

**Location:** `relay_supervisor.rs:990`
**Issue:** `return;` at end of `#[cfg(test)]` block in `emit_notification` was unnecessary since the following `#[cfg(not(test))]` block is excluded at compile time.
**Fix:** Removed the `return`.

#### L3: `start()` TOCTOU window

**Location:** `relay_supervisor.rs:232-244`
**Issue:** `start()` checks state under lock, drops lock, performs sidecar resolution + SHA-256 verification, then calls `start_command` which re-acquires the lock. A concurrent call between the check and the `start_command` lock acquisition could theoretically start two Relay processes.
**Realistic risk:** Negligible — `start()` is called only from Tauri's `setup()` closure (single thread) and `restart()` (which transitions to `Restarting` first, blocking the duplicate check). No user-reachable concurrent path exists.
**Action:** No fix needed; documented for awareness.

#### L4: `negotiate()` calls `relay.health` and `relay.capabilities` sequentially

**Location:** `relay_supervisor.rs:752-755`
**Issue:** Both calls could be made concurrently to reduce startup latency.
**Realistic impact:** ~10ms additional startup time. Not a correctness issue.
**Action:** No fix; documented as a future optimization.

#### L5: `cargo fmt --all --check` fails

**Pre-existing:** The integration plan's baseline recorded this failure before any Relay work. The Relay-specific modules (`relay_supervisor.rs`, `relay_protocol.rs`, `relay_manifest.rs`) are individually fmt-clean. The `commands.rs` deviations are in pre-existing non-Relay code.
**Action:** Not addressed — outside audit scope.

### SUGGESTION

#### S1: `loadInitialRelayData` couples Relay RPC errors with root hydration

**Location:** `AgentCenterView.tsx:189-206`
**Observation:** If `refreshAgents()` throws (e.g. Relay not ready), the root-hydration code (`getSetting`/`getHomeDir`) is still reached because it's after the three refresh calls in the same `try`. But if `refreshStatus()` throws, agents and sessions won't be refreshed. The `finally` block always sets `rootHydrated = true`, which is correct.
**Impact:** Minor — when Relay isn't ready, the agent list will be empty and a retry happens when Relay state changes via the event listener. Not a correctness defect.

#### S2: No automatic Relay restart on crash

**Observation:** Relay crash transitions to `Degraded` state, requiring the user to manually press "Restart Relay". An automatic bounded retry (e.g., 1 attempt with backoff) could improve UX.
**Action:** Not implemented — the integration plan explicitly chose user-triggered restart to avoid infinite loops. Documenting as a future consideration.

### FALSE POSITIVE

None — all findings inspected were confirmed.

## Fixes Made

| Fix | File | Lines | Severity |
|-----|------|-------|----------|
| Poisoned-mutex recovery in `status()` | `relay_supervisor.rs` | 200-203 | MEDIUM |
| `#[allow(clippy::clone_on_copy)]` on `start_command` | `relay_supervisor.rs` | 278 | LOW |
| Remove needless `return` in test cfg | `relay_supervisor.rs` | 990 | LOW |

## Tests Added

| Test | Location | What it covers |
|------|----------|----------------|
| `status_survives_poisoned_mutex` | `relay_supervisor.rs` | M1: verifies `status()` recovers from poisoned mutex |
| `clear_pending_rejects_all_waiters` | `relay_supervisor.rs` | Pending-request cleanup on exit/restart |
| `transition_updates_state_atomically` | `relay_supervisor.rs` | State transition correctness |
| `mark_exit_clears_ready_and_rejects_pending` | `relay_supervisor.rs` | No stale Ready after process exit; pending requests rejected |

## Test Results After Fixes

| Suite | Result |
|-------|--------|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass (10 workspaces) |
| `npm test` (Vitest) | 227/227 pass |
| `cargo test -p orbit-desktop --locked` | **39/39 pass** (+4 new), 1 ignored |
| `cargo clippy -p orbit-desktop` | **No warnings in relay modules** |
| Production Tauri build (MSI + NSIS) | Pass |
| Packaged sidecar checksum | Matches certified |

## Audit Area Coverage

### Area 1 — Sidecar integrity and packaging

- Bundled sidecar SHA-256 matches certified release: **PASS**
- Tauri `externalBin` includes sidecar in production builds: **PASS**
- Development sidecar resolution (`src-tauri/binaries/`): **PASS**
- Packaged sidecar resolution (next to exe): **PASS**
- Paths with spaces work (tested via "Simon Wood" path): **PASS**
- No runtime dependency on `C:\OrbitRelay`: **PASS**
- MSI and NSIS installers produced: **PASS**
- Version and checksum metadata accurate: **PASS**
- Upgrade procedure documented: **PASS** (`ORBIT_RELAY_INTEGRATION.md`)

### Area 2 — Relay supervisor lifecycle

- Process creation with piped stdio: **PASS**
- Binary SHA-256 verification before spawn: **PASS**
- Duplicate-instance prevention (state check): **PASS**
- Separate stdin writer thread: **PASS**
- Separate stdout reader thread: **PASS**
- Separate stderr reader thread: **PASS**
- Readiness timeout (5s) with kill: **PASS**
- Request timeout (10s) with pending cleanup: **PASS**
- State transitions: **PASS** (9 states, all reachable)
- EOF detection (stdout reader returns None): **PASS**
- Exit detection (polling exit watcher): **PASS**
- Pending-request cleanup on exit: **PASS** (tested)
- Restart via user action: **PASS**
- No infinite restart loop: **PASS** (no auto-restart)
- Shutdown: stdin close → bounded wait → kill: **PASS**
- `ExitRequested` and tray Quit trigger shutdown: **PASS**
- Diagnostics bounded (100 lines): **PASS** (tested)
- `CREATE_NO_WINDOW` flag on Windows: **PASS**

### Area 3 — JSON-RPC correctness

- Newline-delimited UTF-8 framing: **PASS**
- One complete JSON object per line: **PASS**
- Stderr never treated as protocol: **PASS** (separate reader)
- Unique request IDs (`orbit-<counter>`): **PASS**
- Concurrent in-flight requests supported: **PASS**
- Out-of-order responses correlated by ID: **PASS**
- Notifications separated from responses: **PASS**
- Unknown response IDs logged, not corrupt: **PASS**
- Oversized messages bounded (`max_request_line_bytes`): **PASS**
- Timed-out requests removed from pending: **PASS**
- Pending requests rejected after exit: **PASS** (tested)
- Protocol compatibility checked (`relay.ready`): **PASS**
- No raw method bridge exposed to frontend: **PASS**

### Area 4 — Tauri security boundary

- Operations are narrow and typed: **PASS** (16 specific commands)
- Frontend parameters validated: **PASS** (`validate_relay_id`, `validate_relay_path`)
- No arbitrary shell endpoint: **PASS**
- No unrestricted executable path: **PASS**
- No model-generated command execution: **PASS**
- No generic JSON-RPC passthrough: **PASS**
- `relay_execute_launch` rejects `confirm: false`: **PASS**
- Errors mapped without hiding security failures: **PASS**

### Area 5 — Launch safety

- Plan → preview → confirm → execute flow: **PASS**
- Execution requires plan ID + `confirm: true`: **PASS** (Rust + frontend)
- No execution without plan: **PASS** (`canExecuteLaunch` checks `planId`)
- Cancel clears plan and confirmation: **PASS**
- Keyboard cannot bypass confirmation (checkbox required): **PASS**
- Expired/consumed plan errors surface to user: **PASS**
- No automatic confirmation: **PASS**
- Warnings visible in preview: **PASS**
- Working directory visible in preview: **PASS**

### Area 6 — Sessions and ownership

- Sessions from Relay truth (`sessions.list`): **PASS**
- Stop enabled only for Relay-reported stoppable sessions: **PASS** (`canStopSession`)
- Detached sessions cannot be stopped via normal UI: **PASS**
- `process_not_owned` errors handled: **PASS**
- Notification-driven + refresh-driven updates: **PASS**

### Area 7 — Project-root persistence fix

- `projects.scan` never called without root: **PASS**
- Empty/whitespace roots rejected locally: **PASS** (23 tests)
- Root trimmed before submission: **PASS**
- Internal spaces preserved: **PASS** (tested)
- Unicode preserved: **PASS** (tested: `café`, `用户`, emoji)
- Home directory from Tauri trusted resolver: **PASS** (`app.path().home_dir()`)
- No hard-coded username: **PASS**
- Successful scan persists root: **PASS** (`setSetting(SCAN_ROOT_SETTING_KEY, ...)`)
- Persisted root restored on restart: **PASS** (`resolveInitialScanRoot`)
- Hydration completes before scan: **PASS** (`rootHydrated` gate)
- Failed scan does not destroy last good root: **PASS** (only saved on success)
- Scan button disabled during loading/invalid/scanning: **PASS** (`isScanDisabled`)
- Application does not auto-scan `C:\`: **PASS** (no mount-time scan)

### Area 8 — Degraded states

| Condition | Handled | UI State |
|-----------|---------|----------|
| Missing sidecar | Yes | Failed |
| Checksum mismatch | Yes | Failed (error message shows hashes) |
| Spawn failure | Yes | Failed |
| No `relay.ready` | Yes | AwaitingReady → Degraded (timeout) |
| Readiness timeout | Yes | Degraded (killed after 5s) |
| Incompatible protocol | Yes | Incompatible |
| Malformed stdout | Yes | Degraded (protocol error logged) |
| Stderr diagnostics | Yes | Captured, bounded (100 lines) |
| Request timeout | Yes | Error returned to caller |
| Unexpected EOF | Yes | Degraded (exit detection) |
| Relay crash | Yes | Degraded (pending rejected) |
| Restart failure | Yes | Failed |
| Method unavailable | Yes | Relay returns method_not_found |
| Store unavailable | Yes | Relay returns store_unavailable |
| Launch plan expired | Yes | Error surfaces to user |
| Plan consumed | Yes | Error surfaces to user |
| Process not owned | Yes | Error surfaces to user |
| Detached session | Yes | Stop button disabled |
| Pending interrupted | Yes | clear_pending rejects all |

### Area 9 — Agent Control Center UX

- Discoverable via "Agent Control Center" command: **PASS**
- Keywords: agent, agents, ai, codex, claude, relay, project, session, launch: **PASS**
- Discoverability test verifies search for "relay": **PASS**
- Relay status shown with color-coded pill: **PASS**
- All 9 states have distinct visual tone: **PASS** (`statusTone`)
- Tabs: Launch, Sessions, Diagnostics: **PASS**
- Loading/empty/error states: **PASS**
- Launch preview shows executable, cwd, warnings, expiry: **PASS**
- Confirmation checkbox: **PASS**
- Sessions show status, ownership, start time: **PASS**
- Stop control reflects ownership: **PASS**
- Back button returns to root: **PASS**
- Aria labels on sections and tablist: **PASS**

### Area 10 — Windows and application lifecycle

- Single-instance via `tauri-plugin-single-instance`: **PASS**
- Relay started in setup (non-blocking): **PASS**
- `ExitRequested` triggers `shutdown_relay`: **PASS**
- Tray Quit triggers `shutdown_relay` then `app.exit(0)`: **PASS**
- `quit_app` command triggers shutdown then exit: **PASS**
- `CREATE_NO_WINDOW` prevents console window: **PASS**
- Paths with spaces work (verified in this environment): **PASS**
- Reboot persistence: **NOT TESTED** (requires full Windows restart)

### Area 11 — Existing Orbit regression safety

- All 227 Vitest tests pass (pre-existing + new): **PASS**
- All 39 Rust desktop tests pass: **PASS**
- Lint: 0 warnings: **PASS**
- TypeScript: 0 errors across 10 workspaces: **PASS**
- Production build succeeds: **PASS**
- Relay integration does not modify existing crates: **PASS** (changes only in `orbit-desktop` and docs)

## Known Pre-existing Repository Failures

- `cargo fmt --all --check`: Fails across multiple existing crates. Not introduced by this integration.
- `cargo clippy --workspace -- -D warnings`: Fails in `orbit-search`, `orbit-input`, `orbit-files`, `orbit-window-manager`. Not introduced by this integration.

## Remaining Limitations

1. **Windows reboot persistence not tested.** The project-root persistence mechanism uses Orbit's SQLite `settings` table, which survives process restarts. A full Windows reboot test was not performed.
2. **No automated fault-server integration tests in Orbit.** The Relay fault server scenarios are covered by the TypeScript SDK tests in `C:\OrbitRelay`, but Orbit does not yet run its own fault-injection tests against the supervisor. The certified sidecar smoke test covers the happy path.
3. **No automatic Relay restart on crash.** User must manually press "Restart Relay" in the Agent Control Center.
4. **Sequential health/capabilities negotiation.** Could be parallelized for ~10ms improvement.

## Manual Tests Still Required

1. Full Windows reboot with project-root restoration
2. Install the MSI or NSIS package on a clean machine and verify sidecar resolution
3. Verify that closing the main window (hide to tray) does not terminate Relay
4. Verify that re-showing the launcher after tray hide still shows correct Relay status
5. End-to-end launch flow with a real local agent (requires Codex or Claude Code installed)

## Audit Commit

Single bounded commit for:
- 3 clippy/robustness fixes in `relay_supervisor.rs`
- 4 regression tests in `relay_supervisor.rs`
- This audit report

## Release Recommendation

**CONDITIONAL RELEASE — recommended for production use.**

The integration is well-architected, correctly implements the Relay protocol, maintains strong security boundaries, and passes all automated checks. No BLOCKER or HIGH findings were identified.

Conditions:
1. The MSI/NSIS installer should be smoke-tested on a clean Windows machine to confirm sidecar resolution works from the installed path.
2. A full Windows reboot should be performed to verify project-root persistence across OS restarts.
3. The pre-existing `cargo fmt` and `cargo clippy` issues in non-Relay crates should be addressed in a separate effort to achieve a fully green CI baseline.

## Confirmation

- `C:\OrbitRelay` remained unchanged throughout the audit (verified at start and end).
- The Orbit working tree is clean after the audit commit.
