# Orbit

> **Everything on your computer, one shortcut away.**

Orbit is a keyboard-first, cross-platform productivity launcher: summon it with a
global shortcut and search applications, run commands, do calculations, expand
snippets, manage windows and more — fast, local-first and private.

> **Naming.** _Orbit_ is a temporary working name. All product identity lives in
> [`packages/branding`](packages/branding/src/index.ts) so the product can be
> renamed without touching feature code.

> **Originality.** This is an original implementation inspired by the _category_
> of command launchers. It contains no third-party product's name, logo, assets,
> source or marketing copy.

---

## Current status (honest)

This repository is an in-progress build. The **foundation and a working Phase 1
vertical slice** are complete and verified; large parts of the full product
vision are **not yet implemented**. See [`FEATURE_MATRIX.md`](FEATURE_MATRIX.md)
for an honest, line-by-line status.

What works and is tested today:

- **Native shell** (Tauri 2 + Rust): system tray, a **configurable** global
  hotkey (default `Alt+Space`), frameless always-on-top launcher window,
  hide-on-blur, SQLite database with forward-only migrations.
- **Settings window** (standalone, native): configure the activation shortcut,
  appearance (theme, opacity, reduced transparency for high contrast on busy
  backgrounds, reduced motion), system-wide snippet expansion, clipboard privacy
  (capture toggle, retention, clear), and view diagnostics. Open it from the tray,
  the "Open Settings" command, or `Alt+Space` → "Settings".
- **Root Search slice**: applications (real OS enumeration), built-in commands,
  and a natural-language calculator — fuzzy-matched and ranked with usage/recency
  learning, fully keyboard-driven, with an Action Panel.
- **Window management** (Windows): 16 layouts (halves, quarters, thirds,
  maximize, center…) applied to the previously-focused window via Win32, with the
  geometry unit-tested in a pure crate.
- **Clipboard history**: background monitor → local SQLite store with duplicate
  collapsing, retention cap, and a navigable history view (filter, copy back,
  paste into the active app, delete, pin, sensitive-content masking). Capture is
  user-toggleable; at-rest encryption is planned.
- **Snippets**: a CRUD manager + root-search provider with placeholder expansion,
  paste-injection into the active app, and **opt-in** system-wide keyword
  expansion (Windows) with a controllable start/stop/restart lifecycle.
- **Local file search** (opt-in, metadata-only): a background indexer over your
  chosen folders feeds a root-search file provider (open / reveal / copy path).
  Nothing is scanned until you enable it; file contents are never read or stored.
  See [`docs/architecture/FILE_SEARCH.md`](docs/architecture/FILE_SEARCH.md).
- **Quicklinks**: saved, parameterised links (websites, web searches, files,
  mailto). Type an alias then your query — e.g. `ghs tauri` — and `{query}` is
  filled in. Managed in a dedicated view; dangerous URL schemes are rejected.
- **Notes**: fast local notes with an autosaving editor and full-text search;
  surfaced in Root Search and opened straight into the editor.
- **Built-in tools**: type `uuid`, `password 24`, a colour like `#ff8800`, or
  `json {…}` to get instant results you can copy.
- **Verifiable core packages** (platform-agnostic, 113 unit tests):
  search/ranking, calculator + unit/currency/base conversions, snippet/Quicklink
  placeholder engine, the appearance + shortcut-accelerator models, command
  registry + hotkey-conflict detection, and Zod validation for manifests /
  deeplinks / path & shell safety.

Verification gates currently green: ESLint, `tsc` (strict) across all packages,
Vitest (113), `cargo test` (50 lib), `cargo check` on the whole workspace, and
`vite build`.

## Repository layout

```
apps/
  desktop/            Tauri 2 app — Rust shell (src-tauri) + React renderer (src)
packages/
  branding/           Single source of truth for product identity
  shared-types/       Core domain types (commands, search items, actions, …)
  validation/         Zod schemas: manifest, deeplink, path/shell safety
  command-model/      Command registry, providers, hotkey parsing & conflicts
  search-engine/      Fuzzy matcher, ranking engine, cancellable orchestrator
  calculator/         Safe expression parser, units, currency, base conversions
  placeholders/       Snippet & Quicklink dynamic-placeholder engine
  appearance/         Pure theme/opacity/transparency/motion model
  shortcuts/          Pure global-shortcut accelerator parse/format
crates/
  orbit-core/         SQLite open + migrations + data access (Rust)
  orbit-input/        Text injection (SendInput) + keyword trigger + lifecycle
  orbit-search/       Native fuzzy matcher mirroring the TS engine (Rust)
docs/                 Architecture, security, data model, etc.
scripts/              Tooling (e.g. original app-icon generator)
```

## Prerequisites

- **Node 22+** and **npm 10+**
- **Rust 1.77+** (stable, MSVC toolchain on Windows) and **Cargo**
- Platform build tools: **MSVC C++ Build Tools + WebView2** (Windows), Xcode CLT
  (macOS), `webkit2gtk`/`libsoup` (Linux)

> **Package manager note.** This repo uses **npm workspaces**. `pnpm` is also
> supported via `pnpm-workspace.yaml`; if your `pnpm` shim is a broken corepack
> stub, run `npm i -g corepack@latest && corepack enable`, or just use npm.

## Quick start

```bash
npm install              # install all workspace dependencies

# Verify the core (no Rust needed):
npm run lint
npm run typecheck
npm test                 # 91 Vitest tests

# Verify / run the native crates:
cargo test -p orbit-core -p orbit-search
cargo check --workspace

# Run the desktop app (opens the launcher; press Alt+Space to toggle):
npm run dev:desktop      # = tauri dev
```

To regenerate the app icon set from the original generator:

```bash
npm run icon --workspace @orbit/desktop
```

## Documentation

| Doc | Contents |
| --- | --- |
| [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | System boundaries & data flow |
| [PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | Product vision & principles |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Local database schema & migrations |
| [SECURITY_MODEL.md](docs/security/SECURITY_MODEL.md) | Trust boundaries & controls |
| [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Phased roadmap |
| [FEATURE_MATRIX.md](FEATURE_MATRIX.md) | Honest per-feature status |

## License

MIT — see source headers. All artwork and copy are original to this project.
