# MCP Client + Tool Registry (`@orbit/tool-registry`)

Status: **V1 foundation + live native bridges.** The pure registry/MCP core is
built and unit-tested, the MCP & Tools renderer surface is wired, stdio MCP
servers launch through the native process host, and HTTP MCP runs through the
hardened native HTTP-MCP command.

This is the controlled tool-transport and unified registry the Mission engine
and Approval Centre dispatch through. It is built like `@orbit/ai-runtime`: a
real protocol, injected transports, offline mocks for deterministic tests, and no
faked capability.

## What it is

- **One vocabulary.** `ToolRecord` describes any invokable tool regardless of
  source (`native`, `relay`, `agentos`, `extension`, `mcp`, `ai-provider`). The
  source is always carried and shown. Every record has a stable `id` plus a
  semantic `version`, making the capability contract explicitly versioned
  without changing the lookup id.
- **Risk from side effects, not trust.** A tool declares effects (`read`,
  `write-file`, `delete-file`, `network`, `send-message`, `run-command`,
  `git-push`, `deploy`, `publish`, `spend`, `system-change`). `policy.ts`
  derives risk and confirmation requirements.
- **No persistent approval for danger.** `approvalScopesFor` returns `['once']`
  for high/critical risk.
- **MCP client.** `McpClient` speaks JSON-RPC 2.0 over an injected
  `McpTransport`: `initialize`, `tools/list`, `resources/list`, `prompts/list`,
  and `tools/call`. Output is bounded, failures are isolated, and cancellation is
  honoured through `AbortSignal`.
- **Untrusted annotations raise only.** `mapToRecords` infers side effects from
  MCP annotations and tool names, but an unannotated tool defaults to a gated
  write.
- **Unified registry.** `ToolRegistry` merges records from every source, dedupes
  by id, bounds its size, scopes tools to the active project, and is the single
  lookup used by mission/chat tool execution. It rejects malformed records that
  lack semantic versions, object schemas, recognised risk values or health
  states.
- **Argument validation.** `validateArgs` checks tool-call arguments against the
  tool schema before any native or MCP execution.

## Native catalogue

`nativeToolRecords()` publishes Orbit's audited native capabilities as tools so
the Mission engine plans from a fixed id set, not arbitrary commands. Current
native capabilities include application/project/file open flows, Control Center,
file/note search, Relay dispatch/restart, and Quick AI.

## Native MCP transports

- **Stdio MCP.** `NativeStdioMcpTransport` uses the Rust `mcp_stdio_*` host. The
  host allows only Node script entry points, rejects inline execution and
  arbitrary executables, bounds argv/cwd, reads newline-delimited JSON-RPC, has
  request timeouts, and keeps bounded diagnostic logs.
- **HTTP MCP.** `NativeHttpMcpTransport` uses `http_mcp_request`, not the general
  provider bridge. HTTP MCP registration accepts public HTTPS endpoints only.
  Native connection preflight rejects URL credentials, loopback/local/private/
  link-local/reserved destinations, forbidden DNS results, proxies, and
  redirects. The native request pins the approved DNS results for the actual
  JSON-RPC request.

## Renderer surface

`buildToolRegistry()` assembles the native catalogue, the labelled demo MCP
server, and enabled configured MCP servers. The MCP & Tools view lists tools by
source with risk/side-effect/approval badges, schema details, server controls,
and a test-call path that uses the same confirmation surface as mission/chat
tool execution.

## Honest gaps / deferred

- Extension and provider-owned tool sources are represented in the vocabulary
  but still need production source adapters.
- Credentials are referenced (`credentialRef`) only; OS secure storage owns the
  actual secret material.

## Security stance

Tool output is untrusted data. A tool can never widen Orbit's action surface
implicitly: every record carries explicit risk and side effects, gating is
centralised in `policy.ts`, and planners/models can only reference existing
tool ids.
