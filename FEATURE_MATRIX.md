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
| Vitest unit tests | ✅ | 127 passing |
| Rust unit/integration tests | ✅ | 100 passing (orbit-core 38, orbit-extensions 21, orbit-files 10, orbit-input 15, orbit-search 8, orbit-window-manager 8) |
| Centralised branding | ✅ | `packages/branding` |
| Original icon + generator | ✅ | `scripts/generate-icon.mjs` + Tauri icon set |
| CI workflows | ⬜ | documented, not yet added |
| Packaging/signing config | 🟡 | `tauri.conf.json` targets set; signing not configured |
| Auto-update | ⬜ | — |

## Native shell (Tauri 2 / Rust)

| Item | Status | Notes |
| --- | --- | --- |
| System tray (open/quit/settings) | ✅ | `lib.rs::build_tray` |
| Global hotkey (Alt+Space) | ✅ | **configurable** at runtime via Settings → General (shortcut recorder); re-registered live and persisted (`general.hotkey`) |
| Settings window (native, standalone) | ✅ | second decorated Tauri window (`index.html#/settings`); sections: General (hotkey), Appearance, Snippets, Privacy, Developer. Opened from tray, the "Open Settings" command, or `open_settings` IPC |
| Appearance (theme / opacity / reduced transparency / reduced motion) | ✅ | pure `@orbit/appearance` model (11 tests); applied live to the Settings window, applied to the launcher on next show; addresses low-contrast-on-busy-backgrounds via solid/reduced-transparency mode |
| Launcher window (frameless, on-top, centred, hide-on-blur) | ✅ | `tauri.conf.json` + `lib.rs`; **run end-to-end** — Alt+Space toggle, search, calc, clipboard & snippets views verified live (fixed a startup panic from a malformed `plugins.global-shortcut` config) |
| Text injection / paste (SendInput) | ✅ (Windows) / 🟡 | `orbit-input` crate; powers snippet & clipboard paste into the active app; macOS/Linux return a graceful error |
| SQLite open + migrations | ✅ | `orbit-core`, `user_version` strategy, tested |
| IPC command surface | ✅ | `commands.rs`, all typed `Result` |
| Application enumeration | ✅ (Win/mac/Linux) | Start Menu `.lnk` / `.app` / `.desktop` |
| Crash recovery (renderer/ext host) | ⬜ | — |
| Per-command hotkeys / aliases UI | ⬜ | model exists, no UI |
| Privacy controls (clipboard capture toggle, retention, clear) | ✅ | Settings → Privacy; honoured live by the clipboard monitor (`privacy.clipboard.enabled` / `.retention`) |

## Root Search

| Item | Status | Notes |
| --- | --- | --- |
| Fuzzy matching (exact/prefix/acronym/subsequence/typo) | ✅ | TS + Rust mirror, tested |
| Ranking (usage/recency/pinned/favourite/confidence) | ✅ | tested, with score explanations |
| Cancellable, non-blocking provider orchestration | ✅ | tested (timeout/error isolation) |
| Application provider | ✅ | slice |
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
| Local file search | ✅ (Windows) / 🟡 | **Opt-in, metadata-only.** Pure walker + rules (`orbit-files`, 10 tests), `files` table + FTS5 (`orbit-core::files`, 7 tests), background cancellable/self-superseding rebuild in transactional batches, root-search provider, Settings → Files (roots/excludes/hidden/rebuild/status), `reveal_path` (no shell). Full-rebuild only (no fs watcher yet); no content indexing. See [docs/architecture/FILE_SEARCH.md](docs/architecture/FILE_SEARCH.md). Cross-platform walker; reveal selects on Windows, opens parent elsewhere |
| Notes | ✅ | `orbit-core::notes` CRUD + FTS5 over title+body, pin/archive (5 tests); Notes view with a searchable list + autosaving editor (debounced + on-blur), ⌘N/⌘⌫, crash-safe (saves on blur/escape); root-search note provider. Markdown is stored/edited as plain text (no rendered preview yet); version snapshots are future |
| Built-in tools (UUID / password / colour / JSON) | ✅ | pure `@orbit/tools` (11 tests): colour conversion (#hex/rgb→hex/rgb/hsl), JSON format/minify, secure password (crypto RNG, guaranteed character classes), UUID; surfaced as instant Root Search results that copy on Enter |
| Emoji & symbols | ⬜ | — |
| System commands | 🟡 | "Open Settings", "Rebuild File Index", "Reindex Applications", "Quit" exist as built-ins; broader system commands ⬜ |

## Extensions, AI, MCP, sync, teams, browser

| Area | Status | Notes |
| --- | --- | --- |
| Extension manifest schema + validation | ✅ | `@orbit/validation` (renderer) + `orbit-extensions::manifest` (host), both tested |
| Extension runtime (host, RPC, broker, storage, crash isolation) | 🟡 | **Foundation built.** Isolated child-process host (spawn-per-invocation), versioned schema-validated RPC, permission-brokered effects, namespaced storage (`orbit-core::extstore`), crash-loop breaker, Root Search command provider + list view, Settings → Extensions, two sample extensions. Verified by unit tests (orbit-extensions 21) + real Node RPC round-trips. **Not** OS-sandboxed beyond process isolation; uses `node` from PATH; not GUI-run here. See [docs/architecture/EXTENSION_RUNTIME.md](docs/architecture/EXTENSION_RUNTIME.md) |
| Extension SDK | 🟡 | `@orbit/extension-sdk` (one-shot stdin/stdout helper) + two working samples; no typed npm package/CLI yet |
| Extension store | ⬜ | not started (intentionally deferred) |
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
