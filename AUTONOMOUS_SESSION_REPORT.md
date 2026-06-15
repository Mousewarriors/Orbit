# Autonomous Session Report

## Session — Priority 9: AgentOS Controller extension (2026-06-15)

- **Branch:** `claude/autonomous-orbit-build`
- **Mandate:** an initial, safe, observational AgentOS Controller (builds on P8).
- **How:** delegated to a **non-isolated** subagent pinned to absolute Orbit paths
  (after learning worktree isolation targets the wrong repo). The agent left
  changes uncommitted; I independently verified the diff was Orbit-only (the
  `C:\AgentOS` working tree was untouched — its dirty files match the
  session-start snapshot), re-ran the gate, and re-ran the Node-RPC checks before
  committing.

### Deliverable

`extensions/examples/agentos-controller` (manifest + index.mjs + package.json,
using `@orbit/extension-sdk`): observational commands — list agents / sessions /
projects, recent activity, pending approvals, agent health; actions open the
dashboard / agent workspace (open-url), open a project folder (open-path), and
copy status/path (copy). A **provider/adapter interface** with three adapters:
**mock** (live default, every row labelled "mock data"), **local-JSON** (path
from a preference), and **HTTP** (explicit base URL, `http(s)` only, 4s
`AbortSignal.timeout`, errors returned as items/toasts — never thrown).
Searchable by AgentOS / agent / project / sessions / approvals / "Agent Studio".
**Strictly observational** — no shell/SSH/service-restart/task-dispatch/code-exec
(documented in `docs/architecture/AGENTOS_ADAPTER.md`).

### Verification

- Real Node one-shot RPC for every command (mock) — valid `result` payloads;
  error paths clean (unknown command, non-`http(s)` URL, connection refused,
  missing JSON, malformed request) — no crashes.
- Gate: **184 JS tests** (+3 discoverability), lint clean, strict typecheck clean.

### Honest gap (deferred to its own slice)

Protocol v1's `InvokeRequest` (`crates/orbit-extensions/src/protocol.rs`) forwards
`{v,type,command,query,storage}` but **not** preference *values*, and there is no
preferences storage/UI yet. So json/http adapters are fully implemented + tested
via direct RPC but, at runtime, the extension falls back to **mock** until a
preferences slice (storage + Settings UI + `InvokeRequest.preferences` plumbing in
`protocol.rs` + `extension_host.rs`) lands. Handlers read `ctx.preferences`
defensively, so nothing breaks. Also: v1 list items carry one action, so project
"open folder" vs "copy path" is query-switched rather than dual actions.

### Files

- New: `extensions/examples/agentos-controller/**`,
  `docs/architecture/AGENTOS_ADAPTER.md`. Edited:
  `apps/desktop/src/discoverability.test.ts` (+3), `HANDOFF.md`,
  `FEATURE_MATRIX.md`, `AUTONOMOUS_SESSION_REPORT.md`.

---

## Session — Priority 8: Extension SDK + CLI (2026-06-15)

- **Branch:** `claude/autonomous-orbit-build`
- **Mandate:** build the typed `@orbit/api` SDK and the `orbit` extension CLI.

### How it was built (and the tooling pitfall fixed)

This was delegated to a worktree-isolated subagent. **Pitfall discovered:** the
Agent tool's `isolation: "worktree"` creates the worktree from the *harness's*
primary repo (`C:\AgentOS`), **not** the Orbit repo, so the agent built
everything in the wrong repository. The agent correctly detected the mismatch and
produced self-contained, gate-green packages. I **fixed the wrong-repo issue** by:
(1) copying its `packages/api`, `packages/cli`, and `docs/EXTENSION_SDK.md` into
the Orbit repo and adapting them to Orbit conventions (repoint tsconfigs to the
root `tsconfig.base.json`; source-based `types` for in-workspace typecheck, `dist`
build for Node runtime; a `vitest.globalSetup.ts` that builds `@orbit/api` before
collection); and (2) cleaning up the stray AgentOS worktree + branch (two of them,
incl. an earlier lost background agent) so `C:\AgentOS` is back to a clean `main`.

### Deliverables

- **`@orbit/api`** — typed SDK over protocol v1: `defineExtension`; `List`/
  `List.Item`/`List.Section`; `Detail`; `ActionPanel`/`Action`; `showToast`;
  `copyToClipboard`/`openUrl`/`openPath` (the three brokered effects only); typed
  `preferences`; namespaced local storage; structured logging to **stderr**;
  manifest types + `validateManifest`. Honest about the one-shot model:
  `showHUD`→toast (`@experimental`), `pushView`/`popView` throw with guidance.
- **`@orbit/cli` (`orbit`)** — `create|dev|build|validate|package|logs`, 5 working
  templates, dependency-free `.zip` packaging (`node:zlib`). `create` emits a
  no-repair-needed extension.
- **Tests:** 20 SDK unit + a full CLI lifecycle e2e (create→validate→discover→run
  through the real one-shot protocol→modify→re-run→package, across all templates).
- **Docs:** `docs/architecture/EXTENSION_SDK.md`.

### Verification gate (all green)

- JS/Vitest **181 passed** (was 149; +32). Lint clean; strict typecheck clean
  across all workspaces (the SDK/CLI compile under Orbit's strict base unchanged).
- `vite build` clean. **Real `orbit` bin run end-to-end** (build → `extension
  create --template list` → `extension validate` → a valid, working extension).
- No Rust change (Rust stays 113). `dist/` build output is gitignored (not
  committed).

### Honest scope / deferred

- One-shot protocol limits: no live HUD or mid-handler view push/pop (documented).
- `orbit extension dev` is a watch+validate loop; true hot-reload into a running
  launcher needs host integration (future).
- Priority 9 (AgentOS Controller, which builds on this SDK) not yet started.

### Files changed

- New: `packages/api/**`, `packages/cli/**`, `docs/architecture/EXTENSION_SDK.md`,
  `vitest.globalSetup.ts`. Edited: `vitest.config.ts` (timeouts + globalSetup),
  `package-lock.json` (workspace links), `HANDOFF.md`, `FEATURE_MATRIX.md`,
  `AUTONOMOUS_SESSION_REPORT.md`.

---

## Session — Priorities 3/4/5: extension runtime verified + management UI (2026-06-15)

- **Branch:** `claude/autonomous-orbit-build`
- **Mandate:** make extension management clear (P3); make Developer Utilities (P4)
  and AgentOS Status (P5) genuinely run through the real extension system.

### End-to-end runtime verification (real Node, the host's exact RPC)

Drove both sample extensions through the protocol the host uses
(`{v:1,type:'invoke',command,query,storage}` on stdin → one JSON result on stdout):

- `developer-utilities/random-uuid` (no-view) → `{type:'result', effects:[{kind:'copy',text:<uuid>}], storageWrites:{history:[…]}, toast:'Copied …'}` — a real UUID v4, the brokered copy effect, a namespaced storage write, and a toast.
- `developer-utilities/uuid-history` (list) → list items built from seeded storage, each with a `copy` action.
- unknown command → `{type:'error', message:'unknown command: …'}`.
- `agentos-status/agent-status` (list) → the safe offline mock agent list.

This proves the Priority 4 / Priority 5 command runtimes execute through the real
extension system (not duplicated internal commands). The Root Search
discoverability test already confirms these commands surface when the example
folder is added (opt-in, by design).

### Priority 3 — clearer extension management

- `ExtensionInfo` enriched: `description`, `health` (ready / degraded /
  unhealthy / disabled), `commands` (name/title/mode), requested `permissions`,
  `dir`, and `last_error`. The host now tracks `last_error` per extension
  (cleared on success, set on transport/handler error) in `record()`.
- Settings → Extensions renders all of it: title + version + a health pill,
  description, the registered command titles, requested permissions, the last
  error, an **Open folder** action (reuses the native launcher), and an obvious
  enable/disable toggle (not hidden in a menu).
- **Persistence test:** a new file-backed test opens the DB, disables an
  extension, drops the connection (simulating quit), reopens (relaunch) and
  asserts it is still disabled, then re-enables and confirms that persists too.

### Verification gate (all green)

- JS/Vitest 148; lint clean; strict typecheck clean.
- Rust `cargo test --workspace --lib` → 113 passed (+1 restart-persistence) + 1
  ignored; `cargo check --workspace` clean. `vite build` clean.

### Honest limitations / remaining Priority 3 work

- Per-extension reload (today: reload-all resets every crash breaker), uninstall,
  and live log streaming are not yet implemented.
- The extension child is process-isolated but not OS-sandboxed; uses `node` from
  PATH (documented in EXTENSION_RUNTIME.md).
- Not click-tested inside the running GUI this session; the runtime is proven via
  real Node and the management data is unit-tested + server-renders.

### Files changed

- `apps/desktop/src-tauri/src/extension_host.rs` (richer info + last_error),
  `apps/desktop/src/native.ts` (ExtensionInfo + ExtCmdMeta),
  `apps/desktop/src/settings/Settings.tsx`, `apps/desktop/src/settings/settings.css`,
  `crates/orbit-core/src/extstore.rs` (restart-persistence test),
  `HANDOFF.md`, `FEATURE_MATRIX.md`, `AUTONOMOUS_SESSION_REPORT.md`.

---

## Session — Priority 2a: File Search usability & diagnostics (2026-06-15)

- **Branch:** `claude/autonomous-orbit-build`
- **Mandate:** make File Search a real, usable end-to-end feature (Priority 2).
  This first slice covers usability + diagnostics + robustness; content indexing
  and an incremental fs watcher are deferred to their own slices (below).

### What changed

- **Visible diagnostics (the walker already computed them; we now surface them).**
  `WalkStats` from `orbit-files::walk` is captured in `file_index.rs`:
  unreadable directories (permission denied) and configured roots that don't
  exist (unavailable drive / deleted folder) are stored on `IndexState` and
  returned in `IndexStatus`. Settings → Files shows "N folders could not be read"
  and lists unavailable roots.
- **Last successful index time** persisted (`files.last_indexed_at`) and shown.
- **Explicit "Clear index"** control (`file_index_clear` command +
  `file_index::clear`) distinct from disabling.
- **First-run UX.** When indexing is enabled but nothing is indexed, Settings
  shows a callout explaining why Root Search returns no files and a one-click
  **"Index Documents, Desktop & Downloads"** (writes empty roots → native
  defaults, enables, rebuilds). When disabled, a note explains files won't appear.
- **Robustness confirmed:** missing roots / unavailable drives are skipped and
  reported (not fatal); permission-denied dirs are skipped and counted; symlinks
  are not followed (loop-safe); the file provider runs under the orchestrator's
  per-provider timeout/cancellation so one File Search failure never suppresses
  other providers.

### Verification gate (all green)

- JS/Vitest 148 passed; lint clean; strict typecheck clean.
- Rust `cargo test --workspace --lib` → 112 passed (+2: `split_lines`,
  `unavailable_roots`) + 1 ignored; `cargo check --workspace` clean.
- `vite build` clean.
- Not GUI-clicked this slice; the new logic is unit-tested and the Settings tree
  still server-renders (render smoke test passes).

### Deferred (honest) — remaining Priority 2 work, each its own slice

- **Content indexing** (off-by-default toggle): needs a migration + FTS for
  contents + size/binary caps + a privacy/security-model update (today the index
  is deliberately metadata-only). Not shipped as a dead toggle.
- **Incremental filesystem watcher**: today the index updates on rebuild, not
  automatically on file change. A `ReadDirectoryChangesW`/notify-based watcher is
  the next slice; the data layer already upserts by path so incremental updates
  will drop in.

### Files changed

- `apps/desktop/src-tauri/src/file_index.rs` (diagnostics, last-indexed, clear,
  tests), `apps/desktop/src-tauri/src/commands.rs` (`file_index_clear`),
  `apps/desktop/src-tauri/src/lib.rs` (register), `apps/desktop/src/native.ts`
  (status fields + `fileIndexClear`), `apps/desktop/src/settings/Settings.tsx`
  (diagnostics, clear, first-run), `apps/desktop/src/settings/settings.css`,
  `HANDOFF.md`, `FEATURE_MATRIX.md`, `AUTONOMOUS_SESSION_REPORT.md`.

---

## Session — Priority 1: application launching (2026-06-15)

- **Branch:** `claude/autonomous-orbit-build`
- **Remote:** `git@github.com:Mousewarriors/Orbit.git`
- **Mandate:** repair the complete application-launch journey (Priority 1).

### Root cause (confirmed by code + registry/launch inspection)

Two independent defects:

1. **Silent launch failures.** `launch_path` (commands.rs) delegated to
   `tauri-plugin-opener::open_path`, which on Windows calls `open::that_detached`
   → `ShellExecuteEx`. Tauri runs synchronous commands on an async-runtime worker
   thread that has **no COM apartment**. `ShellExecuteEx` resolves `.lnk`
   shortcuts via COM-based shell handlers, so without `CoInitializeEx` on that
   thread the shortcut launch was unreliable — matching the report "application
   results appear but do not launch", with no visible error.
2. **UWP / Store apps missing entirely.** `apps.rs` only scanned Start Menu
   `.lnk` files. Verified on this machine: **Calculator, Windows Terminal and the
   modern Notepad have no `.lnk`** (they live only in the Explorer AppsFolder), so
   they never appeared in results at all.

### Fix

- **`apps/desktop/src-tauri/src/launcher.rs`** *(new)* — native launch:
  - filesystem paths / `.lnk` / files → `ShellExecuteW` with `CoInitializeEx`
    (apartment-threaded) on the calling thread, explicit "open" verb, and
    `HINSTANCE` return-code checking (≤ 32 → a descriptive error). A stale/missing
    path returns a clear "no longer exists" error. **No silent failures.**
  - UWP / shell items (`shell:AppsFolder\<AUMID>`) → `explorer.exe` with the
    moniker as a single argument (no shell interpolation).
- **`apps.rs`** — keep the fast, dependency-free `.lnk` scan (`scan_lnk_apps`) as
  the synchronous startup index; `scan_applications` augments it with
  `Get-StartApps` (Win32 + UWP) mapped to AppsFolder monikers. Pure
  `parse_start_apps` (unit-tested) handles the JSON; `.lnk` wins on a name clash.
- **`lib.rs`** — startup uses the fast `.lnk` scan, then a background thread runs
  the full scan (which spawns PowerShell) and swaps in the augmented index, so
  window show is never blocked.
- **`commands.rs`** — `launch_path` routes through `launcher` on Windows
  (opener fallback off-Windows).
- **`App.tsx`** — clears stale errors on a new query / new action; usage is only
  recorded after a non-throwing (successful) launch, so a failed launch keeps the
  launcher open and records nothing.

### Verification gate (all green)

- **JS/Vitest:** 148 passed (+4: `apps/desktop/src/launch.test.ts` — result →
  `open-path` action → native launch for both `.lnk` and UWP, "Copy Path"
  secondary action, and error propagation on a failed launch).
- **Lint:** `eslint . --max-warnings=0` clean. **Types:** strict `tsc` clean.
- **Rust:** `cargo test --workspace --lib` → 110 passed (+6: launcher branch/
  error-mapping/shell-item detection + `parse_start_apps`), 1 opt-in `#[ignore]`
  real-launch test. `cargo check --workspace` clean.
- **Production build:** `vite build` clean (91 modules).
- **Live, real-window verification (not unit-only):** ran the *compiled*
  `launcher::platform::launch()` via the opt-in test against both code paths and
  confirmed actual windows opened — **Calculator** (UWP via Explorer) and
  **Notepad++** (`.lnk` via `ShellExecuteW` + COM) — then closed them. This proves
  the COM fix works on a non-UI worker thread (the exact failing scenario).
  `Get-StartApps` confirmed to list Calculator/Terminal/Notepad with launchable
  AppIDs, and `explorer.exe shell:AppsFolder\…` confirmed to launch Calculator.

### Honest limitations

- Click-through *inside the running launcher window* (Alt+Space → type → Enter)
  was not performed this session; the **launch primitive itself is proven** with
  real windows, and the renderer→native wiring is covered by `launch.test.ts`.
- UWP launch via Explorer can't report per-app activation failure (Explorer always
  returns quickly); classic/`.lnk` launches do report failure precisely.

### Files changed

- `apps/desktop/src-tauri/src/launcher.rs` *(new)*,
  `apps/desktop/src-tauri/src/apps.rs`,
  `apps/desktop/src-tauri/src/lib.rs`,
  `apps/desktop/src-tauri/src/commands.rs`,
  `apps/desktop/src-tauri/Cargo.toml` (windows `Win32_UI_Shell` + `Win32_System_Com`),
  `apps/desktop/src/App.tsx`, `apps/desktop/src/launch.test.ts` *(new)*,
  `HANDOFF.md`, `FEATURE_MATRIX.md`, `AUTONOMOUS_SESSION_REPORT.md`.

---

## Session — Settings routing repair (2026-06-15)

- **Branch:** `claude/autonomous-orbit-build`
- **Starting commit:** `a734cfe`
- **Remote:** `git@github.com:Mousewarriors/Orbit.git`
- **Mandate:** stop new feature work; fix the blank Settings window (reported 404)
  and the "providers not discoverable in Root Search" report.

### Root cause (Settings) — confirmed by live GUI debugging

The Settings window was opened with `WebviewUrl::App("index.html#/settings")`.
The reported "404" is a red herring: the only 404 in the webview console is
`GET /favicon.ico` (harmless). The real failure was found by attaching to the
**running** WebView2 over the DevTools Protocol and inspecting the actual Settings
window — its document was stranded on **`about:blank`**: the runtime-created
webview never navigated to the app, so nothing rendered (a blank window).

Why: the launcher is a window **declared in `tauri.conf.json`**, which Tauri
creates and navigates to the dev server during setup. The Settings window was
instead created at **runtime** with `WebviewWindowBuilder` / `WebviewUrl::App`, and
in `tauri dev` such a runtime webview fails to navigate to the external dev server
— it is left on `about:blank`. This is **independent of the URL**: re-opening it
with a bare `index.html` (no route in the URL at all) reproduced the same
`about:blank`. The real distinction is **config-declared window vs. runtime-created
window**, not hash vs. query. (The original `#/settings` and the favicon `404`
were both red herrings.)

(Earlier static analysis had concluded the hash was harmless because the URL string
resolves and `/index.html` serves HTTP 200 — true, but it missed that the runtime
webview never navigates there at all. Live DevTools-Protocol inspection of the
running WebView2 found the `about:blank` document; a full-screen capture then
confirmed the working fix.)

### Fix

1. **Declare the Settings window in `tauri.conf.json`** (label `settings`,
   `visible: false`), so Tauri creates and navigates it exactly like the launcher —
   its webview reliably loads the app instead of stranding on `about:blank`.
2. **Reuse it across closes.** `lib.rs` intercepts the Settings window's
   `CloseRequested` and **hides instead of destroying** it, so the window always
   exists. `open_settings` (`commands.rs`) is now simply *show + focus* of that one
   window — the broken runtime `WebviewWindowBuilder` path (and its `WebviewUrl`
   imports) is removed. **Verified in the real desktop GUI** (full-screen capture:
   the Settings window renders all seven sections).
3. **Route by window label.** Both windows load the same app URL; the renderer
   picks the Settings UI from this window's **label** (`settings`) via the pure,
   unit-tested `selectView()` (`apps/desktop/src/route.ts`), reading the label
   synchronously through `native.ts::currentWindowLabel` (`getCurrentWindow()`).
   `?view=settings` / `#/settings` remain as harmless fallbacks.
4. **Visible error boundary.** `apps/desktop/src/components/ErrorBoundary.tsx`
   wraps both roots so any future render fault shows the error + component stack
   instead of a silent blank window.
5. **Discoverability — investigated, found largely a misdiagnosis.** The command/
   tools/extension providers are registered (`App.tsx`) and matchable: a runnable
   smoke test drives the *real* providers through the *real* orchestrator and
   confirms `Settings`, `Notes`, `Quicklinks`, `File Search`, `uuid`,
   `password 24`, `#ff0000`, `json {…}`, `Developer Utilities` and
   `AgentOS Status` all produce the expected result. (`File Search` resolves to
   the "Rebuild File Index" entry via its subtitle; extension commands match by
   title/subtitle.) The two sample extensions only appear once their folder is
   added under Settings → Extensions — **by design** (opt-in), not a bug. A
   regression test confirms one failing optional provider can't suppress the rest
   (the orchestrator already isolates per-provider failures).

### Verification gate (all green)

- **JS/Vitest:** 144 passed (was 127; +5 route, +11 discoverability/resilience,
  +1 Settings render smoke test).
- **Lint:** `eslint . --max-warnings=0` clean.
- **Types:** strict `tsc --noEmit` clean across all workspaces.
- **Rust:** `cargo test --workspace` → 104 passed; `cargo check --workspace` clean.
- **Production build:** `vite build` (the `frontendDist` artifact) clean — 91
  modules. (Full `tauri build` installer not bundled — long, needs WiX/NSIS.)
- **Live GUI:** ran `npm run dev:desktop` and exercised the real `open_settings`
  flow. The Settings window now opens and renders fully — confirmed by a
  full-screen capture showing all seven sections (General/Appearance/Snippets/
  Files/Extensions/Privacy/Developer) and the General pane. The user also
  independently confirmed it working. (Diagnosis used WebView2 remote debugging
  over the DevTools Protocol, which itself can break a second runtime webview, so
  final confirmation was via the no-debug full-screen capture + user check.)

### Files changed

- `apps/desktop/src-tauri/tauri.conf.json` — declare the `settings` window
  (visible:false) so it is created/navigated like the launcher.
- `apps/desktop/src-tauri/src/lib.rs` — `SETTINGS_LABEL`; hide-on-close handler so
  the Settings window is reused, not destroyed.
- `apps/desktop/src-tauri/src/commands.rs` — `open_settings` is now show+focus of
  the pre-created window; removed the runtime `WebviewWindowBuilder`/`WebviewUrl` path.
- `apps/desktop/src/route.ts` *(new)* — pure, label-first `selectView()`.
- `apps/desktop/src/components/ErrorBoundary.tsx` *(new)*.
- `apps/desktop/src/main.tsx` — label-based selection + error boundary.
- `apps/desktop/src/native.ts` — `currentWindowLabel()` (`getCurrentWindow().label`).
- `apps/desktop/src/styles.css` — error-boundary styles.
- `apps/desktop/src/route.test.ts`, `apps/desktop/src/discoverability.test.ts`,
  `apps/desktop/src/settings/settings.render.test.ts` *(new tests)*.
- `vitest.config.ts` — include `apps/desktop/src`, automatic JSX.
- `HANDOFF.md`, `FEATURE_MATRIX.md`, `AUTONOMOUS_SESSION_REPORT.md`.

No new product features were added.

---

## Session — feature build (prior)

- **Session date:** 2026-06-14
- **Branch:** `claude/autonomous-orbit-build`
- **Starting commit:** `10c74ec` (foundation + snippets paste injection)
- **Ending commit:** `3ba8f0c` (extension host foundation)
- **Remote:** `git@github.com:Mousewarriors/Orbit.git` (branch pushed)

## Executive summary

Seven coherent, production-quality vertical slices were built, verified,
documented, committed and pushed on top of a clean baseline. The repository stays
green at every checkpoint: **127 JS tests, 100 Rust tests**, ESLint clean, strict
`tsc` clean, `cargo check --workspace` clean, `vite build` clean. The full
Raycast-class product remains far larger than one session; AI, MCP, cloud
sync/accounts/teams and the extension store were intentionally **not** started.

## Completed vertical slices (one commit each)

| Commit | Slice |
| --- | --- |
| `ce36623` | Snippet-expansion watcher lifecycle (start/stop/restart/status, clean unhook) + Root Search focus-restore fix |
| `22a0463` | Native Settings window + configurable global hotkey (live re-register) + appearance (theme/opacity/reduced-transparency/reduced-motion) |
| `16f4e67` | Local file search (opt-in, metadata-only): `orbit-files` walker, FTS index, provider, Settings → Files |
| `dd3e9b7` | Quicklinks: CRUD, scheme-allowlist validation, `{query}` provider, management view |
| `e0404c3` | Notes: CRUD + FTS, autosaving editor, root-search provider |
| `e48f111` | Built-in tools: colour / JSON / secure password / UUID provider |
| `3ba8f0c` | **Extension Host foundation** (see below) |

## Extension Host foundation — proof points (Priority 7)

All requested proof points are implemented and verified (unit tests + real Node
RPC round-trips run from the CLI):

- ✅ Manifest validation — `orbit-extensions::manifest` (host) + `@orbit/validation` (renderer)
- ✅ Isolated child-process host — `extension_host.rs` spawns `node <main>` per invocation
- ✅ Versioned, schema-validated RPC — `orbit-extensions::protocol` (`v:1`, `parse_response` version check)
- ✅ Command registration in Root Search — `createExtensionProvider`
- ✅ Working no-view command — `developer-utilities/random-uuid` (copy + storage + toast)
- ✅ Working list command — `developer-utilities/uuid-history`, `agentos-status/agent-status`
- ✅ Permission-brokered actions — `orbit-extensions::permission` (undeclared effects dropped)
- ✅ Namespaced extension storage — `orbit-core::extstore` (isolation tested)
- ✅ Crash isolation + crash-loop protection — spawn-per-call + `CrashTracker`
- ✅ Extension management in Settings — Settings → Extensions
- ✅ Developer Utilities sample extension
- ✅ Safe mock AgentOS Status extension (offline)

## Partial / foundation-level (honest status)

- **Extension runtime is process-isolated but not OS-sandboxed.** The child has
  `node` privileges; the broker governs what *Orbit* does for it, not what the
  child can do directly. Uses `node` from PATH (no bundled runtime). No secrets
  API, no view/detail/form modes, no hot dev-reload, no typed SDK npm/CLI.
- **Snippet system-wide expansion** remains opt-in; the live keyboard-hook path
  isn't verifiable in this environment (Defender blocks synthetic input).
- **File search** is full-rebuild only (no filesystem watcher), metadata-only.

## Files / packages added

- TS packages: `@orbit/appearance`, `@orbit/shortcuts`, `@orbit/tools`,
  `@orbit/extension-sdk`.
- Rust crates: `orbit-files`, `orbit-extensions`.
- Sample extensions: `extensions/examples/developer-utilities`,
  `extensions/examples/agentos-status`.
- New desktop modules: `file_index.rs`, `extension_host.rs`,
  `src/appearance.ts`, `src/settings/*`, several views/providers.
- New docs: `docs/architecture/FILE_SEARCH.md`,
  `docs/architecture/EXTENSION_RUNTIME.md`.

## Database migrations

- `0004` — `files` + `files_fts` (file index)
- `0005` — `notes` + `notes_fts`
- `0006` — `extension_storage` + `extension_state`

All migrations are append-only (`PRAGMA user_version`), applied transactionally.

## Tests before → after

- JavaScript (Vitest): **96 → 127**
- Rust (libs): **45 → 100** (orbit-core 38, orbit-extensions 21, orbit-files 10,
  orbit-input 15, orbit-search 8, orbit-window-manager 8)

## Manual desktop verification

The GUI was **not** launched this session (synthetic input triggers Windows
Defender; a headless visual run isn't reliable here). Instead:

- The extension RPC was verified **end-to-end with real Node** (no-view, list,
  storage round-trip, unknown-command error) from the CLI.
- All other slices are compile- + unit-verified.
- A precise human test checklist for every new flow is in `HANDOFF.md`.

## Security implications

- New brokered boundary for extensions (effects + item actions checked against
  declared permissions); namespaced storage; crash-loop auto-disable; manifests
  validated host-side. Documented in `SECURITY_MODEL.md`.
- Residual risks: extensions not OS-sandboxed yet; local SQLite (clipboard /
  snippets / notes / extension storage) not encrypted at rest; snippet LL hook is
  a high-privilege (opt-in) surface.

## Environmental blockers

- Cannot visually run the Tauri GUI / synthetic input here (Defender).
- `node` is on PATH in dev; production needs a bundled JS runtime (future work).
- `npm audit` reports advisories in the vite/esbuild dev-dependency chain (not
  fixed to avoid breaking changes).

## Exact next task

Harden the extension runtime: (1) OS-sandbox the child process (Windows
AppContainer / job objects, fs/network confinement); (2) bundle a JS runtime so
extensions don't depend on `node` from PATH; (3) add an extension secrets API on
top of OS secure storage. Then add more command modes (view/detail/form) and a
typed SDK npm package + CLI. (Do not start the extension store, AI, MCP, sync or
teams until the runtime is hardened.)

## Recommended pull request

**Title:** `feat: Settings, file search, quicklinks, notes, tools + extension host foundation`

**Description:**

> Seven vertical slices on top of the launcher baseline, each tested, documented
> and independently committed:
>
> - **Snippets:** controllable system-wide expansion watcher (start/stop/restart/
>   status, clean unhook) + Root Search focus fix.
> - **Settings window:** standalone native window; configurable global hotkey
>   (live re-register), appearance (theme/opacity/reduced-transparency/motion),
>   snippet/clipboard/privacy controls, diagnostics.
> - **File search:** opt-in, metadata-only local indexer (`orbit-files` + FTS) +
>   root-search provider + Settings → Files.
> - **Quicklinks:** CRUD + scheme-allowlist validation + `{query}` provider + view.
> - **Notes:** CRUD + FTS + autosaving editor + provider.
> - **Built-in tools:** colour / JSON / secure password / UUID.
> - **Extension host foundation:** isolated child-process runtime, versioned
>   schema-validated RPC, permission broker, namespaced storage, crash-loop
>   protection, Root Search integration, Settings management, SDK + two sample
>   extensions. Not OS-sandboxed yet (documented).
>
> Gates: 127 JS tests, 100 Rust tests, lint, strict typecheck,
> `cargo check --workspace`, `vite build` — all green. New migrations 0004–0006
> are append-only. AI / MCP / sync / teams / extension store intentionally not
> started. GUI not visually run in CI (see HANDOFF manual checklist); extension
> RPC verified end-to-end with Node.
>
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
