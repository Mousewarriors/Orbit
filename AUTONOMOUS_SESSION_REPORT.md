# Autonomous Session Report

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
