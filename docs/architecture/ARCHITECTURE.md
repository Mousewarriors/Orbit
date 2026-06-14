# Orbit Architecture

Orbit is a desktop launcher built as a **Tauri 2** application: a Rust native
core plus a React/TypeScript renderer, with platform-agnostic logic factored
into reusable packages and crates.

## Guiding boundaries

1. **OS logic lives in Rust, never in React.** The renderer reaches native
   capability only through the typed IPC surface in
   [`commands.rs`](../../apps/desktop/src-tauri/src/commands.rs), wrapped by
   [`native.ts`](../../apps/desktop/src/native.ts).
2. **Pure logic is extracted into packages** (`packages/*`) so it can be unit
   tested without a GUI and reused by the renderer, extensions and tooling.
3. **Performance-critical algorithms are mirrored in Rust** (`crates/orbit-search`)
   for the large-index path, matching the TS engine's behaviour.
4. **Declarative actions, not closures, cross boundaries.** A result carries an
   `ActionToken` (a serialisable description); the single
   [`execute.ts`](../../apps/desktop/src/execute.ts) executor turns it into an
   effect. This keeps the renderer↔native↔extension surface auditable.

## Layered view

```
┌────────────────────────────────────────────────────────────────┐
│ Renderer (React, strict TS)                                      │
│   App.tsx ── providers ── execute.ts ── native.ts                │
│      │           │                          │                    │
│      │   @orbit/search-engine (rank/orchestrate)                 │
│      │   @orbit/calculator · @orbit/placeholders                 │
│      │   @orbit/command-model · @orbit/shared-types              │
└──────┼──────────────────────────────────────┼──────────────────┘
       │ Tauri IPC (validated commands)        │
┌──────┴──────────────────────────────────────┴──────────────────┐
│ Native core (Rust, src-tauri)                                    │
│   lib.rs: hotkey · tray · window lifecycle · setup               │
│   commands.rs: IPC surface (Result<_, String>)                   │
│   apps.rs: application enumeration                               │
│      │                         │                                 │
│   orbit-core (SQLite+migrations)   orbit-search (native fuzzy)   │
└─────────────────────────────────────────────────────────────────┘
```

## Windows & long-lived native subsystems

- **Two webview windows, one bundle.** The frameless always-on-top **launcher**
  (`label="launcher"`) and a normal decorated **Settings** window
  (`label="settings"`) are the *same* Vite bundle; `main.tsx` renders `<Settings/>`
  when the URL hash is `#/settings` (the window is created at
  `index.html#/settings` by `open_settings`). Only the launcher hides-on-blur.
- **Configurable activation shortcut.** The active `Shortcut` lives in
  `AppState.active_shortcut`; the global-shortcut handler matches against it, and
  `set_activation_shortcut` unregisters the old / registers the new / persists
  `general.hotkey` so a rebind is live and durable.
- **Snippet-expansion watcher** (`snippet_watcher.rs`, Windows) is a controllable
  subsystem: a pure `orbit_input::Lifecycle` decides start/stop idempotency; the
  `WH_KEYBOARD_LL` hook runs on its own thread with a message loop and unhooks
  cleanly on `WM_QUIT`. Injection happens on a separate worker thread (never from
  the hook), and self-injected events are tagged + ignored.
- **Appearance** is a pure model in `@orbit/appearance` (theme resolution,
  opacity, transparency, motion → DOM attributes/CSS vars); the launcher applies
  the saved appearance on show, the Settings window applies live. Accelerator
  parsing/formatting is the pure `@orbit/shortcuts`.

## Search pipeline

1. The renderer composes a set of `SearchProvider`s (command, application,
   calculator today; file/clipboard/etc. later).
2. [`runSearch`](../../packages/search-engine/src/orchestrator.ts) runs eligible
   providers concurrently. Each provider gets an `AbortSignal` and a timeout, so
   a slow provider can never block instant local results — partial results stream
   to the UI via `onUpdate`, and failures/timeouts are isolated per provider.
3. Merged items are scored by the
   [ranking engine](../../packages/search-engine/src/ranking.ts): textual
   relevance (from the [fuzzy matcher](../../packages/search-engine/src/fuzzy.ts))
   blended with usage frequency, recency decay, pinned/favourite and a provider
   confidence weight. Each result carries a `ScoreExplanation` for diagnostics.

## Data & persistence

`orbit-core` opens SQLite with WAL + sane pragmas and applies forward-only
migrations keyed by `PRAGMA user_version`, each in its own transaction so a
failure leaves the DB on the last good version and **user data survives updates**.
See [DATA_MODEL.md](../DATA_MODEL.md).

## Why these technologies

- **Tauri 2** over Electron: far smaller footprint, native webview, first-class
  Rust for OS integration and a real permission model.
- **Rust core** for hotkeys, window control, indexing and the secret vault —
  the places where correctness and isolation matter most.
- **Strict TypeScript + Zod** at the trust boundary (manifests, deeplinks).
- **SQLite (rusqlite, bundled)** for a dependency-free, embedded, fast local DB.

## Failure isolation (design)

- Extension commands run in a child process (planned); the registry can
  `unregisterExtension` to drop a crashed extension's commands without affecting
  built-ins.
- IPC commands never panic to the renderer: they return `Result<_, String>` and
  the UI renders actionable errors.
