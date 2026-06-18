# Native HTTP bridge (AI providers + HTTP MCP)

Status: **landed (session 12).** This is the activation step that makes the
already-built AI runtime and MCP client talk to real servers. Local **Ollama**
and **HTTP MCP servers** now work; cloud providers (credentials) and **stdio**
MCP (process spawn) remain.

## Why it exists

The webview runs under the app CSP and has no way to open raw sockets, so it
cannot reach `http://127.0.0.1:11434` (Ollama) or an arbitrary MCP endpoint.
Rust is not CSP-bound. So Orbit exposes a **narrow, validated** HTTP capability
through three IPC commands and routes the AI/MCP traffic through it. The pure
adapters (`OllamaProvider`, `McpClient`) are unchanged — they were always built
behind an injected transport for exactly this.

## Rust (`apps/desktop/src-tauri/src/http.rs`)

A shared `reqwest` client (rustls TLS, 120 s timeout) behind three commands:

- `http_request(method, url, headers, body) -> { status, body }` — one-shot;
  used for Ollama `/api/tags`, non-streaming `/api/chat`, and HTTP MCP JSON-RPC.
- `http_stream_open(id, method, url, headers, body)` — spawns a task that streams
  the response body and emits base64 chunks on the `http-stream` event
  (`{ id, kind: 'chunk'|'end'|'error', data, status }`); used for Ollama token
  streaming.
- `http_stream_cancel(id)` — flips a per-stream cancel flag the task checks.

**Only `http`/`https` URLs are accepted** (validated before any connection);
non-http schemes are rejected (unit-tested).

## Renderer

- `native.ts` — typed wrappers (`httpRequest`, `httpStreamOpen`,
  `httpStreamCancel`, `onHttpStream`).
- `ai/nativeFetch.ts` — a `FetchLike` over an injectable `HttpBridge`. Non-
  streaming calls go through `http_request`; streaming calls build an
  **event-fed `ReadableStream<Uint8Array>`** (subscribe-before-open; base64 →
  bytes), so the `OllamaProvider`'s streaming `TextDecoder` handles multi-byte
  boundaries correctly. The bridge is injected, so the streaming assembly is
  unit-tested with no Tauri.
- `ai/nativeMcpTransport.ts` — `NativeHttpMcpTransport` POSTs JSON-RPC through
  `http_request` and parses a plain-JSON **or** SSE `data:` response.
- `ai/mcpServers.ts` — MCP server configs persisted in the settings KV
  (`mcp.servers`), http(s)-only + validated; the **MCP & Tools** view adds an
  add/enable/remove panel, and `buildToolRegistry` connects enabled servers and
  registers their tools (an unreachable server is skipped, never fatal).

## Wiring

`createProvider(settings, createNativeFetch())` at the Quick AI and Orbit Agent
call sites — so selecting **Ollama** in Settings → AI (endpoint + model) makes
Quick AI, AI Commands and mission AI-planning stream real, on-device tokens.

## Security

- http(s) only, validated in Rust before connecting.
- No secrets pass through here; cloud-provider credentials will live in OS secure
  storage (next slice) and only a reference is held.
- Streamed output stays untrusted data; MCP/AI text never gains authority over
  Orbit's actions (the Tool Registry + mission validation still gate everything).

## Remaining

- **Cloud providers** (OpenAI-compatible / Anthropic / Gemini) — adapters +
  secure credential storage.
- **stdio MCP** — needs a process host (like the extension runtime) to spawn and
  pipe a local MCP server; only HTTP MCP is live today.
- **AbortSignal for non-streaming** `http_request` is best-effort (the Rust call
  runs to completion); streaming requests cancel promptly via `http_stream_cancel`.
