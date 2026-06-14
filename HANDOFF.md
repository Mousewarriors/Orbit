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
> (3) Fixed Root Search focus restoration when returning from a subview. Counts:
> **113 JS tests, 50 Rust tests**; lint/typecheck/`cargo check --workspace`/`vite
> build` all green. Not live-verified this session (compile + unit verified): the
> Settings window visuals and the live hotkey-rebind/keyword-hook paths — see the
> manual checklist below.

## How to verify the build yourself (do this first)

```bash
npm install
npm test                         # expect 91 passed
npm run lint                     # expect clean
cargo test -p orbit-core -p orbit-search -p orbit-window-manager   # expect 27 passed
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
2. **File search**. Add a Rust file indexer (walk + ignore lists + watcher) into
   a new crate, persist to the `applications`-style table + FTS5, expose a
   cancellable file provider that gates on query length (≥2-3 chars). The
   `SearchProvider` contract and orchestrator already support slow providers.
3. **Extension host**. Manifest validation (`@orbit/validation`) is done. Next:
   a Node sidecar child process, a restricted RPC bridge, permission broker in
   Rust, per-extension storage. Big; design in docs/EXTENSION_RUNTIME.md first.
4. ~~**Settings window + configurable hotkey/theme**~~ — **DONE (session 3)**.
   Standalone native window with General/Appearance/Snippets/Privacy/Developer;
   configurable global hotkey (live re-register), theme/opacity/transparency/
   motion, watcher controls, clipboard privacy controls, diagnostics. Pure logic
   in `@orbit/appearance` + `@orbit/shortcuts`. Remaining Settings polish (not
   blocking): a Files section (will land with the File Search slice), launch-at-
   login (needs the autostart plugin), and excluded-apps for snippets/clipboard.

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
