# Feature Matrix — honest status

Legend: ✅ done & tested · 🟡 partial / slice · 🧪 logic done, UI/native pending ·
⬜ not started

This file is the source of truth for what actually works. It is intentionally
conservative: a feature is only ✅ when interface + logic + persistence +
permissions + error handling + keyboard + tests are all present.

## Foundation & tooling

| Item | Status | Notes |
| --- | --- | --- |
| Monorepo (npm + cargo workspaces) | ✅ | pnpm also supported |
| Strict TypeScript everywhere | ✅ | `tsconfig.base.json`, all packages clean |
| ESLint + Prettier | ✅ | flat config, 0 warnings |
| Vitest unit tests | ✅ | 184 passing (incl. the `@orbit/api` SDK suite, the `orbit` CLI end-to-end lifecycle, the AgentOS-controller discoverability checks, desktop route-selection, Root Search discoverability, the application-launch journey, provider-isolation regression, and a Settings render smoke test) |
| Rust unit/integration tests | ✅ | 123 passing across the workspace (orbit-core 40, orbit-extensions 27, orbit-input 15, orbit-desktop 15, orbit-files 10, orbit-search 8, orbit-window-manager 8) + 1 opt-in `#[ignore]` real-launch test |
| Centralised branding | ✅ | `packages/branding` |
| Original icon + generator | ✅ | `scripts/generate-icon.mjs` + Tauri icon set |
| CI workflows | ⬜ | documented, not yet added |
| Packaging/signing config | 🟡 | `tauri.conf.json` bundle complete (msi/nsis targets, publisher, icons, descriptions, currentUser install); **code-signing not configured** (needs an Authenticode/EV cert — documented in [docs/architecture/DISTRIBUTION.md](docs/architecture/DISTRIBUTION.md)). `tauri build` not run here |
| Single-instance + launch-at-login | 🟡 | `tauri-plugin-single-instance` (registered first; second launch focuses the existing window via `focus_launcher`) + `tauri-plugin-autostart` wired through `get_autostart`/`set_autostart` commands and a real Settings → General toggle (off by default). Compiles (`cargo check`) and is wired; runtime focusing / login-entry creation not GUI-verified here. See DISTRIBUTION.md |
| Diagnostics export | ✅ | Settings → Developer "Copy diagnostics" (version/platform/data paths JSON, no secrets) + "Open data folder" |
| Auto-update | ⬜ | intentionally deferred until a signed update-verification model exists (DISTRIBUTION.md) |

## Native shell (Tauri 2 / Rust)

| Item | Status | Notes |
| --- | --- | --- |
| System tray (open/quit/settings) | ✅ | `lib.rs::build_tray` |
| Global hotkey (Alt+Space) | ✅ | **configurable** at runtime via Settings → General (shortcut recorder); re-registered live and persisted (`general.hotkey`) |
| Settings window (native, standalone) | ✅ | second decorated Tauri window **declared in `tauri.conf.json`** (label `settings`, created/navigated at startup like the launcher; hidden-on-close so it is reused, not destroyed) — this is what fixed the blank window: a *runtime*-created webview strands on `about:blank` in `tauri dev`. `open_settings` (tray / "Open Settings" command / IPC) is show+focus of that window. The renderer selects the Settings UI from the window **label** via `route.ts::selectView` (unit-tested). All seven sections render (General/Appearance/Snippets/Files/Extensions/Privacy/Developer — server-render smoke test + live full-screen capture). Wrapped in a visible React error boundary so a renderer fault can't produce a silent blank window |
| Appearance (theme / opacity / reduced transparency / reduced motion) | ✅ | pure `@orbit/appearance` model (11 tests); applied live to the Settings window, applied to the launcher on next show; addresses low-contrast-on-busy-backgrounds via solid/reduced-transparency mode |
| Launcher window (frameless, on-top, centred, hide-on-blur) | ✅ | `tauri.conf.json` + `lib.rs`; **run end-to-end** — Alt+Space toggle, search, calc, clipboard & snippets views verified live (fixed a startup panic from a malformed `plugins.global-shortcut` config) |
| Text injection / paste (SendInput) | ✅ (Windows) / 🟡 | `orbit-input` crate; powers snippet & clipboard paste into the active app; macOS/Linux return a graceful error |
| SQLite open + migrations | ✅ | `orbit-core`, `user_version` strategy, tested |
| IPC command surface | ✅ | `commands.rs`, all typed `Result` |
| Application enumeration | ✅ (Win/mac/Linux) | Start Menu `.lnk` / `.app` / `.desktop` (fast, synchronous at startup). **Windows also merges UWP / Microsoft Store apps** via `Get-StartApps` in the background (Calculator, Terminal, Notepad, … which have no `.lnk`); `.lnk` wins on a name clash. PowerShell-optional: the `.lnk` baseline always stands |
| Application launch (native) | ✅ (Windows) / 🟡 | `launcher.rs`: classic apps/`.lnk`/files via `ShellExecuteW` **with COM initialised on the calling thread** + explicit "open" verb + `HINSTANCE` return-code checking (a failed launch is a visible error, never silent — this fixed "results appear but don't launch"); UWP/Store apps via `explorer.exe shell:AppsFolder\<AUMID>`. Stale/missing path → clear error. **Verified end-to-end opening real Calculator (UWP) and Notepad++ (`.lnk`) windows.** macOS/Linux fall back to the opener plugin |
| Crash recovery (renderer/ext host) | 🟡 | visible React error boundary contains renderer faults (shows the error + stack instead of a blank window); ext-host has a crash-loop breaker; full auto-restart ⬜ |
| Per-command hotkeys / aliases UI | ⬜ | model exists, no UI |
| Privacy controls (clipboard capture toggle, retention, clear) | ✅ | Settings → Privacy; honoured live by the clipboard monitor (`privacy.clipboard.enabled` / `.retention`) |

## Root Search

| Item | Status | Notes |
| --- | --- | --- |
| Fuzzy matching (exact/prefix/acronym/subsequence/typo) | ✅ | TS + Rust mirror, tested |
| Ranking (usage/recency/pinned/favourite/confidence) | ✅ | tested, with score explanations |
| Cancellable, non-blocking provider orchestration | ✅ | tested (timeout/error isolation). A provider whose `search` **or `canHandle`** throws is isolated and recorded, never global-failing the search; failures are logged (structured) and surfaced as a subtle "some sources unavailable" note in the launcher, while healthy providers' results are unaffected |
| Application provider | ✅ | apps (Win32 + UWP) → `open-path` launch action + "Copy Path"; launch failures surface as a visible error and are not recorded as usage (tested in `launch.test.ts`) |
| Command provider | ✅ | slice (built-ins) |
| Calculator provider | ✅ | slice |
| Snippet provider (root search) | ✅ | placeholder-resolved, gated to ≥2 chars; paste-injects on Enter |
| File provider (root search) | ✅ | queries the local file index, gated to ≥3 chars, runs concurrently under the per-provider timeout; actions: open / reveal / copy path |
| Note provider (root search) | ✅ | title+body FTS, gated ≥2 chars; opens the note in the Notes editor via a push-view action carrying its id |
| Extension command provider (root search) | ✅ | lists commands from enabled, non-crashed extensions; no-view runs in the child, list opens a streaming view |
| Clipboard / calendar providers | ⬜ | clipboard has its own view; calendar not started |
| Action Panel (keyboard, secondary actions) | 🟡 | compact menu implemented |
| Diagnostics ("why this ranked") | 🧪 | data produced; no UI |

## Local productivity engines

| Item | Status | Notes |
| --- | --- | --- |
| Calculator (arithmetic, functions, %, units, currency, base) | ✅ | `@orbit/calculator`, 20 tests, no `eval` |
| Clipboard history | ✅ | `arboard` poll monitor → SQLite (dedupe, retention, sensitive-flag heuristic); navigable view with filter, copy-back, **paste-into-active-app (⌘↵)**, delete, pin, sensitive masking. `orbit-core::clipboard` has 6 tests |
| Snippets manager (create/edit/delete/search, paste) | ✅ (Windows) | `orbit-core::snippets` CRUD + FTS (8 tests), validated input (`@orbit/validation`, re-checked natively), Snippets view + root provider; paste resolves placeholders then injects keystrokes. Created/listed verified live |
| Snippets expansion (system-wide keyword) | 🟡 | Pure trigger matcher (`orbit-input`, 10 tests) + pure lifecycle state machine (5 tests) + Win32 low-level-keyboard-hook watcher with a **controllable lifecycle** (start/stop/restart/status, idempotent, clean `UnhookWindowsHookEx` via `WM_QUIT`). IPC: `snippet_watcher_status` / `_set_enabled` / `_restart`. **Opt-in** via `snippets.expansion.enabled` (off by default; toggled live from Settings → Snippets). The live hook path (keystroke into a 3rd-party app) is still not verified end-to-end here (Defender blocks synthetic input). Auto-expansion injects raw content (dynamic placeholders resolve on the manual paste path only) |
| Snippet/Quicklink placeholder engine | ✅ | `@orbit/placeholders`, 13 tests (also used by snippet paste) |
| Quicklinks | ✅ | `orbit-core::quicklinks` CRUD (4 tests), Zod validation with scheme allowlist (`@orbit/validation`, re-checked natively), management view (create/edit/delete/open), root-search provider with `{query}` argument from an alias/title prefix + date/time/uuid resolution; web/mail targets open as URLs, paths via the OS handler. Tags/hotkeys/favourites/custom-icons/import-export are future |
| Window management | ✅ (Windows) / 🟡 | 16 layouts; pure geometry tested (`orbit-window-manager`, 8 tests) + Win32 apply via captured foreground window. macOS/Linux return graceful "Windows only" error |
| Local file search | ✅ (Windows) / 🟡 | **Opt-in, metadata-only.** Pure walker + rules (`orbit-files`, 10 tests), `files` table + FTS5 (`orbit-core::files`, 7 tests), background cancellable/self-superseding rebuild in transactional batches, root-search provider, `reveal_path` (no shell). **Settings → Files** now has: enable, roots, excludes, add-folder defaults (first-run "Index Documents/Desktop/Downloads"), rebuild, **clear index**, live progress, **last-indexed time**, **visible diagnostics** (unreadable folders skipped + unavailable/missing roots), hidden toggle. Robust: missing roots / unavailable drives skipped & reported, permission-denied dirs skipped, no symlink following (loop-safe), search cancellable. **Content indexing** (opt-in, off by default): migration 0007 adds a standalone `files_content_fts`; when enabled, the indexer reads small text/code files (≤256 KiB, allow-listed extensions, bounded to 200k chars, read off-lock) and `file_search` merges content matches after name/path matches (deduped). Stored locally, never uploaded; Settings → Files toggle + privacy copy updated. Tested (`orbit-core` content search/clear, `orbit-desktop` `is_text_ext`). **Remaining:** an incremental fs watcher (still full-rebuild only — `modify/rename → index updates` needs a rebuild today). See [docs/architecture/FILE_SEARCH.md](docs/architecture/FILE_SEARCH.md) |
| Notes | ✅ | `orbit-core::notes` CRUD + FTS5 over title+body, pin/archive (5 tests); Notes view with a searchable list + autosaving editor (debounced + on-blur), ⌘N/⌘⌫, crash-safe (saves on blur/escape); root-search note provider. Markdown is stored/edited as plain text (no rendered preview yet); version snapshots are future |
| Built-in tools (UUID / password / colour / JSON) | ✅ | pure `@orbit/tools` (11 tests): colour conversion (#hex/rgb→hex/rgb/hsl), JSON format/minify, secure password (crypto RNG, guaranteed character classes), UUID; surfaced as instant Root Search results that copy on Enter |
| Emoji & symbols | ⬜ | — |
| System commands | 🟡 | "Open Settings", "Rebuild File Index", "Reindex Applications", "Quit" exist as built-ins; broader system commands ⬜ |

## Extensions, AI, MCP, sync, teams, browser

| Area | Status | Notes |
| --- | --- | --- |
| Extension manifest schema + validation | ✅ | `@orbit/validation` (renderer) + `orbit-extensions::manifest` (host), both tested |
| Extension runtime (host, RPC, broker, storage, crash isolation) | 🟡 | **Foundation built + verified end-to-end via real Node RPC this session** (random-uuid → UUID+copy+storage+toast; uuid-history list; unknown-command error; agentos-status mock list). Isolated child-process host (spawn-per-invocation), versioned schema-validated RPC, permission-brokered effects, namespaced storage (`orbit-core::extstore`), crash-loop breaker, Root Search command provider + list view, two sample extensions. **Not** OS-sandboxed beyond process isolation; uses `node` from PATH. See [docs/architecture/EXTENSION_RUNTIME.md](docs/architecture/EXTENSION_RUNTIME.md) |
| Extension management (Settings) | 🟡 | Settings → Extensions shows, per extension: title, version, **description**, **health** (ready/degraded/unhealthy/disabled), **registered commands**, **requested permissions**, **last error**, a collapsible **Recent logs** block (bounded tail of the child's stderr from the latest run), **Open folder** + **Reload** actions, plus an obvious enable/disable toggle (no hidden menus). **Per-extension reload** re-discovers only that one and resets only its crash breaker (`reload_one`, tested — reloading one extension leaves another's tripped breaker intact). Developer folders (load by path), reload-all, and load-error diagnostics. Enable/disable **persists across restart** (file-backed DB test). Uninstall and live (streaming) log tailing are future |
| Extension SDK (`@orbit/api`) | ✅ (foundation) | Typed, ergonomic TS SDK over protocol v1: `defineExtension`, `List`/`List.Item`/`List.Section`, `Detail`, `ActionPanel`/`Action`, `showToast`, `copyToClipboard`/`openUrl`/`openPath` (the 3 brokered effects), typed `preferences`, namespaced local storage, structured logging to **stderr** (stdout stays the protocol channel), manifest types + `validateManifest`. 20 unit tests. Honest about the one-shot model: `showHUD` maps to a toast (`@experimental`); `pushView`/`popView` throw with guidance rather than silently no-op. `@orbit/extension-sdk` (the original JS helper) still ships |
| Extension CLI (`orbit`) | ✅ (foundation) | `orbit extension create\|dev\|build\|validate\|package\|logs` with 5 working templates (no-view/list/detail/preferences/storage); `create` emits a no-repair-needed extension; `package` writes a real `.zip` (dependency-free, `node:zlib` only). 12-step e2e test (vitest): create → validate → discover → run via the real one-shot protocol → modify → re-run (updated behaviour) → package, across all templates. Builds to `dist`; runs as a real Node bin (verified) |
| Extension store | ⬜ | not started (intentionally deferred) |
| AgentOS controller extension (observational) | 🟡 | `extensions/examples/agentos-controller` (uses `@orbit/extension-sdk`): list agents/sessions/projects, recent activity, pending approvals, agent health; actions open dashboard / agent workspace (open-url), open project folder (open-path), copy status/path. **Adapter interface** with mock (live default, clearly labelled) / local-JSON / HTTP (explicit URL, 4s timeout, graceful errors) — all verified via real Node RPC. **Strictly observational**: no shell/SSH/restart/dispatch/code-exec. Honest gap: protocol v1 doesn't yet forward preference *values* to the child, so json/http activate once a preferences-plumbing slice (storage + UI) lands; mock works now. See [docs/architecture/AGENTOS_ADAPTER.md](docs/architecture/AGENTOS_ADAPTER.md) |
| AI (Quick AI, Chat, commands, agents) | ⬜ | — |
| MCP client | ⬜ | — |
| Cloud sync / account / teams | ⬜ | — |
| Browser extension | ⬜ | — |

## Security

| Item | Status | Notes |
| --- | --- | --- |
| Deeplink validation (allowlisted routes) | ✅ | `@orbit/validation`, tested |
| Path-traversal / containment guards | ✅ | tested |
| Shell-argument & external-URL safety | ✅ | tested |
| No `eval` in calculator | ✅ | recursive-descent parser |
| Manifest hardening (lengths, identifiers, no traversal) | ✅ | tested |
| Extension process isolation + permission broker | 🟡 | extensions run as isolated child processes; effects/item-actions brokered against declared permissions; namespaced storage; crash-loop breaker (`orbit-extensions`, tested). **Not** OS-sandboxed yet (child has Node privileges) — see EXTENSION_RUNTIME.md |
| Secret vault, OS sandboxing of extensions | ⬜ | designed in SECURITY_MODEL |
