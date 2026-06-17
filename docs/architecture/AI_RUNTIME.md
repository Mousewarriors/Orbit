# AI Runtime Foundation (`@orbit/ai-runtime`)

Status: **foundation built + unit-tested; not yet wired to a user-facing surface.**
This is Phase 3 of the AI programme. Per the master plan, "no generic UI should
be built before the runtime works reliably" — so this slice ships the contracts,
adapters and the validated classification fallback as a tested library that the
later Quick AI / Chat slices consume. It does **not** add an AI button to Root
Search, because there is no configured live model or credential yet and Orbit must
never pretend a capability exists.

## What this package is (and is not)

A provider-agnostic abstraction that turns messages into text (optionally
streamed), reports models/health, and carries usage + a clear local-vs-remote
flag. It is **not** a second model router: choosing the best model in Auto mode
is the **Model Intelligence Gateway's** job (see
[`docs/agentos/MODEL_INTELLIGENCE_GATEWAY_HANDOFF.md`](../agentos/MODEL_INTELLIGENCE_GATEWAY_HANDOFF.md)).
Orbit's runtime never selects models in Auto, never executes anything on the host,
and never embeds the gateway's registry or routing policy.

## Contracts (`src/types.ts`)

- `AiProvider` — `health()`, `listModels()`, `complete()`, `stream()`; each takes
  an `AbortSignal` for cancellation. `local: boolean` says whether processing
  stays on-device.
- `AiRequest` / `AiResponse` / `AiStreamChunk` / `AiUsage` / `AiModelInfo` /
  `ProviderHealth`.
- `AiError` with a typed `code` (`cancelled` | `unreachable` | `bad_response` |
  `not_configured` | `unsupported`) so callers branch on cause.

## Adapters

| Adapter | File | Status | Notes |
| --- | --- | --- | --- |
| `MockProvider` | `mock.ts` | ✅ | Deterministic, fully local, scriptable reply; streams word-by-word. For tests + offline. Clearly synthetic. |
| `OllamaProvider` | `ollama.ts` | ✅ (adapter) | Local Ollama over an **injected `fetch`** (testable without a network). `listModels` (`/api/tags`), `complete`/`stream` (`/api/chat`, NDJSON), `format:json` passthrough, usage from `prompt_eval_count`/`eval_count`, typed unreachable/cancel mapping. **Never auto-pulls a model.** Not yet pointed at a live endpoint from the app (needs the provider-settings slice). |
| `agentos-auto` | — | ⬜ | Auto mode routes Orbit → AgentOS Gateway → Hermes → Model Gateway. Blocked on the Gateway HTTP adapter (currently `NOT_IMPLEMENTED`). |
| `openai-compat` / `anthropic` | — | ⬜ | Explicit direct-mode adapters; need OS secure-storage credentials first. |

## Deterministic-first AI classification (`classify.ts`)

The **only** place AI touches the intent pipeline, and only as a fallback after
deterministic recognition fails:

1. `buildClassificationPrompt(query)` constrains the model to emit a single
   intent from the known set + whitelisted slots, JSON only.
2. `parseClassification(text)` **hard-validates** the output: unknown intents are
   rejected, only the seven known slot fields survive, `agentPreference` must be
   in the allowed set, strings are length-clamped. The model therefore **cannot**
   introduce an action, path, shell argument or field Orbit doesn't already
   understand — it can only point at an existing safe intent.
3. The result is an ordinary `RecognisedIntent` (lower confidence,
   `matchedRule: 'ai-classifier'`) that the existing safe pipeline resolves and —
   where consequential — confirms.

`classifyWithAi(query, provider, signal)` ties (1)→(3) through any `AiProvider`.

## How it will be consumed (next slices)

- **Quick AI** (Phase 4): a compact surface that runs `complete`/`stream` against
  the configured provider, with context chips, a privacy/local indicator, and
  copy/paste/replace — replace gated by the confirmation dialog added in the
  natural-language slice.
- **AI-assisted intent fallback** (priority 5): an *explicit, non-blocking* Root
  Search entry ("Interpret with AI") that calls `classifyWithAi` only on demand —
  never inline per keystroke (Root Search must not wait for AI). This lands once a
  provider is actually configured, so it resolves real requests rather than mock
  output.

## Security stance

- No credentials in this package; provider records will store only a secure
  reference (OS secure storage) when the settings slice lands.
- Validated structured output only — model text is treated as untrusted and can
  never widen Orbit's action surface.
- Cancellation is first-class via `AbortSignal`; aborted requests raise
  `AiError('cancelled')`.
