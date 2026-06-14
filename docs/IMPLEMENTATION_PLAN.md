# Implementation Plan

Orbit is built in vertical slices: every phase ends with a usable application,
not disconnected infrastructure.

## Phase 1 — Native foundation ✅ (this build)

Monorepo, Tauri shell, tray, global hotkey, launcher window, navigation, command
registry, local DB + migrations, theming tokens. **Vertical slice:** install →
launch → tray → hotkey → search apps/commands/calculations → run → close →
persist usage.

## Phase 2 — Core launcher 🟡 (started)

Root Search ✅, ranking ✅, applications ✅, built-in commands ✅, Action Panel 🟡,
favourites/recents, aliases, per-command hotkeys, diagnostics UI.

## Phase 3 — Local productivity

File search (Rust indexer + FTS), clipboard history (monitor + UI), snippets
(system-wide expansion), Quicklinks UI, calculator surfacing ✅ (engine done),
emoji, system commands, window management.

## Phase 4 — Personal tools

Calendar, notes (crash-safe), focus mode, screenshots, browser extension,
context capture.

## Phase 5 — Extension ecosystem

Extension host (child process), RPC bridge, SDK, CLI, UI components, manifests
✅ (schema), preferences, permissions broker, OAuth (PKCE), developer mode,
extension store, sample extensions.

## Phase 6 — AI

Provider abstraction, Quick AI, AI Chat, AI Commands, local Ollama, BYOK,
attachments, browser context, dictation, personalisation, memory.

## Phase 7 — Agents & MCP

MCP client, server manager, tool permissions, agent state machine, plan view,
approval gates, budgets, audit history, AgentOS extension.

## Phase 8 — Cloud & teams

Account system, encrypted sync, devices, organisations, shared snippets /
Quicklinks / private extensions, roles, audit logs, billing-ready architecture.

## Phase 9 — Hardening

Accessibility (WCAG 2.2 AA), performance budgets, crash recovery, auto-update
(signed), security review, packaging & signing, telemetry controls, full test
suites, documentation.

## Engineering loop (every slice)

format → lint → typecheck → `cargo check`/`cargo test` → unit tests → run the app
→ verify the main journey → update FEATURE_MATRIX → fix failures before moving on.
