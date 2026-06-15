# AgentOS Controller — adapter interface & safety boundary

The `agentos-controller` example extension
(`extensions/examples/agentos-controller`) surfaces AgentOS state inside Orbit:
agents, sessions, projects, recent activity, pending approvals and per-agent
health. It is an **initial, safe, observational** controller — it reads and
displays state and offers a few brokered convenience actions, but it performs
**no** privileged or destructive operations.

It runs under plain Node via `@orbit/extension-sdk` (the one-shot stdin/stdout
protocol described in [`EXTENSION_RUNTIME.md`](EXTENSION_RUNTIME.md)), so there
is no build step.

## Adapter interface

Every adapter resolves to the same shared state shape (any missing array
defaults to `[]`):

```jsonc
{
  "agents":    [{ "name", "status", "task", "lastActivity", "project", "health" }],
  "sessions":  [{ "id", "agent", "project", "startedAt", "state" }],
  "projects":  [{ "name", "path", "agents": [..], "lastActivity" }],
  "activity":  [{ "at", "agent", "project", "message" }],
  "approvals": [{ "id", "agent", "project", "summary", "requestedAt" }]
}
```

An adapter returns `{ source, label, data }` on success or
`{ source, label, error }` on failure. It **never throws** out of the handler;
a failure becomes a single clean error item plus a toast, so a command always
returns valid `{ v: 1, type: 'result', ... }`.

The active adapter is chosen by the `source` preference (`mock` | `json` |
`http`), defaulting to `mock`. On any misconfiguration the extension falls back
to `mock` so commands keep working.

### 1. `mock` (default)

Realistic, fully offline sample data. Every row is labelled `mock data` in its
subtitle so it is never mistaken for live state. Requires no preferences and no
network.

### 2. `json` (local file)

Reads a JSON file whose absolute path comes from the `jsonPath` preference,
parses it, and normalises it into the shared shape. Missing file / bad JSON
yields a clean error item (e.g. `ENOENT`), not a crash.

### 3. `http` (read-only endpoint)

Fetches `GET <httpBaseUrl>/state` with:

- a hard timeout (`AbortSignal.timeout`, 4 s — under the host's 5 s RPC budget),
- `http`/`https` URLs only (other schemes are rejected before any request),
- graceful handling of non-2xx, timeout, and connection errors (each becomes an
  error item + toast).

## Preferences

| Preference             | Type      | Used when        | Purpose                                                            |
| ---------------------- | --------- | ---------------- | ------------------------------------------------------------------ |
| `source`               | dropdown  | always           | `mock` (default) \| `json` \| `http`                               |
| `jsonPath`             | file      | `source = json`  | Absolute path to the JSON state file                               |
| `httpBaseUrl`          | textfield | `source = http`  | Read-only AgentOS base URL (`http(s)` only); `GET {base}/state`    |
| `dashboardUrl`         | textfield | any              | URL opened by the "Open AgentOS Dashboard" action (`http(s)` only) |
| `workspaceUrlTemplate` | textfield | any              | Agent-workspace URL; `{agent}` is replaced with the agent name     |

> **Runtime note.** Protocol v1's `InvokeRequest` currently forwards
> `{ v, type, command, query, storage }` only — it does **not** yet plumb
> preference *values* to the child process. The manifest declares preferences
> (renderer-validated, future-ready) and handlers read `ctx.preferences`
> defensively, so today the extension runs on the `mock` adapter and will pick
> up `json`/`http` automatically once the host forwards preferences. Wiring
> preferences into `InvokeRequest` (Rust) + the host snapshot is the small
> follow-up that turns json/http on end-to-end.

## Actions (all brokered + permissioned)

The only effects the extension emits are the three brokered kinds, each
re-checked by the host's permission broker against the manifest:

- `open-url` (`network`) — open the dashboard, or an agent workspace built from
  `workspaceUrlTemplate` (validated as `http(s)` before emitting).
- `open-path` (`files.read`) — open a project folder.
- `copy` (`clipboard.write`) — copy agent/session/activity/health status, or a
  project path (when the query mentions "copy"/"path", since a v1 list item
  carries a single action).

"Refresh" is simply re-running a command — each invocation fetches fresh state —
so the refresh row carries a copy hint rather than pretending to hold mutable
state.

## Safety boundary — what is intentionally NOT supported (yet)

This slice is observational by design. It deliberately does **not** implement:

- shell / command execution, or SSH;
- service restarts, start/stop, or any lifecycle control;
- autonomous task dispatch or assignment to agents;
- approving/denying pending approvals from Orbit (approvals are surfaced read-
  only; approve them in AgentOS itself);
- code execution, file writes, or any destructive / privileged action.

Effects are limited to the brokered `open-url` / `open-path` / `copy` trio, and
all outbound URLs are validated as `http(s)`.

## Pointing it at a real AgentOS

1. Stand up a **read-only** state endpoint that returns the shape above at
   `GET {base}/state` (e.g. `http://127.0.0.1:8787/state`).
2. In **Settings → Extensions**, set `source = http` and `httpBaseUrl` to the
   base URL; optionally set `dashboardUrl` and `workspaceUrlTemplate`.
3. Alternatively, set `source = json` and `jsonPath` to a file your AgentOS
   tooling writes (handy for air-gapped/offline use).

Until the host forwards preferences (see the runtime note above), exercise the
adapters directly via the one-shot protocol, e.g.:

```bash
echo '{"v":1,"type":"invoke","command":"list-agents","query":"","storage":{},"preferences":{"source":"http","httpBaseUrl":"http://127.0.0.1:8787"}}' \
  | node extensions/examples/agentos-controller/index.mjs
```
