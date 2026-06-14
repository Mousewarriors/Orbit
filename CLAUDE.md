# CLAUDE.md — Orbit

Guidance for Claude Code working in this repo. Read [HANDOFF.md](HANDOFF.md) for
the detailed current status and roadmap; read [FEATURE_MATRIX.md](FEATURE_MATRIX.md)
for honest per-feature status before claiming anything works.

## What this is

**Orbit** — an original, cross-platform, keyboard-first productivity launcher
(Raycast-style category, but **no** Raycast name/assets/code). "Orbit" is a
temporary name; all product identity lives in
[`packages/branding`](packages/branding/src/index.ts) — never hard-code the name
elsewhere. Tagline: "Everything on your computer, one shortcut away."

Stack: **Tauri 2 + Rust** shell, **React 18 + strict TS + Vite** renderer,
**SQLite (rusqlite, bundled)** with forward-only migrations.

## Environment & toolchain quirks (this machine — important)

- **Package manager = npm workspaces.** `pnpm` is supported via
  `pnpm-workspace.yaml`, but the global `pnpm` shim is a **broken corepack stub**
  here. Use `npm`. (A working pnpm exists at
  `C:\Users\Simon Wood\AppData\Roaming\npm\pnpm.cmd` if ever needed; do not try to
  delete the corepack shims in `C:\Program Files\nodejs` — it's blocked.)
- **Cargo** may not be on PATH in every shell. It lives at
  `C:\Users\Simon Wood\.cargo\bin\cargo.exe`. If `cargo` isn't found, call it by
  full path. Rust 1.96 (MSVC), VS C++ Build Tools and WebView2 are installed.
- Node 22, git present. Platform: Windows 11. Shell tools available: PowerShell
  and bash.

## Commands

```bash
npm install                                   # install all workspaces
npm test                                       # Vitest — 91 tests
npm run lint                                    # ESLint flat config, 0 warnings
npm run typecheck --workspaces --if-present     # strict tsc per package
cargo test -p orbit-core -p orbit-search -p orbit-window-manager   # 27 Rust tests
cargo check --workspace                         # compiles the whole Tauri app
npm run dev:desktop                             # tauri dev — opens launcher (Alt+Space)
npm run build --workspace @orbit/desktop        # tauri build (installer)
```

Run `cargo check -p orbit-desktop` after touching any Rust under
`apps/desktop/src-tauri`. Do NOT run `cargo test -p orbit-desktop` casually — it
builds the full GUI test harness (slow).

## Verification gate (run before declaring a slice done)

lint → typecheck → `npm test` → `cargo test` (libs) → `cargo check --workspace` →
`vite build` (`npm run build:vite -w @orbit/desktop`). Then update
FEATURE_MATRIX.md. Fix failures before moving on — prefer fixing the
test/design over weakening assertions.

## Architecture rules (do not violate)

1. **OS logic lives in Rust, never in React.** The renderer touches native
   capability only through `apps/desktop/src/native.ts`, which wraps the IPC
   commands in `apps/desktop/src-tauri/src/commands.rs`. Add a new capability =
   new typed command + new `native.ts` wrapper.
2. **Pure logic goes in `packages/*` (TS) or `crates/*` (Rust) with unit tests.**
   Keep GUI-free so it's testable. Performance-critical algorithms are mirrored
   in Rust (`crates/orbit-search` mirrors `packages/search-engine` scoring).
3. **Actions are declarative, not closures.** A result carries an `ActionToken`
   (serialisable); the single executor `apps/desktop/src/execute.ts` turns it into
   an effect. To add an action type, extend `ActionToken` in
   `packages/shared-types` and handle it in `execute.ts`.
4. **DB migrations are append-only.** Never edit a shipped migration in
   `crates/orbit-core/src/migrations.rs`; append a new SQL string. Version is
   tracked by `PRAGMA user_version`.
5. **Security at the boundary.** Validate untrusted input (deeplinks, manifests,
   paths, shell args, URLs) via `packages/validation`; the native layer
   re-checks. No `eval` ever (calculator is a hand-written parser).

## TypeScript conventions (strict + `exactOptionalPropertyTypes`)

- Optional **component props** must be typed `T | undefined`, NOT `prop?: T`
  (exactOptionalPropertyTypes rejects passing explicit `undefined` to `?`).
- Use `.js` extensions on relative imports (Bundler resolution maps to `.ts`).
- `verbatimModuleSyntax` is on → use `import type` for type-only imports.
- `noUncheckedIndexedAccess` is on → index access yields `T | undefined`.

## Known gotchas (already hit — don't rediscover)

- SQLite `ON CONFLICT(col)` against a **partial** unique index must repeat the
  predicate: `ON CONFLICT(hash) WHERE hash IS NOT NULL DO UPDATE …`.
- `windows` crate 0.58: `SetWindowPos`'s insert-after takes `HWND` directly
  (e.g. `HWND_TOP`), not `Option<HWND>`.
- `command_usage` / `command_customisations` have **no FK** to `commands` (built-in
  & extension command ids are code-defined, not persisted).
- Calculator results carry the raw query as a `keyword` so the ranker keeps them
  (their result text never matches the typed query).
- Window-management captures the foreground window in `toggle_launcher` **before**
  showing Orbit (so it targets the user's previous window, not Orbit).

## Honesty bar

This is a huge spec built in vertical slices; most of it is not done yet. Only
mark a feature done when interface + native/server logic + persistence +
permission enforcement + error handling + keyboard + tests all exist. Keep
FEATURE_MATRIX.md current and conservative. When a service/credential is
unavailable, build the real adapter + a realistic local mock and say which is
active.
