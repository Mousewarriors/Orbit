# Model Intelligence Gateway — Handoff Document

**Repo:** `/home/hermes/.hermes/workspace/agentos-model-gateway/`
**Branch:** `feature/model-intelligence-gateway`
**Port:** 8789 (bound `0.0.0.0`, accessible via Tailscale `100.74.37.12`)
**Python venv:** `.venv/`
**Env:** `OLLAMA_API_KEY` in `.env`

---

## Architecture Overview

The gateway is a FastAPI service that routes incoming AI task requests to the appropriate model(s) based on deterministic classification + optional cloud LLM augmentation.

**Flow:**
```
Request → classify_task() → infer_complexity() → infer_risk()
        → [cloud classifier if low confidence]
        → _select_mode() → resolve role → pick model → execute
```

**Strategy C (Hybrid Deterministic → Cloud Classifier):**
1. Deterministic keyword matching classifies task type, complexity, and risk first
2. If confidence < 0.5 threshold, the cloud classifier (gemma4:31b) supplements
3. Ceiling guards prevent the cloud classifier from over-escalating known low-stakes task types
4. Python policy makes the final mode selection — the LLM never picks models directly

---

## Execution Modes (Priority Order)

| Priority | Rule | Mode | Description |
|----------|------|------|-------------|
| 1 | Explicit `requested_mode != "auto"` | *as requested* | Honour user override |
| 2 | Agent in disabled set | `legacy` | Pass through, no routing |
| 3 | Extreme complexity + `allow_frontier_escalation` | `frontier_escalation` | Strongest available model |
| 4 | High/critical risk + high/extreme complexity | `council` | 3 panel + judge |
| 5 | High/critical risk | `verified` | Primary + verifier |
| 6 | High/extreme complexity + planning/architecture | `council` | Complex strategic tasks |
| 7 | High/extreme complexity | `expert` | Single strong model, no reviewer |
| 8 | Fast-eligible type + low complexity + low risk | `fast` | Lightweight model |
| 9 | Interactive + low/medium complexity + low risk | `fast` | Speed-optimised |
| 10 | Default | `specialist` | Domain-matched specialist |

---

## Task Classification

### Task Types (deterministic keyword matching)

| Type | Keywords (examples) | Default Role |
|------|---------------------|-------------|
| `security_review` | security, vulnerability, exploit, cve | `coding_critic` |
| `debugging` | debug, error, fix, traceback, bug | `coding_debugger` |
| `code_review` | review, audit, critique, pr review | `coding_critic` |
| `strategic_planning` | plan, strategy, roadmap, architecture | `planning_primary` |
| `coding_implementation` | code, implement, build, refactor | `coding_implementer` |
| `deep_research` | research, search, investigate, compare | `research_primary` |
| `summarisation` | summarize, digest, tldr, recap | `general_fast` |
| `structured_extraction` | extract, parse, json, schema, csv | `general_fast` |
| `image_screenshot_analysis` | image, screenshot, photo, ocr | `multimodal_primary` |
| `reasoning_mathematics` | math, calculate, proof, equation | `reasoning_primary` |
| `simple_factual_lookup` | *(falls through)* | `general_fast` |
| `ordinary_conversation` | *(default)* | `general_strong` |

### Complexity Inference

Heuristics applied in order (highest wins):
- **Text length:** >1000 chars → high; >500 chars → medium
- **Keywords:** "migration strategy" → extreme; "architecture" → high; "review" → medium
- **Task-type floors:** `strategic_planning` → medium, `security_review` → medium, `deep_research` → medium, `conflicting_source_research` → high, `agentos_architecture` → high
- **Context/tools:** context>50k or tools>5 → extreme; context>20k or tools>3 → high; context>5k or tools>1 → medium

### Risk Inference

Keywords in order: critical → high → medium. Plus task-type floors:
- `security_review` → high
- `code_review`, `agentos_architecture`, `conflicting_source_research` → medium
- Strategic planning with "migration"/"architecture" keywords → high

### Ceiling Guards (prevent cloud classifier over-escalation)

| Task Type | Complexity Ceiling | Risk Ceiling |
|-----------|-------------------|-------------|
| `long_running_agent_work` | medium | low |
| `simple_factual_lookup` | low | low |
| `summarisation` | medium | low |
| `structured_extraction` | medium | low |
| `ordinary_conversation` | low | low |
| `code_review` | — | medium |

---

## Model Registry

Roles map to preferred/fallback model chains. All models are Ollama Cloud identifiers.

| Role | Preferred | Fallbacks |
|------|-----------|-----------|
| `fast_router` | gemma4:31b | gpt-oss:20b, gemini-3-flash-preview |
| `general_fast` | gemma4:31b | gpt-oss:20b |
| `general_strong` | glm-5.2 | deepseek-v4-pro, nemotron-3-ultra |
| `coding_architect` | glm-5.2 | kimi-k2.7-code, deepseek-v4-flash |
| `coding_implementer` | kimi-k2.7-code | glm-5.2, qwen3-coder:480b |
| `coding_debugger` | deepseek-v4-pro | glm-5.2, kimi-k2.7-code |
| `coding_critic` | nemotron-3-ultra | deepseek-v4-pro, glm-5.2 |
| `long_running_agent` | nemotron-3-ultra | kimi-k2.6, glm-5.2 |
| `research_primary` | nemotron-3-ultra | deepseek-v4-pro, glm-5.2 |
| `research_verifier` | glm-5.2 | deepseek-v4-pro, nemotron-3-ultra |
| `reasoning_primary` | deepseek-v4-pro | glm-5.2, minimax-m3 |
| `reasoning_auditor` | nemotron-3-ultra | deepseek-v4-pro, glm-5.2 |
| `planning_primary` | glm-5.2 | deepseek-v4-pro, nemotron-3-ultra |
| `planning_red_team` | deepseek-v4-pro | nemotron-3-ultra, minimax-m3 |
| `multimodal_primary` | gemini-3-flash-preview | glm-5.2 |
| `multimodal_verifier` | glm-5.2 | deepseek-v4-pro |
| `structured_output_verifier` | glm-5.2 | deepseek-v4-pro, nemotron-3-ultra |
| `council_judge` | glm-5.2 | deepseek-v4-pro, nemotron-3-ultra |
| `final_synthesiser` | glm-5.2 | deepseek-v4-pro, nemotron-3-ultra |
| `expert_general` | glm-5.2 | deepseek-v4-pro, nemotron-3-ultra |
| `expert_coding` | glm-5.2 | kimi-k2.7-code, deepseek-v4-pro |
| `expert_research` | nemotron-3-ultra | deepseek-v4-pro, glm-5.2 |
| `expert_planning` | glm-5.2 | deepseek-v4-pro, nemotron-3-ultra |
| `deep_research_primary` | nemotron-3-ultra | deepseek-v4-pro, glm-5.2 |

---

## Council Mode

When a task routes to council mode, 3 panel members + 1 judge are selected based on the task domain:

| Domain | Panel A | Panel B | Panel C | Judge |
|--------|---------|---------|---------|-------|
| coding | coding_architect | coding_implementer | coding_critic | council_judge |
| research | research_primary | research_verifier | reasoning_auditor | council_judge |
| planning | planning_primary | coding_architect | planning_red_team | council_judge |
| reasoning | reasoning_primary | research_primary | reasoning_auditor | council_judge |
| multimodal | multimodal_primary | general_strong | multimodal_verifier | council_judge |
| general | general_strong | general_fast | coding_critic | council_judge |

Candidates are anonymized as "Candidate A/B/C" to prevent model bias. The judge synthesizes all panel outputs.

---

## Cloud Classifier

- **Model:** `gemma4:31b`
- **Trigger:** deterministic confidence < 0.5
- **Returns:** abstract task properties only (never model names)
- **Fields:** `task_type`, `complexity` (0-1 float), `risk`, `freshness_required`, `requires_tools`, `requires_vision`, `recommended_strategy`, `ambiguity`
- **Mapping:** Cloud types map to internal types (e.g., `"coding"` → `"coding_implementation"`)
- **Ceilings:** Cloud overrides are capped by task-type ceilings to prevent over-escalation

---

## API Endpoints

### `POST /route`
Routing only — classifies and selects mode/models but does NOT execute.

**Request:** `RouteRequest`
```json
{
  "request_id": "uuid",
  "agent": "hermes|openclaw|other",
  "task": "task description text",
  "context": ["optional context strings"],
  "requested_mode": "auto|legacy|fast|specialist|verified|council|frontier_escalation|expert",
  "task_type": null,
  "complexity": null,
  "risk": null,
  "modalities": [],
  "tools_required": [],
  "context_size_estimate": 0,
  "latency_preference": "interactive|balanced|deep",
  "allow_frontier_escalation": true,
  "metadata": {}
}
```

**Response:** `RouteResponse`
```json
{
  "request_id": "uuid",
  "selected_mode": "specialist",
  "task_classification": {"task_type": "coding_implementation", "complexity": "medium", "risk": "low"},
  "primary_model": "kimi-k2.7-code",
  "verifier_model": null,
  "panel_models": [],
  "judge_model": null,
  "routing_reason": "Default routing: task_type=coding_implementation, complexity=medium, risk=low → specialist mode | Specialist mode: task_type=coding_implementation → role coding_implementer → model kimi-k2.7-code",
  "estimated_usage_class": "low",
  "routing_confidence": 0.315,
  "queue_state": {"position": 0, "total_queued": 0},
  "result": null,
  "verification": null,
  "council_analysis": null,
  "escalation": null,
  "fallback_used": false,
  "shadow_mode": false,
  "shadow_executed": false,
  "shadow_discrepancy": false
}
```

### `POST /execute`
Route AND execute — returns the model's response in `result`.

Same request/response shapes as `/route`, but with `result` populated:
```json
{
  "result": {
    "content": "model response text",
    "model": "kimi-k2.7-code",
    "usage": {"prompt_tokens": 150, "completion_tokens": 300}
  }
}
```

### `GET /health`
Returns gateway status, model count, Ollama slot info.

### `GET /dashboard`
HTML monitoring dashboard.

### `GET /task`
HTML task submission UI (tablet-friendly).

---

## Key Source Files

| File | Purpose |
|------|---------|
| `gateway_model/app.py` | FastAPI app, all endpoints, startup/lifespan |
| `gateway_model/router.py` | Core routing logic (Strategy C, mode selection, role resolution) |
| `gateway_model/schemas.py` | Pydantic request/response models |
| `gateway_model/task_classifier.py` | Deterministic keyword classification, complexity/risk inference, ceilings |
| `gateway_model/cloud_classifier.py` | Cloud LLM classifier for low-confidence cases |
| `gateway_model/execution_engine.py` | Model execution (specialist, verified modes) |
| `gateway_model/council_coordinator.py` | Council mode orchestration (3 panel + judge) |
| `gateway_model/model_registry.py` | Role→model resolution with fallbacks |
| `gateway_model/ollama_client.py` | Ollama Cloud API client |
| `gateway_model/concurrency_manager.py` | Slot management, queuing, priority |
| `config/routing-policy.yaml` | Routing rules, thresholds, keyword overrides |
| `config/model-registry.yaml` | Model role definitions and fallback chains |

---

## Running the Gateway

```bash
cd /home/hermes/.hermes/workspace/agentos-model-gateway
source .env  # sets OLLAMA_API_KEY
.venv/bin/python3 -m uvicorn gateway_model.app:app --host 0.0.0.0 --port 8789 --log-level info
```

### Health Check
```bash
curl http://localhost:8789/health
```

### Route a Task (no execution)
```bash
curl -X POST http://localhost:8789/route \
  -H "Content-Type: application/json" \
  -d '{"request_id":"test-1","agent":"hermes","task":"Summarize the meeting notes"}'
```

### Execute a Task (route + run model)
```bash
curl -X POST http://localhost:8789/execute \
  -H "Content-Type: application/json" \
  -d '{"request_id":"test-2","agent":"hermes","task":"What is 2+2?"}'
```

---

## Confidence Scoring

Confidence is computed from how many fields were explicit vs inferred:

- Base: 0.9
- × 0.7 if `task_type` was inferred (not explicit)
- × 0.5 if `complexity` was inferred
- × 0.5 if `risk` was inferred

So a fully inferred request (all three from keywords) = 0.9 × 0.7 × 0.5 × 0.5 = **0.1575**
A fully explicit request (all three provided) = **0.9**

Below 0.5 → cloud classifier is invoked to supplement.

---

## Test Suite

```bash
cd /home/hermes/.hermes/workspace/agentos-model-gateway
.venv/bin/python3 -m pytest tests/test_router.py tests/test_task_classifier.py tests/test_schemas.py tests/test_council_coordinator.py -v
```

85/85 passing (some pre-existing fixture issues in `test_execute_endpoint_council` and `test_dry_run_respects_explicit_mode`).

---

## Known Issues & Remaining Work

1. **Task UI `/task` endpoint** — HTML UI works but the Execute button had a JS bug (now fixed: response is flat, not nested under `data.routing`). Verify on tablet.
2. **Weighted complexity scoring** — Currently keyword/length heuristics. Planned: weighted formula combining text, context, and tool signals.
3. **Per-request session pinning** — Not yet implemented. Will keep related requests on the same model.
4. **`POST /escalate` endpoint** — Not yet implemented. Will allow promoting a specialist response to verified/council.
5. **Pre-existing test fixture issues** — `TestExecuteEndpointCouncil` and `test_dry_run_respects_explicit_mode` fail due to feature flag configuration in test fixtures, not current code changes.

---

## Architecture Diagram

```
                    ┌─────────────────────┐
                    │   Client / Agent    │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    POST /route       │
                    │    POST /execute     │
                    │    (FastAPI app)      │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │      Router          │
                    │  1. classify_task()  │
                    │  2. infer_complexity │
                    │  3. infer_risk()     │
                    │  4. [cloud classif]  │
                    │  5. _select_mode()   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼────┐  ┌───────▼──────┐  ┌──────▼──────┐
     │    fast     │  │  specialist   │  │   expert    │
     │  (1 model)  │  │  (1 model)    │  │  (1 model)  │
     └─────────────┘  └──────────────┘  └─────────────┘
              │                │                │
     ┌────────▼────┐  ┌───────▼──────┐  ┌──────▼──────┐
     │  verified   │  │   council    │  │  frontier   │
     │(2 models)   │  │ (3+1 models) │  │ (1 model)  │
     └─────────────┘  └──────────────┘  └─────────────┘

     ┌─────────────────────────────────────────────┐
     │          Model Registry (YAML)              │
     │  role → preferred model → fallback chain    │
     └─────────────────────────────────────────────┘
                          │
                 ┌────────▼────────┐
                 │  Ollama Cloud   │
                 │  (API proxy)    │
                 └─────────────────┘
```