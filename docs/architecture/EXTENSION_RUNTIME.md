# Extension Runtime (foundation)

Orbit extensions run **outside the launcher** as isolated child processes and can
only affect Orbit through a permission-brokered RPC. This document describes the
foundation slice — enough to build and run real extensions, with the security
boundary made explicit.

## Pieces

| Layer | Where | Responsibility |
| --- | --- | --- |
| Manifest | `@orbit/validation` (renderer) + `orbit-extensions::manifest` (host) | `manifest.json` schema: id/title/version/permissions/commands (modes `no-view`, `list`)/`main`. Both sides validate; the host is authoritative. |
| Protocol | `orbit-extensions::protocol` (Rust) ↔ `@orbit/extension-sdk` (JS) | Versioned (`v: 1`) one-shot RPC: host writes an `invoke` request to stdin, child writes one `result`/`error` to stdout. Schema-validated; version mismatch is rejected. |
| Permission broker | `orbit-extensions::permission` | Maps each effect to a required permission (`open-url`→`network`, `copy`→`clipboard.write`, `open-path`→`files.read`) and drops effects the manifest didn't declare. |
| Crash protection | `orbit-extensions::crash` | Per-extension circuit breaker: N failures (crash/timeout/garbage) within a window trips it; the host then refuses to invoke until reload/re-enable. |
| Discovery | `orbit-extensions::discovery` | Scans a directory's subfolders for a valid `manifest.json`; invalid folders are skipped with a reason. |
| Storage | `orbit-core::extstore` (migration 0006) | Per-extension namespaced key/value + enabled flag. An extension only ever sees its own namespace. |
| Host | `apps/desktop/src-tauri/src/extension_host.rs` | Spawns `node <main>`, performs the timed RPC, brokers effects, persists storage writes, tracks crashes. |
| IPC + UI | `commands.rs`, `providers.ts`, `ExtensionListView`, Settings → Extensions | Command list in Root Search, a list-command view, and management (enable/disable, reload, dev folders, load errors). |

## Lifecycle of one invocation

1. Renderer triggers a command (no-view from Root Search, or a keystroke in the
   list view).
2. Host snapshots the extension's storage namespace, builds an `InvokeRequest`.
3. Host spawns `node <dir>/<main>` (stdin/stdout piped, stderr discarded),
   writes the request, closes stdin.
4. Child (via the SDK) reads stdin, runs the handler, writes one response, exits.
5. Host reads stdout under a 5s timeout (killing the child if it overruns),
   `parse_response` (version-checked).
6. Host **brokers**: performs only the effects whose permission is declared;
   scrubs disallowed item actions; persists bounded storage writes.
7. List items are returned to the renderer; `no-view` effects are already done.

Because each call is its own process, a crashing or hanging extension can only
fail that one invocation — never the launcher — and the crash breaker stops a
crash loop.

## Protocol (v1)

Request (host → child, one JSON object on stdin):

```json
{ "v": 1, "type": "invoke", "command": "uuid-history", "query": "ab", "storage": { "history": "[...]" } }
```

Response (child → host, one JSON object on stdout):

```json
{ "v": 1, "type": "result",
  "items": [{ "id": "x", "title": "…", "subtitle": "…", "action": { "kind": "copy", "text": "…" } }],
  "effects": [{ "kind": "copy", "text": "…" }],
  "storageWrites": { "history": "[...]" },
  "toast": "Copied …" }
```

or `{ "v": 1, "type": "error", "message": "…" }`.

Effects/item actions: `open-url` (https/http/mailto, re-checked natively),
`copy`, `open-path`.

## Writing an extension

A folder with `manifest.json` + an entry module (default `index.mjs`):

```js
import { defineExtension } from '@orbit/extension-sdk';
defineExtension({
  'my-command': (ctx) => ({
    items: [{ id: '1', title: ctx.query || 'hello', action: { kind: 'copy', text: 'hi' } }],
    // effects: [...], storageWrites: { k: 'v' }, toast: '...'
  }),
});
```

See the bundled samples: `extensions/examples/developer-utilities` (no-view +
list + storage) and `extensions/examples/agentos-status` (safe mock list).

To load them in development: **Settings → Extensions → Developer folders**, add
the absolute path to `…/Orbit/extensions/examples`, then **Save & reload**.

## Security boundary (read this)

- **Process isolation, not OS sandboxing (yet).** Extensions run as separate
  `node` processes, so they cannot touch Orbit's renderer/host memory and can
  only *affect Orbit* through brokered effects + their own storage namespace.
  However the child process itself is **not** OS-sandboxed in this foundation —
  it has the privileges of `node`. Full sandboxing (Windows AppContainer / job
  objects, fs/network confinement) is future work.
- **Broker enforces declared permissions** for every effect and item action.
- **Namespaced storage** — no cross-extension reads/writes.
- **No shell**: the child is spawned with the script path as an argument (no
  shell interpolation). (The extension's own code can still use Node APIs — see
  the sandboxing caveat.)
- **Crash-loop protection** disables a misbehaving extension automatically.
- **Runtime**: uses `node` from `PATH` for now; a bundled runtime is future work.

## Not in this slice

Secrets API/secure storage for extensions, view/detail/form/menu-bar/background
modes, long-lived host processes, hot dev-reload on file change, an SDK npm
package with types, and the extension store. AI/MCP integration is intentionally
deferred.
