# File Search

Local file search lets Root Search find files and folders by name or path. It is
**opt-in**, **metadata-only** (never file contents), and entirely local.

## Components

| Layer | Where | Responsibility |
| --- | --- | --- |
| Walker + rules | `crates/orbit-files` | Pure indexing rules (`rules.rs`: extension/hidden detection, default + custom excludes) and a `std::fs` breadth-first `walk` that emits one `Entry` per file/dir. Cancellable, symlink-loop-safe (doesn't follow symlinks by default), skips unreadable dirs. |
| Index storage | `crates/orbit-core/src/files.rs` (migration 0004) | `files` table keyed by `path` + an external-content `files_fts` FTS5 mirror over `name`+`path`. `insert` (upsert), `clear`, `search` (prefix FTS, filters, recency fallback), `count`. |
| Orchestration | `apps/desktop/src-tauri/src/file_index.rs` | Background, cancellable rebuild on a worker thread; reads roots/excludes/hidden from settings; writes in transactional batches of 400 so the DB lock is held only briefly; self-supersedes via a generation counter. |
| IPC | `commands.rs` | `file_search`, `file_index_status`, `file_index_set_enabled`, `file_index_rebuild`, `reveal_path`. |
| Provider | `apps/desktop/src/providers.ts::createFileProvider` | Gated to ≥3 chars + Tauri; runs concurrently under the orchestrator's per-provider timeout so it never blocks apps/commands. Actions: Open, Reveal in File Manager, Copy Path. |
| Settings | `settings/Settings.tsx` → Files | Enable toggle, indexed/excluded folders, hidden toggle, live status + Rebuild. |

## Privacy & safety

- **Off by default.** Nothing is scanned until the user enables indexing in
  Settings → Files. Disabling clears the index.
- **Metadata only.** Name, path, parent, extension, size, created/modified times.
  No file contents are read or stored. (Content indexing is a future, separately
  gated feature.)
- **Default roots** are the user's Desktop / Documents / Downloads; default
  excludes always include `node_modules`, `.git`, `target`, build/cache dirs, and
  Windows system folders. Hidden files are skipped unless enabled.
- **No shell.** `reveal_path` uses `explorer.exe /select,<path>` with the path as
  a separate argument (no shell interpolation); open uses the OS opener with an
  indexed path.
- **Loop-safe.** Symlinks are not followed by default, so symlink cycles and
  reparse points cannot trap the walker.

## Known limitations / next steps

- Indexing is a **full rebuild** (no filesystem watcher yet); `insert` already
  supports incremental upsert, so a watcher can be layered on.
- No content indexing, no per-extension include filter UI, no network-drive
  opt-in yet, and no virtualised result list (results are capped at 30 in the
  provider / 500 in the command).
- `permission broker` is not yet enforcing `files.read`; the action declares it
  for when the broker lands.
