# Data Model

Orbit stores local data in a single SQLite database at the OS app-data dir
(`<app data>/Orbit/orbit.sqlite`), opened and migrated by
[`orbit-core`](../crates/orbit-core/src/db.rs).

## Migration strategy

- Forward-only. Migrations are an ordered list of SQL scripts in
  [`migrations.rs`](../crates/orbit-core/src/migrations.rs).
- The applied version is stored in `PRAGMA user_version`. On startup every
  migration with index ≥ the stored version is applied, **each in its own
  transaction**. A failure leaves the database on the last good version.
- Shipped migrations are immutable — schema changes are always a new appended
  migration, so existing user data is preserved across app updates.

Pragmas on open: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
`busy_timeout=5000`.

## Current schema (migrations 0001–0003)

| Table | Purpose |
| --- | --- |
| `settings` | key/value app settings |
| `commands` | optional persisted command metadata |
| `command_customisations` | alias / hotkey / favourite / pinned per command id |
| `command_usage` | use count + last-used epoch ms (powers ranking) |
| `applications` | indexed installed applications |
| `clipboard_entries` | clipboard history (kind, content, source app, sensitive, pinned, hash) |
| `snippets` + `snippets_fts` | text-expansion snippets with FTS5 search |
| `quicklinks` | parameterised links/targets |

### Design notes

- `command_customisations` and `command_usage` are keyed by **logical command
  id** and intentionally have **no foreign key** to `commands`: built-in and
  extension commands are defined in code and may have no `commands` row.
- `clipboard_entries.hash` has a partial unique index to collapse duplicates,
  and a `sensitive` flag for password-manager / secure-clipboard exclusion.
- `snippets_fts` is an FTS5 contentless-companion table over `snippets` for fast
  full-text search.

## Planned tables (future phases)

notes / note_versions, focus_sessions, ai_conversations / ai_messages /
ai_commands / ai_providers, ai_agents / agent_runs / agent_steps, mcp_servers /
mcp_tools, installed_extensions / extension_commands / extension_preferences /
extension_permissions / extension_storage, oauth_records, sync_records /
sync_tombstones / devices, audit_events, crash_reports. Tracked in
[FEATURE_MATRIX.md](../FEATURE_MATRIX.md).
