# Orbit — Next Session Handoff

Written 2026-06-19, end of the AI-programme arc (Phases 8–12, 16-partial, Phase 5,
the native AI/MCP bridge, and the gap-fills). Read this first, then
[HANDOFF.md](HANDOFF.md) (sessions 8–16) and [FEATURE_MATRIX.md](FEATURE_MATRIX.md)
for the honest per-feature status.

**Branch:** `claude/orbit-ai-runtime` — all work committed and pushed.
**Gate command:**
```bash
npm run lint && npm run typecheck --workspaces --if-present && npm test && cargo check --workspace
```
(Cargo lives at `C:\Users\Simon Wood\.cargo\bin\cargo.exe` if not on PATH.)
**Current green numbers:** 489 JS tests, 129 Rust tests, lint 0 warnings, strict
typecheck, `vite build`, `cargo check --workspace` all clean.

---

## What was delivered in this arc (most recent first)

| Commit | Slice |
| --- | --- |
| `db7594c` | Cloud (OpenAI-compatible) provider + OS secure-storage credentials (`keyring`) |
| `1d0cb18` | Chat gap-fills: branch in UI, model switching, personal context, save-to-memory |
| `de7c3eb` | Phase 5 — persistent AI Chat (SQLite, streaming, regenerate, export) |
| `c0c4c84` | Phase 16 (partial) — CI verification-gate workflow |
| `b8deec9` | Phase 12 — Profile & Memory with transparency |
| `20146b1` | Native HTTP bridge — Ollama + HTTP MCP now live |
| `1ebf339` | Phase 11 — saved automations as reusable missions |
| `8b343a6` | Phase 10 — specialist agent profiles + recommendation hint |
| `358d233` | Phase 9 — Orbit Agent mission engine (launch agents + do tasks) |
| `ca17ada` | Phase 8 — MCP client + unified Tool Registry |

---

## A. Verify on a real machine (HIGHEST PRIORITY)

Everything in this arc is unit/compile-verified but **never run in `tauri dev`**.
First session should `npm run dev:desktop` and exercise:

1. **Ollama** — Settings → AI → Local Ollama → confirm a real streamed answer in
   Quick AI **and** Chat.
2. **Cloud** — paste an OpenAI key → confirm it lands in **Windows Credential
   Manager** (not settings/files) and a cloud answer streams.
3. **Orbit Agent** — "agent: continue Orbit with the best coding agent" → plan →
   approve the consequential step → real Relay dispatch.
4. **Chat** — persistence across an app restart, branch, regenerate, model switch.
5. **MCP** — add an HTTP MCP server in the MCP & Tools view → its tools appear in
   the registry with risk/approval badges.

**Likely first-run issues to watch:**
- SQLite **migration 0009** applying on an existing DB (chats/chat_messages tables).
- The `http-stream` event plumbing under the real CSP (Ollama token streaming).
- `keyring` prompts/behaviour on Windows the first time a secret is written.

---

## B. Finish the partially-built features (known gaps still open)

- **Native Anthropic adapter** — the OpenAI-compat path does NOT cover Anthropic's
  API shape (Messages API, `x-api-key`, `anthropic-version`). Build
  `AnthropicProvider` in `@orbit/ai-runtime`. **Read the `claude-api` skill first**
  for current model IDs/headers. Wire it as a 5th provider id with its own secret.
- **AgentOS Auto routing** — Orbit → AgentOS Gateway → Hermes → Model Intelligence
  Gateway. Blocked on the **AgentOS Gateway HTTP adapter** (still
  `NOT_IMPLEMENTED`). This also unblocks the Mission engine's **model routing
  preview** (`/route`) and **remote agent dispatch**. Do NOT duplicate the Model
  Gateway's routing — call it through the Gateway.
- **MCP: stdio transport** — only HTTP MCP works today; stdio (process-spawn) needs
  a host like `extension_host.rs`. Also add **MCP server auth credentials** (now
  that secure storage exists) and a richer MCP settings UI (health, logs, tool
  inspector, test-call).
- **Chat polish** — tool-call cards (see C), attachments, citations, export to a
  **file** (currently copies the transcript to the clipboard).
- **Profile / Memory** — automatic-but-**proposed** (never silent) memory creation
  from interactions; vault-backed durable memory via the Gateway.

---

## C. The big next feature: tool-use in Chat / Quick AI

Wire the **Tool Registry** into Chat/Quick AI so the model can *call* approved
tools (function-calling). This is the bridge between Chat and the Mission engine.

Needs:
- Tool schemas in the provider request (`tools` / `tool_choice` for OpenAI-compat,
  and Ollama's tool format).
- Parsing tool-call responses from the stream.
- Executing via the existing `executeMissionStep` / Tool Registry with
  **per-call confirmation** (reuse `ConfirmDialog` + the registry's
  `requiresConfirmation`/`approvalScopes`).
- Rendering **tool-call cards** (spec §8.4: tool, source, params, reason, risk,
  approval state, result, duration, error).

---

## D. Phases still untouched (need external pieces — don't fake)

- **Phase 13 — Browser + voice**: needs a browser companion extension + native
  mic/transcription. Not buildable headless; building dead UI would violate the
  honesty bar.
- **Phase 14 — Agent Studio**: needs the live AgentOS Gateway (remote agent
  workspaces).
- **Phase 15 — Marketplace**: the spec **explicitly forbids** building before
  signing/permissions/review are mature — leave it.
- **Phase 16 remainder**: code-signing (needs an Authenticode/EV cert), release
  automation, auto-update. The CI baseline (`.github/workflows/ci.yml`) exists but
  was **never run on a live runner** — push to GitHub and confirm the 3 jobs pass.

---

## E. Cleanup / debt

- Confirm the `windows-desktop` CI job builds `keyring`'s `windows-native` feature.
- Rust HTTP streaming base64-encodes each chunk and the renderer decodes with a
  streaming `TextDecoder`, so multi-byte UTF-8 across chunk boundaries is handled —
  double-check end-to-end once Ollama is live.
- `@orbit/api` `dist` is built by `vitest.globalSetup`; ensure CI's `npm ci`
  ordering doesn't break that.
- The launcher bundle JS is ~450 kB (gzip ~131 kB) — fine for now, but consider
  code-splitting the AI views if startup latency matters.

---

## Repo orientation for the next session

**New pure packages this arc:**
`@orbit/tool-registry`, `@orbit/mission`, `@orbit/agents`, `@orbit/automations`,
`@orbit/profile`, `@orbit/chat`; provider adapters live in `@orbit/ai-runtime`
(`mock`, `ollama`, `openaiCompat`, `classify`).

**Renderer AI glue** (`apps/desktop/src/ai/*`):
- `providerConfig.ts` — settings → `AiProvider` factory + `ProviderInfo`.
- `providerLoad.ts` — async resolver (reads settings + the cloud secret); **all AI
  surfaces use this**.
- `nativeFetch.ts` — `FetchLike` over the native HTTP bridge (event-fed
  `ReadableStream` for streaming).
- `toolRegistry.ts` — builds the unified registry (native + demo MCP + configured
  HTTP MCP servers).
- `mcpServers.ts` / `nativeMcpTransport.ts` — HTTP MCP config + transport.
- `profileStore.ts` — profile/memory persistence (settings KV).

**Renderer agent glue** (`apps/desktop/src/agent/*`):
- `agentProvider.ts`, `automationProvider.ts` — Root Search providers.
- `agentDispatch.ts` — real Relay `listAgents → createLaunchPlan → executeLaunch`.
- `missionExecutor.ts` — maps a validated step to a real native action.

**Views** (`apps/desktop/src/components/*`):
`ChatView`, `OrbitAgentView`, `QuickAiView`, `ToolsView`.

**Native (Rust)** (`apps/desktop/src-tauri/src/*`):
- `http.rs` — `http_request` / `http_stream_open` / `http_stream_cancel` (the AI/MCP
  bridge).
- `secrets.rs` — `secret_set/get/delete/has` (OS secure storage via `keyring`).
- chat persistence in `crates/orbit-core/src/chat.rs` + **migration 0009** in
  `crates/orbit-core/src/migrations.rs`.

**Architecture docs:**
`docs/architecture/{MCP_TOOL_REGISTRY,AI_AGENT_MODE,AI_RUNTIME}.md`.

**Hard rules to keep (from CLAUDE.md + the master spec):**
- OS logic in Rust only; renderer touches native only via `native.ts`.
- AI output must be validated structured data — never arbitrary shell/argv/paths.
- Consequential actions confirmed; high/critical-risk tools are once-only (never
  persistent approval).
- No secrets in SQLite/JSON/logs/git — OS secure storage only.
- DB migrations are append-only; never edit a shipped migration.
- Don't duplicate the Model Intelligence Gateway's routing/registry.
- Keep FEATURE_MATRIX.md honest; don't mark a feature done until it's
  GUI-verified end-to-end.
