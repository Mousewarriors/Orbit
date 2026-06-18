# Orbit — Session Handoff

Written 2026-06-14 at the end of the first build session(s). Read this once to
get oriented, then rely on [CLAUDE.md](CLAUDE.md) for durable rules and
[FEATURE_MATRIX.md](FEATURE_MATRIX.md) for per-feature status.

> **TL;DR** — Foundation + Phase 1 launcher slice + window management + clipboard
> history + **snippets/paste-injection** are built and verified (96 JS tests,
> 45 Rust tests, lint/typecheck/`cargo check --workspace`/`vite build` all green).
> The full product spec (extensions, AI, MCP, sync, teams, browser ext, file
> search, notes, calendar, focus, settings UI, etc.) is **not** built yet.
>
> **Update (session 2, 2026-06-14):** the live GUI has now been **run
> end-to-end** (`tauri dev`). Fixed a startup panic (malformed
> `plugins.global-shortcut` in `tauri.conf.json` — the plugin is configured in
> Rust, so the stray config entry was removed). Verified live: Alt+Space toggle,
> search, calculator (`125*8`=1,000), Clipboard History, and the new Snippets
> manager (create/list round-trip). Not live-verified: actual keystroke output
> into a 3rd-party app and the opt-in keyword-expansion hook (synthetic input is
> intermittently blocked by Defender here) — these rest on unit-tested logic.
>
> **Update (session 3, 2026-06-14, branch `claude/autonomous-orbit-build`):**
> (1) **Snippet watcher now has a controllable lifecycle** — start/stop/restart/
> status, idempotent, clean `UnhookWindowsHookEx` via `WM_QUIT`, backed by a pure
> `orbit_input::Lifecycle` (5 tests). IPC: `snippet_watcher_status/_set_enabled/
> _restart`. (2) **Native Settings window** (`index.html#/settings`, opened from
> tray / "Open Settings" command / `open_settings`) with General (configurable
> global hotkey via a shortcut recorder, re-registered live), Appearance (theme /
> opacity / reduced-transparency / reduced-motion — new pure `@orbit/appearance`
> pkg, 11 tests + `@orbit/shortcuts`, 6 tests), Snippets (expansion toggle +
> status + restart), Privacy (clipboard capture toggle / retention / clear — now
> honoured live by the monitor), Developer (version/paths, open data folder).
> (3) Fixed Root Search focus restoration when returning from a subview.
> (4) **Local file search** — new `orbit-files` crate (pure rules + std-only
> cancellable walker, 10 tests), `orbit-core::files` table + FTS5 (7 tests),
> background self-superseding rebuild in batches (`file_index.rs`), a root-search
> file provider (≥3 chars), `reveal_path` (no shell), and a Settings → Files
> section (opt-in toggle, roots/excludes/hidden, rebuild, live status). Indexing
> is **off by default** and **metadata-only**.
> (5) **Quicklinks** — `orbit-core::quicklinks` CRUD (4 tests), `@orbit/validation`
> quicklink schema with a scheme allowlist (3 tests, re-checked natively), a
> management view, and a root-search provider that fills `{query}` from an
> alias/title prefix. Counts: **116 JS tests, 71 Rust tests**; lint/typecheck/
> `cargo check --workspace`/`vite build` all green. Not live-verified this session
> (compile + unit verified): the Settings window visuals, the live hotkey-rebind/
> keyword-hook paths, a real file-index run, and Quicklink open — see the manual
> checklist below.
> (6) **Notes** — `orbit-core::notes` CRUD + FTS5 + pin/archive (5 tests), a Notes
> view with an autosaving editor + searchable list, and a root-search note
> provider (opens a note via a push-view action carrying its id).
> (7) **Built-in tools** — pure `@orbit/tools` (colour conversion, JSON format/
> minify, crypto-secure password, UUID; 11 tests) surfaced as instant Root Search
> results.
> (8) **Extension Host foundation** — isolated child-process extension runtime:
> `orbit-extensions` (manifest/protocol/permission/crash/discovery, 21 tests),
> `orbit-core::extstore` namespaced storage (migration 0006), `extension_host.rs`
> (spawn `node` per call, timed RPC, effect brokering, crash-loop breaker),
> `@orbit/extension-sdk`, two sample extensions, a Root Search command provider +
> list view, Settings → Extensions. RPC verified end-to-end via real Node;
> permission/crash/manifest logic unit-tested. Counts: **127 JS tests, 100 Rust
> tests**; full gate green. Not GUI-run here; child not yet OS-sandboxed (uses
> `node` from PATH) — see EXTENSION_RUNTIME.md.

> **Update (session 4, 2026-06-15, branch `claude/autonomous-orbit-build`):**
> **Repair session — no new features.** Fixed the blank Settings window and
> audited Root Search discoverability.
> (1) **Settings blank window — real root cause (found via live WebView2
> debugging).** The window was created at **runtime** with
> `WebviewWindowBuilder`/`WebviewUrl::App`; in `tauri dev` such a runtime webview
> fails to navigate to the external dev server and is stranded on `about:blank`
> (the blank window). This is independent of the URL — bare `index.html`
> reproduced it too — and the reported "404" was just `/favicon.ico`. **Fix:** the
> Settings window is now **declared in `tauri.conf.json`** (label `settings`,
> visible:false) so Tauri creates/navigates it like the launcher; `lib.rs`
> **hides it on close instead of destroying** it; and `open_settings` is just
> show+focus of that one reusable window (the runtime `WebviewWindowBuilder` path
> is removed). The renderer picks the Settings UI from the window **label** via a
> pure, unit-tested `selectView()` (`src/route.ts` / `native.ts::currentWindowLabel`).
> Confirmed working in the real GUI (full-screen capture: all 7 sections render).
> (2) **Visible React error boundary** (`src/components/ErrorBoundary.tsx`) wraps
> both roots, so a render fault shows the error instead of a blank page.
> (3) **Discoverability** turned out to be largely a misdiagnosis: a runnable smoke
> test drives the real providers through the real orchestrator and confirms
> `Settings`, `Notes`, `Quicklinks`, `File Search`, `uuid`, `password 24`,
> `#ff0000`, `json {…}`, `Developer Utilities`, `AgentOS Status` all return
> results; the sample extensions still require adding their folder under
> Settings → Extensions (opt-in, by design). A regression test confirms one
> failing optional provider can't suppress the others. Counts: **144 JS tests,
> 104 Rust tests**; lint / strict typecheck / `cargo check --workspace` /
> `vite build` all green.

> **Update (session 5, 2026-06-15, branch `claude/autonomous-orbit-build`):**
> **Priority 1 — application launching repaired.** Root cause: `launch_path`
> called the opener plugin's `ShellExecuteEx` on a Tauri runtime worker thread
> with **no COM apartment**; `.lnk` shortcut resolution delegates to COM shell
> handlers, so launches were silently unreliable ("results appear but don't
> launch"). Additionally, UWP / Microsoft Store apps (Calculator, Terminal, modern
> Notepad) have **no `.lnk`** and weren't even enumerated.
> Fix: new `apps/desktop/src-tauri/src/launcher.rs` launches via `ShellExecuteW`
> with `CoInitializeEx` on the calling thread, an explicit "open" verb, and
> `HINSTANCE` return-code checking (≤32 → a descriptive error, so a failed launch
> is never swallowed); UWP / shell items launch via `explorer.exe
> shell:AppsFolder\<AUMID>`. `apps.rs` now augments the fast `.lnk` scan with
> `Get-StartApps` (UWP apps) in a background thread so startup isn't blocked. The
> renderer clears stale errors and only records usage when the launch resolved
> (a failed launch throws → caught → no usage, launcher stays open).
> **Live-verified end-to-end** by driving the *real compiled* `launch()` against
> both branches: it opened a real **Calculator** window (UWP/Explorer) and a real
> **Notepad++** window (`.lnk`/ShellExecuteW+COM), confirming the COM fix works on
> a non-UI worker thread. Counts: **148 JS tests, 110 Rust tests** (+1 opt-in
> `#[ignore]` real-launch test); lint / strict typecheck / `cargo check
> --workspace` / `vite build` all green. Still pending live click-through inside
> the running launcher GUI (the launch primitive itself is proven); File Search
> usability (Priority 2) is the next slice.

> **Update (session 5b, 2026-06-15) — Priority 2a: File Search usability.**
> Surfaced the diagnostics the walker already computes: Settings → Files now shows
> **last-indexed time**, **unreadable folders skipped** (permission denied), and
> **unavailable/missing roots** (unplugged drive / deleted folder); added an
> explicit **Clear index** button and a **first-run** callout with one-click
> "Index Documents, Desktop & Downloads". `file_index.rs` captures `WalkStats`
> and persists `files.last_indexed_at`; new `file_index_clear` command. Counts:
> **148 JS, 112 Rust** (+2), gate green. **Still deferred** (each its own slice):
> content indexing (off-by-default toggle; needs migration + privacy-model update)
> and an incremental filesystem watcher (today: rebuild-only). The file provider
> is already isolated under the orchestrator timeout, so a File Search failure
> never suppresses other Root Search providers.

> **Update (session 5c, 2026-06-15) — Priorities 3/4/5 progress.**
> **Verified the extension runtime end-to-end with real Node** (the host's exact
> RPC): `developer-utilities` `random-uuid` returns a UUID + a brokered `copy`
> effect + a storage write + a toast; `uuid-history` renders list items from
> storage; an unknown command returns a structured error; `agentos-status`
> returns its mock agent list. So the Priority 4 (Developer Utilities) and
> Priority 5 (AgentOS Status) command runtimes genuinely execute.
> **Priority 3 (extension management):** `ExtensionInfo` now carries description,
> health (ready/degraded/unhealthy/disabled), the registered commands, requested
> permissions, last error, and the folder path; Settings → Extensions renders all
> of these with an obvious enable/disable toggle and an "Open folder" action
> (reuses the native launcher). Added a file-backed DB test proving disable/enable
> **persists across a restart**. Counts: **148 JS, 113 Rust** (+1), gate green.
> Still to do for Priority 3: per-extension reload (today: reload-all), uninstall,
> and live log streaming. Sample extensions still load opt-in via Settings →
> Extensions → Developer folders (point at `extensions/examples`).

> **Update (session 5d, 2026-06-15) — Priority 7: search/action reliability.**
> Closed the last global-failure vector in the orchestrator: a provider whose
> **`canHandle` throws** is now caught, recorded, and skipped (previously it threw
> out of the whole `runSearch`). Provider failures/timeouts are logged (structured
> `console.warn`) and surfaced as a subtle "some sources unavailable" note in the
> launcher, while healthy providers are unaffected. Per-provider `search`
> isolation, cancellation, timeout, and usage-only-on-success were already in
> place (the latter from the P1 launch work). Counts: **149 JS, 113 Rust**, gate
> green.

> **Update (session 5e, 2026-06-15) — Priority 8: Extension SDK + CLI.**
> New `@orbit/api` (typed SDK over protocol v1) and `@orbit/cli` (`orbit
> extension create|dev|build|validate|package|logs` + 5 templates). 32 new tests
> (SDK unit + a full CLI lifecycle e2e that spawns generated extensions through
> the real one-shot protocol). **148→181 JS tests**, gate green; the real `orbit`
> bin was run end-to-end (create→validate). Honest scope: `showHUD`→toast
> (`@experimental`), `pushView`/`popView` throw (one-shot model). `@orbit/api`
> builds to `dist` for Node consumers (`vitest.globalSetup.ts` builds it before
> the suite; `dist/` is gitignored). See [docs/architecture/EXTENSION_SDK.md].
>
> ⚠️ **Tooling note for future sessions:** the Agent tool's `isolation: "worktree"`
> creates the worktree from the **harness's** primary repo (here `C:\AgentOS`),
> **not** this Orbit repo — a worktree agent ends up in the wrong repository. This
> P8 work was produced by such an agent and **salvaged** by copying its source
> into Orbit and adapting it to Orbit's workspace conventions; the stray AgentOS
> worktree/branch were cleaned up. For Orbit, prefer doing the work in-tree or
> instruct a non-isolated agent with absolute Orbit paths.

> **Update (session 5f, 2026-06-15) — Priority 9: AgentOS Controller extension.**
> New `extensions/examples/agentos-controller` (uses `@orbit/extension-sdk`): a
> safe, **observational** controller — list agents/sessions/projects, recent
> activity, pending approvals, agent health; open dashboard / agent workspace
> (open-url), open project folder (open-path), copy status/path. Has a 3-way
> **adapter** (mock [live default] / local-JSON / HTTP with explicit URL, 4s
> timeout, graceful errors). No shell/SSH/restart/dispatch — observational only.
> All commands + error paths verified via real Node RPC; +3 discoverability tests
> (**184 JS**, gate green). **Honest gap:** protocol v1 doesn't yet forward
> preference *values* to the extension child, so json/http adapters are
> implemented + documented but only activate once a preferences slice (storage +
> UI + `InvokeRequest.preferences` plumbing in `protocol.rs`/`extension_host.rs`)
> lands; mock works today. See docs/architecture/AGENTOS_ADAPTER.md.

> **Update (session 5g, 2026-06-15) — Priority 3: extension management.**
> Settings → Extensions now has **per-extension reload** (`reload_one` re-discovers
> only that extension and resets only its crash breaker, leaving others' breakers
> intact) and **readable recent logs** (`invoke_child` captures the child's stderr
> bounded to ~50 lines / 4000 bytes via the pure `orbit_extensions::bound_logs`,
> stored per extension and shown in a collapsible "Recent logs" block). New IPC
> `extension_reload_one`; +2 host tests, +6 `bound_logs` tests (**121 Rust**, all
> gates green).

> **Update (session 5g, 2026-06-15) — Priority 10: Windows distribution foundation.**
> Added `tauri-plugin-single-instance` (registered first; second launch focuses
> the existing launcher via `focus_launcher`) and `tauri-plugin-autostart` (wired
> via `get_autostart`/`set_autostart` Rust commands + a real Settings → General
> "Launch Orbit at login" toggle, off by default — replaces the old disabled
> placeholder). Added "Copy diagnostics" to Settings → Developer (no secrets).
> Bundle config in `tauri.conf.json` was already complete (msi/nsis, publisher,
> icons, currentUser). New `docs/architecture/DISTRIBUTION.md` documents the
> installer, **code-signing requirements (not configured — no cert here)**,
> deferred auto-update, and the dev-only `npm audit` advisories. `cargo check
> -p orbit-desktop` clean; **184 JS / 121 Rust**, lint + typecheck green.
> **Honest limit:** single-instance focusing + the login entry are compiled/wired
> but NOT GUI-verified here (no `tauri build`/`dev`). Remaining: P2b (content
> indexing + fs watcher), P6 (Notes/Quicklinks live-GUI reverify), extension
> uninstall, CI, code-signing + auto-update.

> **Update (session 6, 2026-06-16) — Packaged-build startup defect (managed-state
> race condition).**
> **Root cause:** `app.manage(AppState {...})` in `lib.rs` was called *after*
> `extension_host::install_bundled()`, which on first launch copies bundled
> extension files (file I/O, potentially 200–500 ms). In the packaged release,
> WebView2 loads the bundled frontend directly from the binary with no Vite
> dev-server round-trip, so the renderer's first `listApplications()` IPC call
> arrives before `manage()` has run.  Tauri returns the raw error
> `"state not managed for field 'state' on command 'list_applications'"`.
> In development the Vite dev server adds enough latency that `manage()` always
> completes first — the bug was invisible there.
> **Why it "disappears" when typing:** `App.tsx` clears any `error` state on every
> query change via `setError(null)`, masking the startup error without resolving it.
> **Fix:** read the `need_bundled` flag from `conn` before moving it into
> `AppState`, call `app.manage()` immediately (before `install_bundled`), then
> install extensions and update the flag via `state.db.lock()` after manage.
> **Belt-and-suspenders front-end:** `App.tsx` startup load retries once after
> 400 ms if the initial `listApplications()` / `usageSnapshot()` call fails, and
> surfaces a friendly message for any residual `"state not managed"` error instead
> of the raw Tauri internal string.
> **Tests added** (`lib.rs` `#[cfg(test)]`): 5 new Rust tests covering AppState
> construction, `list_applications` access immediately after construction, DB
> migration-readiness, flag lifecycle, and the complete need_bundled→manage→set
> sequence.
> **Counts: 199 JS tests / 128 Rust tests** (+5); `cargo check --workspace`,
> lint, strict typecheck, `vite build`, and `tauri build` (NSIS + MSI) all green.
> `target\release\bundle\nsis\Orbit_0.1.0_x64-setup.exe` produced.

> **Update (session 7, 2026-06-17, branch `claude/orbit-ai-runtime`) — Natural-language
> command bar (deterministic-first intent routing).** The headline product direction:
> make the existing Alt+Space bar understand ordinary requests and route them to
> Orbit's **existing safe actions** — no separate chatbot page, no AI call for
> known local requests.
> (1) **New pure `@orbit/intent` package** (GUI-free, 51 tests): `recogniseIntent()`
> — an ordered, conservative deterministic pattern matcher mapping plain language
> to a structured `{ intent, slots, confidence, requiresConfirmation }` (e.g.
> "Continue Orbit with the best coding agent" → `continue_project` + projectQuery
> "orbit" + agentPreference "best"); `rankProjects`/`rankApps`/`bestProject` — pure
> entity resolution reusing the proven fuzzy matcher; `proposeIntent()` — maps a
> recognised intent to a safe **action plan** (Control Center deep-link, open-path,
> reveal-folder, file/note search, the narrow Restart-Relay command, or an honest
> `unsupported-ai`). All routing decisions live here, unit-tested.
> (2) **`intentProvider.ts`** (11 tests) — a thin Root Search provider that
> recognises → resolves (cached apps/projects + native file/note search) → emits a
> `SearchItem` whose `primaryAction` is an **existing audited ActionToken**. Carries
> the raw query as a keyword (like the calculator) so the NL item leads the ranker;
> returns `[]` for non-requests so exact-match providers and the calculator are
> untouched. Wired into `App.tsx` (new cached recent∪favourite project list).
> (3) **Control Center deep-links** — `encode/decodeControlCenterArg` carry an
> optional resolved project (pre-selects + enters continuation on Launch) and a
> session-status filter; `SessionsPanel` gained a status filter input (so "show
> failed sessions" is *truthful*, not just a tab switch); the Projects detail pane
> now synthesises a record for a deep-linked/recent project so it shows without a
> scan.
> **Honesty:** AI-assisted intents (explain/summarise/quick-AI) are recognised but
> return a "Quick AI not available yet" item with a real web-search fallback — never
> a fake answer (AI runtime is the next slice). Agent *preference* is captured/shown
> but not auto-selected (Hermes / Model Gateway own that decision). Consequential
> intents route to the Launch composer's existing confirm step.
> **Counts: 328 JS tests** (+129; intent 51, provider 11, CC encode/decode +5, and a
> larger discoverability suite) **/ 123 Rust** (unchanged — no Rust touched); lint,
> strict typecheck (`exactOptionalPropertyTypes`), `vite build`, `cargo check
> --workspace` all green. **Not GUI-run here** (headless) — the recogniser→action
> mapping is fully unit-covered; live click-through of the NL journeys is the first
> thing to confirm on the next `tauri dev`.

> **Update (session 7b, 2026-06-17, branch `claude/orbit-ai-runtime`) — Slices 2 & 3:
> confirmation/preview + AI runtime foundation.**
> **Slice 2 — Action preview & confirmation (priority 6).** Pure `confirm.ts`
> (`needsConfirmation` = action.dangerous; `describeConfirmation` → title/body/labels,
> tested) + a modal `ConfirmDialog` (Enter=confirm, Esc/scrim=cancel) wired into the
> launcher's single action choke-point: `App.runItem` now refactors execution into
> `executeResolved` and, for any `dangerous` action, shows the preview first and only
> runs on approval. The natural-language **Restart Relay** intent is marked dangerous
> and is the first consumer (it actually restarts a process, so it must confirm).
> **Slice 3 — AI runtime foundation (priority 7), `@orbit/ai-runtime`** (new pure
> package, 34 tests; NOT yet wired to a user surface, per Phase 3 "no AI UI before the
> runtime is reliable"): `AiProvider` contracts (health/listModels/complete/stream,
> `AbortSignal` cancellation, `local` flag, typed `AiError`); **MockProvider**
> (deterministic/offline/scriptable, streams) and **OllamaProvider** (local models
> over an *injected* fetch — `/api/tags`, `/api/chat` NDJSON streaming, `format:json`,
> usage mapping, never auto-pulls, typed unreachable/cancel). **Validated AI intent
> classification** (`classify.ts`) — the deterministic-first fallback: the model is
> constrained to a single known intent + whitelisted slots and the output is
> hard-validated (unknown intents/fields/agents dropped, strings clamped), so AI can
> only point at an existing safe intent and never widen Orbit's action surface.
> **Deliberately does not duplicate the Model Intelligence Gateway** (Auto routing
> stays server-side). Added `intentRequiresConfirmation`/`ALL_INTENTS`/`isIntentName`
> to `@orbit/intent` (shared validation). Docs: `docs/architecture/AI_RUNTIME.md`.
> **Honest scope:** no AI button is wired into Root Search yet — there's no configured
> live model/credential, and a mock-backed "AI" result would fake a capability; the
> AI-classification fallback + Quick AI surface land once a provider is configured
> (`agentos-auto` is blocked on the Gateway HTTP adapter; direct providers need OS
> secure-storage credentials). **Counts: 351 JS tests** (+23) **/ 123 Rust**
> (unchanged); lint, strict typecheck, `vite build`, `cargo check --workspace` green.
> Confirmation dialog + NL journeys remain to be GUI-verified on the next `tauri dev`.

> **Update (session 7c, 2026-06-17, branch `claude/orbit-ai-runtime`) — Phase 4: Quick AI.**
> The first AI surface, built end-to-end on the `@orbit/ai-runtime` foundation.
> `QuickAiView` (new `quick-ai` launcher view): prompt input, optional **Clipboard
> context chip**, streaming output with **Stop**, **Copy** and **Paste-into-active-app**
> (paste reuses the confirmation dialog from slice 2), an explicit **on-device /
> leaves-device privacy badge**, and bounded **recent prompts**. Reachable via a new
> "Quick AI" Root Search command and from any AI-shaped natural-language request — the
> intent provider's `unsupported-ai` items now **open Quick AI pre-filled** instead of
> a web-search fallback (`ask ai …`, `summarise the clipboard`, `explain this error`).
> Pure logic is unit-tested: `ai/providerConfig.ts` (settings→provider factory; Mock /
> None reachable now, Ollama constructed faithfully but gated) and `ai/quickAi.ts`
> (`buildMessages` with a prompt-injection guard treating context as data, bounded
> recent-prompt list) — 12 tests. New **Settings → AI** section picks the provider and
> saves the Ollama endpoint/model.
> **Honest status:** the active provider is the **offline Mock** (clearly labelled — it
> returns a synthetic placeholder, not real answers) or **None**. Real local **Ollama**
> and cloud providers need a **native AI HTTP bridge** (the renderer can't reach
> localhost under the Tauri CSP, and no Rust HTTP client exists yet — deliberately not
> added blind this session); the OllamaProvider + Settings are ready for it. **Counts:
> 364 JS tests** (+13) **/ 123 Rust** (unchanged); lint, strict typecheck, `vite build`,
> `cargo check --workspace` all green. Quick AI is not GUI-run here — the controller +
> provider factory are unit-covered; live streaming/paste want a `tauri dev` pass.

> **Update (session 7d, 2026-06-17, branch `claude/orbit-ai-runtime`) — Phase 7: AI
> Commands.** Reusable, named AI behaviours surfaced in Root Search and run through
> Quick AI. New pure `ai/aiCommands.ts`: a 9-command starter library (Improve Writing,
> Fix Spelling & Grammar, Make Shorter, Make Professional, Summarise, Explain, Translate
> to English, Write Commit Message, Create JSON), `renderAiCommand` (`{input}`
> substitution), and a Root Search provider — 6 tests. Selecting a command opens Quick
> AI **pre-filled and auto-running**, with the clipboard pre-attached where the command
> uses it (carried via a new `encode/decodeQuickAiArg` launch codec on the quick-ai
> push-view arg; `QuickAiView` now decodes prompt + useClipboard + autoRun). **Honest
> scope:** a user-editable command store/editor, richer placeholders ({selection},
> {browser}, …), per-command hotkeys and import/export are later; answers are only as
> real as the configured provider (offline Mock today). **Counts: 370 JS tests** (+6) **/
> 123 Rust** (unchanged); lint, strict typecheck, `vite build`, `cargo check
> --workspace` all green. Not GUI-run here.

> **Update (session 8, 2026-06-18, branch `claude/orbit-ai-runtime`) — Phase 8: MCP
> client + Tool Registry.** New pure `@orbit/tool-registry` (39 tests): a unified
> `ToolRecord` vocabulary across sources (native/relay/agentos/extension/mcp/ai-
> provider); **risk + approval policy derived from declared side effects** (write/
> delete/send/run/push/publish/deploy/spend force confirmation; high/critical risk
> is **once-only**, never persistent — §21); an **MCP client** speaking JSON-RPC 2.0
> over an *injected* transport (discovery + `tools/call`, **bounded** output, typed
> `McpError`, failure isolation); a `MockMcpTransport` that exercises the whole path;
> `validateArgs` at the tool choke-point; and `nativeToolRecords()` publishing Orbit's
> own safe capabilities (incl. **dispatch_agent via Relay**) so native + MCP tools are
> uniform. Renderer: `buildToolRegistry()` (native + a clearly-labelled in-process demo
> MCP server) + an **MCP & Tools** view (registry by source, risk/approval badges,
> schema inspector, gated test-call) reachable from a new command. **Honest gap:** live
> stdio/HTTP MCP servers need a **native MCP bridge** (renderer can't spawn/socket under
> the CSP); the demo server is in-process mock and the server-settings UI lands with the
> bridge. Untrusted MCP annotations only ever *raise* caution. **Counts: 409 JS tests**
> (+39) **/ 123 Rust** (unchanged — no Rust touched); lint, strict typecheck, `vite
> build`, `cargo check --workspace` all green. Not GUI-run here. This is the tool/
> permission foundation the Phase 9 Mission engine dispatches through. See
> [docs/architecture/MCP_TOOL_REGISTRY.md](docs/architecture/MCP_TOOL_REGISTRY.md).

> **Update (session 9, 2026-06-18, branch `claude/orbit-ai-runtime`) — Phase 9: Mission
> engine / Orbit Agent.** The "tell Orbit what to do and it does it" surface, built on
> the Phase 8 Tool Registry. New pure `@orbit/mission` (14 tests): a `MissionPlan` is an
> ordered list of steps, each referencing a **registry tool id** with args validated
> against the tool schema — so a planner (deterministic *or* model) can only assemble
> Orbit's existing safe capabilities (`parseMissionPlan` hard-validates exactly like
> `classify.ts`). **Deterministic-first** `planDeterministically` maps recognised goals
> to a one-step plan with **no AI call**; `planMission` only calls the injected provider
> when nothing is recognised. Renderer (26 tests): `agentDispatch.ts` launches a local
> agent through Relay's real `listAgents → createLaunchPlan → executeLaunch(confirm:true)`
> flow (pure `chooseAgent`; executes only after approval); `missionExecutor.ts` maps each
> whitelisted tool to a real action (no generic run-command); `agentProvider.ts` routes NL
> agent goals. **OrbitAgentView**: provider/Relay banners, plan preview with per-step
> risk/rationale, per-step confirmation (Approve/Skip), sequential run with Stop, bounded
> results, "Open result" nav. Command "Orbit Agent" + NL ("agent: …", "have an agent …",
> "ask orbit to …", "… for me"). **Honest gaps:** multi-step AI planning needs a real
> provider (Mock can't plan — the view says so); **model routing preview** stays the
> AgentOS Model Gateway's job (surfaces when its adapter lands — not duplicated); mission
> persistence/audit/handoffs, a unified Approval Centre, and remote Gateway/Hermes dispatch
> are later. **Counts: 440 JS tests** (+31) **/ 123 Rust** (unchanged — no Rust touched);
> lint, strict typecheck, `vite build`, `cargo check --workspace` all green. Not GUI-run
> here. See [docs/architecture/AI_AGENT_MODE.md](docs/architecture/AI_AGENT_MODE.md).

> **Update (session 5h, 2026-06-15) — Priority 2b: file content indexing (opt-in).**
> Migration **0007** adds a standalone `files_content_fts(path UNINDEXED, content)`
> (separate from the always-on metadata `files_fts`; cleared wholesale on rebuild).
> `orbit-files::Entry` gained an optional `content` field (walker leaves it `None`);
> the indexer reads small text/code files (≤256 KiB, allow-listed extensions, ≤200k
> chars, read **off the DB lock**) only when `files.content_indexing` is enabled
> (off by default), and `file_search` merges content matches after name/path
> matches (deduped, capped). New Settings → Files toggle + updated privacy copy
> (contents stored locally, never uploaded). Tests: `orbit-core`
> content-search/clear, `orbit-desktop` `is_text_ext`. **123 Rust / 184 JS**, gate
> green. **Still remaining:** an incremental filesystem watcher (today the index
> updates on rebuild — the journey's "modify/rename → index updates" needs a manual
> rebuild) and Priority 6 (Notes/Quicklinks must be re-verified through the live
> GUI — not runnable in this headless environment; the manual checklist below
> stands and the underlying commands/providers are unit-covered).

## How to verify the build yourself (do this first)

```bash
npm install
npm test                         # expect 144 passed
npm run lint                     # expect clean
npm run typecheck                # expect clean (strict tsc, all workspaces)
cargo test --workspace           # expect 104 passed
cargo check --workspace          # expect Finished
npm run dev:desktop              # opens the launcher; press Alt+Space to toggle
```
If `cargo` isn't found, use `C:\Users\Simon Wood\.cargo\bin\cargo.exe`.

When you run `npm run dev:desktop`, sanity-check the real journeys: hotkey toggle,
type an app name and Enter to launch, type `125*8` for a calc result, run a
"Left Half" window command on a previously-focused window, open "Clipboard
History", copy something elsewhere and confirm it appears.

## Repository map

```
apps/desktop/
  src-tauri/src/
    main.rs              entry → orbit_desktop_lib::run()
    lib.rs               setup: hotkey, tray, window lifecycle, DB init, monitor, IPC registry
    commands.rs          ALL IPC commands (AppState lives here)
    apps.rs              installed-app enumeration (Win/mac/Linux)
    window_mgmt.rs       Win32 apply of computed window rects
    clipboard_monitor.rs background arboard poll → orbit-core::clipboard
    tauri.conf.json      window config, CSP, bundle targets, tray
    icons/               generated from scripts/generate-icon.mjs
  src/                   React renderer
    App.tsx              launcher: search state, keyboard, nav stack (root↔clipboard)
    native.ts            typed wrappers over invoke()  ← only native surface
    builtins.ts          built-in commands + their effects (window, clipboard, web search, quit, reindex)
    providers.ts         app provider + calculator provider
    execute.ts           the single ActionToken executor (returns {hide, pushView})
    components/          Icon, ResultRow, ActionMenu, Footer, ClipboardView
    styles.css           design tokens (dark default + light) + launcher CSS
packages/                pure, unit-tested TS (see CLAUDE.md rule 2)
  branding shared-types validation command-model search-engine calculator placeholders
crates/                  pure/native Rust
  orbit-core             SQLite open + migrations + db + clipboard data access
  orbit-search           native fuzzy matcher (mirrors @orbit/search-engine)
  orbit-window-manager   pure window-layout geometry
docs/                    ARCHITECTURE, PRODUCT_SPEC, DATA_MODEL, SECURITY_MODEL, THREAT_MODEL, IMPLEMENTATION_PLAN
scripts/generate-icon.mjs  dependency-free PNG generator for the app icon
```

## What is DONE and verified

- **Monorepo + tooling**: npm+cargo workspaces, strict TS base config, ESLint
  flat config, Prettier, Vitest, centralized branding, original icon + generator.
- **Native shell**: tray (open/quit), `Alt+Space` global hotkey toggle, frameless
  always-on-top launcher centred upper-third, hide-on-blur, SQLite opened +
  migrated on startup, typed IPC surface.
- **Root Search slice**: providers for applications (real OS scan), built-in
  commands, and a natural-language calculator; cancellable orchestration (slow
  providers never block fast ones, failures/timeouts isolated); ranking blends
  fuzzy relevance + usage + recency + pinned/favourite + confidence, with score
  explanations. Keyboard nav + compact Action Panel (`⌘K`).
- **Window management (Windows)**: 16 layouts applied to the previously-focused
  window via Win32; pure geometry unit-tested. Graceful error on mac/Linux.
- **Clipboard history**: arboard poll monitor → SQLite with dedupe, retention cap,
  sensitive-content heuristic; navigable view (filter, copy-back, **paste into
  the active app (⌘↵)**, delete, pin, masked secrets). NOTE: paste-injection now
  works (via `orbit-input`); DB is **not encrypted at rest** yet.
- **Snippets + paste-injection** (session 2): `orbit-core::snippets` CRUD + FTS
  (8 tests), `orbit-input` SendInput injection + tested trigger-matcher (10
  tests), Snippets CRUD view + root provider, validated input. Keyword
  auto-expansion watcher (LL keyboard hook) is wired but opt-in/off by default.
- **Verifiable engines (no GUI needed)**: calculator (arithmetic/units/currency/
  base, no eval), placeholder engine (snippets/quicklinks), command registry +
  hotkey-conflict detection, Zod validation (manifest/deeplink/path/shell safety).

Test counts: **96 Vitest**, **45 Rust** (orbit-core 19, orbit-input 10,
orbit-search 8, orbit-window-manager 8). `clipboard_monitor.rs` has 2 more tests
only run under `cargo test -p orbit-desktop` (not part of the routine gate).

## What is NOT done (high level)

File search (Rust indexer + FTS5 — schema groundwork only), snippet system-wide
expansion, Quicklinks UI, emoji picker, system commands, calendar, notes, focus
mode, screenshots; the entire **extension runtime/SDK/CLI/store** (only the
manifest schema exists); **AI** (Quick AI/Chat/commands/agents); **MCP**; **cloud
sync/account/teams**; **browser extension**; **settings UI**; **onboarding**;
auto-update; packaging signing; secret vault; CI workflows. See FEATURE_MATRIX.md.

## Recommended next slices (in value order)

1. ~~**Snippet expansion + paste-injection**~~ — **DONE (session 2)**. New
   `orbit-input` crate (SendInput text injection + pure, tested keyword
   trigger-matcher), `orbit-core::snippets` CRUD+FTS, IPC commands, a Snippets
   CRUD view + root provider, and real paste-into-active-app for both snippets
   and clipboard. The system-wide keyword watcher (Win32 LL keyboard hook) is
   wired but **opt-in** (`snippets.expansion.enabled`, off by default) and its
   live hook path is not yet verified — that's the first thing to confirm/finish
   next (plus a settings toggle and dynamic-placeholder resolution in
   auto-expansion, which currently injects raw content).
2. ~~**File search**~~ — **DONE (session 3)**. `orbit-files` walker + rules,
   `orbit-core::files` (table + FTS5), background rebuild, root-search provider,
   Settings → Files. Opt-in, metadata-only. Next for File Search: a filesystem
   **watcher** for incremental updates (insert already supports upsert), optional
   **content indexing** behind its own toggle, a dedicated filtered File Search
   view, and virtualised result rendering for very large indexes.
3. ~~**Quicklinks**~~ — **DONE (session 3)**. `orbit-core::quicklinks` CRUD,
   `@orbit/validation` quicklink schema (scheme allowlist), management view +
   root-search provider with `{query}` argument resolution. Next for Quicklinks:
   tags/favourites/per-link hotkeys, custom icons, browser selection, import/
   export, and clipboard/selection placeholders in the provider path.

4. ~~**Settings window + configurable hotkey/theme**~~ — **DONE (session 3)**.
   Standalone native window with General/Appearance/Snippets/Privacy/Developer;
   configurable global hotkey (live re-register), theme/opacity/transparency/
   motion, watcher controls, clipboard privacy controls, diagnostics. Pure logic
   in `@orbit/appearance` + `@orbit/shortcuts`. Remaining Settings polish (not
   blocking): a Files section (will land with the File Search slice), launch-at-
   login (needs the autostart plugin), and excluded-apps for snippets/clipboard.
5. ~~**Extension host**~~ — **FOUNDATION DONE (session 3)**. `orbit-extensions`
   crate (manifest/protocol/permission/crash/discovery, 21 tests),
   `orbit-core::extstore` namespaced storage (migration 0006, 3 tests), a Rust
   host that spawns `node` per invocation with timed one-shot RPC + effect
   brokering + crash-loop breaker (`extension_host.rs`), `@orbit/extension-sdk`,
   two sample extensions (developer-utilities, agentos-status), a Root Search
   command provider + list view, and Settings → Extensions. See
   docs/architecture/EXTENSION_RUNTIME.md. **Next:** OS sandboxing of the child
   (AppContainer/job objects), a bundled JS runtime (currently `node` from PATH),
   secrets API, more command modes (view/detail/form), hot dev-reload, a typed
   SDK npm package + CLI. Do NOT start the extension store yet.
6. ~~**Notes**~~ — **DONE (session 3)**. `orbit-core::notes` (CRUD + FTS5,
   pin/archive), a Notes view with an autosaving editor + searchable list, and a
   root-search note provider. Next: rendered Markdown preview, version snapshots,
   note templates, and an archive browser.
7. ~~**Small built-ins**~~ — **DONE (session 3)**: `@orbit/tools` (colour, JSON,
   secure password, UUID) wired as an instant Root Search tools provider. Next
   easy additions: hash (Web Crypto), emoji/symbol picker, base/number convert,
   lorem ipsum, slug.

## Manual desktop test checklist (session 3 — verify on next `tauri dev`)

Compile + unit tests are green; these GUI paths still want a human eye:
- Tray → "Settings…" (and the "Open Settings" command) opens a decorated window.
- General: record a new shortcut (e.g. Ctrl+Shift+Space); confirm it toggles the
  launcher and survives a restart; "Reset to Alt+Space" works; invalid/in-use
  shows an error.
- Appearance: switch theme + toggle reduced transparency / drag opacity → the
  Settings window updates instantly; reopen the launcher (Alt+Space) → it reflects
  the new look (contrast fix on busy wallpapers).
- Snippets: toggle expansion on → status shows "Watching — N keywords"; off →
  "Not watching"; Restart watcher is enabled only while running.
- Privacy: turn off clipboard capture → copying no longer adds history; change
  retention; "Clear clipboard history" empties it.
- Developer: version/paths populate; "Open data folder" reveals the dir.
- Returning from Clipboard/Snippets to Root Search re-focuses the search input.
- Files: enable indexing → status shows items counting up, then "N items
  indexed"; type ≥3 chars in the launcher and confirm files appear; Enter opens,
  "Reveal in File Manager" selects it, "Copy Path" copies; disabling clears the
  index; "Rebuild File Index" command works.
- Quicklinks: run "Quicklinks" → ⌘N create (e.g. title "GitHub Search", target
  `https://github.com/search?q={query}`, alias "ghs"); Enter opens it; from Root
  Search type "ghs tauri" and confirm it opens the search for "tauri"; a
  `javascript:` target is rejected with an error; edit/delete work.
- Notes: run "Notes" → type a title/body; confirm "saved" appears (autosave) and
  the note persists after closing/reopening; search finds it by title and body;
  from Root Search a matching note opens straight into the editor; ⌘N/⌘⌫ work.
- Extensions: Settings → Extensions → add the repo's `extensions/examples` path →
  Save & reload; "Developer Utilities" and "AgentOS Status" appear. From Root
  Search run "Generate UUID" (no-view → copies + toast); open "UUID History"
  (list, shows prior UUIDs); open "AgentOS Status" (list, filter by typing).
  Disable one and confirm its commands vanish from Root Search.

For any of these, follow CLAUDE.md architecture rules and end on the full
verification gate + a FEATURE_MATRIX update.

## Persistent memory

This project also has auto-memory at
`C:\Users\Simon Wood\.claude\projects\C--Users-Simon-Wood-Raycast-Clone\memory\`
(`orbit-project.md`, `orbit-honesty-bar.md`). That memory is specific to the chat
app; in Claude Code CLI, this `CLAUDE.md` + `HANDOFF.md` are the source of truth.

## Open caveats / risks to watch

- **GUI never launched here** — `tauri dev` compiles but a window wasn't visually
  exercised. First real run may surface window transparency/blur, focus-on-show,
  or hide-on-blur-during-devtools quirks.
- Clipboard monitor polls every 700ms and will re-capture Orbit's own copy-backs
  (deduped, harmless) — fine, but note if adding image support.
- `tauri.conf.json` is hand-maintained; if you rename via `packages/branding`,
  you must also update `productName`/`identifier`/icons there (consider adding the
  promised `scripts/sync-branding`).
- npm audit reports some advisories in dev deps (vite/esbuild chain); not fixed to
  avoid breaking changes — review before shipping.
