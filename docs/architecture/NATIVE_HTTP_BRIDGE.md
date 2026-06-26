# Native HTTP bridge (AI providers + HTTP MCP)

Status: **landed + V1 hardening.** The native HTTP bridge lets the already-built
AI runtime and MCP client talk to real servers without giving the renderer an
unbounded socket capability. Local **Ollama** uses the general provider bridge.
HTTP MCP uses a separate hardened native command. Stdio MCP uses the native
process host.

## Why it exists

The webview runs under the app CSP and has no way to open raw sockets, so it
cannot reach `http://127.0.0.1:11434` (Ollama) or arbitrary MCP endpoints
directly. Rust is not CSP-bound. Orbit therefore exposes narrow, validated HTTP
capabilities through IPC and keeps the pure adapters (`OllamaProvider`,
`McpClient`) behind injected transports.

## Rust (`apps/desktop/src-tauri/src/http.rs`)

Two native clients exist:

- `http_request(method, url, headers, body) -> { status, body }` is the general
  one-shot provider bridge. It accepts only `http`/`https` URLs and is used for
  Ollama `/api/tags`, non-streaming `/api/chat`, and provider adapters.
- `http_mcp_request(method, url, headers, body) -> { status, body }` is the
  dedicated HTTP MCP JSON-RPC bridge. It requires public HTTPS, rejects URL
  credentials, rejects loopback/private/link-local/reserved/direct-local
  destinations before sending, performs DNS preflight, rejects forbidden resolved
  addresses, pins the request to the preflight-approved address set, bypasses
  proxies for MCP, and never follows redirects. Renderer-supplied request ids
  make the request cancellable.
- `http_mcp_cancel(id)` marks an in-flight HTTP MCP request cancelled. The Rust
  command races the reqwest future against this flag and drops the request
  future when cancellation wins.
- `http_stream_open(id, method, url, headers, body)` streams response body bytes
  as base64 chunks on the `http-stream` event (`{ id, kind, data, status }`) for
  Ollama token streaming.
- `http_stream_cancel(id)` flips a per-stream cancellation flag that the stream
  task checks.

The provider bridge remains compatible with local Ollama. HTTP MCP is
deliberately narrower so a configured MCP server cannot turn JSON-RPC tool data
into SSRF traffic.

## Renderer

- `native.ts` exposes typed wrappers: `httpRequest`, `httpMcpRequest`,
  `httpMcpCancel`, `httpStreamOpen`, `httpStreamCancel`, and `onHttpStream`.
- `ai/nativeFetch.ts` implements a `FetchLike` over the provider bridge.
  Streaming calls build an event-fed `ReadableStream<Uint8Array>`.
- `ai/nativeMcpTransport.ts` posts JSON-RPC through `http_mcp_request` and parses
  either plain JSON or an SSE `data:` response. It supplies a unique native
  request id and wires `AbortSignal` to `http_mcp_cancel`.
- `ai/mcpServers.ts` stores MCP server configs in `mcp.servers`; HTTP MCP
  registration accepts public HTTPS endpoints only. `buildToolRegistry` skips an
  unreachable MCP server without breaking native tools.

## Security

- Provider bridge: http(s) only, validated in Rust before connecting.
- HTTP MCP bridge: public HTTPS only, no URL credentials, no redirects, and
  direct/DNS-resolved loopback, private, link-local, documentation/reserved or
  multicast addresses are rejected before tool data is sent to any forbidden
  destination. The request is pinned to the approved DNS results to avoid a
  preflight/re-resolve gap.
- Secrets do not live in these configs; provider/MCP credentials are referenced
  from OS secure storage only.
- Streamed output and MCP responses remain untrusted data; the Tool Registry and
  confirmation flow still gate actions.

## Remaining

- Non-streaming `http_request` cancellation is best-effort: once invoked, the
  Rust request runs to completion. Streaming requests cancel promptly via
  `http_stream_cancel`. HTTP MCP requests cancel through `http_mcp_cancel`.
