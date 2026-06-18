# MCP Client + Tool Registry (`@orbit/tool-registry`)

Status: **Phase 8 foundation — pure core built + unit-tested (39 tests); a thin
renderer surface (MCP & Tools view) is wired; live stdio/HTTP MCP servers are
deferred behind a native MCP bridge.**

This is the controlled tool-transport + unified registry the Mission engine
(Phase 9) and the Approval Centre dispatch through. It is built the same way as
`@orbit/ai-runtime`: a real protocol + an *injected* transport, an offline mock
that exercises the whole path, and no faked capability.

## What it is

- **One vocabulary.** `ToolRecord` describes any invokable tool regardless of
  source (`native` | `relay` | `agentos` | `extension` | `mcp` | `ai-provider`).
  The source is always carried and shown — never hidden.
- **Risk from side effects, not trust.** A tool declares *what it does*
  (`read`, `write-file`, `delete-file`, `network`, `send-message`,
  `run-command`, `git-push`, `deploy`, `publish`, `spend`, `system-change`).
  `policy.ts` derives the effective `risk` and whether confirmation is required.
  The mandatory-approval categories from the spec (§13.4/§21) floor at
  `medium`+, so they can never be classified safe.
- **No persistent approval for danger.** `approvalScopesFor` returns `['once']`
  for high/critical risk — they may never be remembered for a mission or
  project (spec §21). Medium risk may be remembered per-mission/per-project.
- **MCP client.** `McpClient` speaks JSON-RPC 2.0 over an injected
  `McpTransport`: `initialize`, `tools/list`, `resources/list`, `prompts/list`,
  `tools/call`. Output is **bounded** (`flattenContent`, default 16k chars), and
  failures are isolated — a transport drop becomes `McpError('unreachable')`, a
  JSON-RPC error becomes `McpError('protocol')`, and a tool that reports
  `isError` resolves `ok:false` (not an exception).
- **Untrusted annotations raise only.** `mapToRecords` infers side effects from
  MCP annotations + the tool name, but an unannotated tool defaults to a *gated
  write* — a third-party server cannot mark itself "safe" by omission.
- **Unified registry.** `ToolRegistry` merges records from every source,
  dedupes by id, bounds its size, scopes tools to the active project, and is the
  single lookup the Mission engine + Approval Centre use.
- **Argument validation.** `validateArgs` checks a call's arguments against the
  tool's schema at the choke-point before *any* tool runs, returning only
  declared, correctly-typed properties — a planner/model can't smuggle an
  unknown or ill-typed argument into a tool.

## Native catalogue

`nativeToolRecords()` publishes Orbit's own audited capabilities as tools so the
Mission engine assembles plans from a **fixed id set**, never an arbitrary
command: `open_application`, `open_project_folder`, `open_control_center`,
`find_files`, `find_notes`, `dispatch_agent` (sourced from **Orbit Relay**, the
local execution spine — high-risk, always confirmed), `restart_relay`,
`quick_ai`.

## Renderer surface

`buildToolRegistry()` assembles the registry from the native catalogue plus a
single **in-process demo MCP server** (`MockMcpTransport`, clearly labelled
synthetic), so discovery, risk derivation, the registry and `tools/call` are all
real and exercisable end-to-end. The **MCP & Tools** view (command: "MCP &
Tools") lists tools grouped by source with risk/side-effect/approval badges, an
input-schema inspector, and a test-call that routes confirmation-required tools
through the same `ConfirmDialog` the Mission engine uses.

## Honest gaps / deferred

- **Live MCP servers (stdio/HTTP).** Need a **native MCP bridge** — the renderer
  can't spawn a process or open arbitrary sockets under the Tauri CSP (the same
  constraint that blocks direct Ollama HTTP). The `McpClient` + `McpServerConfig`
  + validation are ready; a real transport drops in behind `McpTransport` with no
  consumer change. The MCP-server **settings UI** (add/enable/health/logs) lands
  with that bridge.
- **AgentOS / extension / ai-provider tool sources** are modelled in the
  vocabulary but only the native + demo-MCP sources are populated today.
- **Credentials** are referenced (`credentialRef`) only — never stored in this
  package; OS secure storage owns the secret (spec §9.5).

## Security stance

Tool output is untrusted data (prompt-injection defence, §26). A tool can never
widen Orbit's action surface implicitly: every record carries an explicit risk +
side-effect set, gating is centralised in `policy.ts`, and the planner can only
reference existing tool ids.
