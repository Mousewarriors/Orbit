# Orbit Agent — the Mission engine (`@orbit/mission`)

Status: **Phase 9 foundation — pure planning core + renderer executor + the Orbit
Agent view, all built and unit-tested (60 new tests). Deterministic planning,
agent dispatch and step execution are real; multi-step AI planning needs a
configured provider; model routing preview needs the AgentOS Gateway.**

This is the surface behind *"tell Orbit what you want done and it does it"*. It is
built to the security spine of the master spec (§20/§26/§30): the model proposes,
**Orbit validates**, the user approves, and Orbit's audited executor runs the
steps. The model never touches the OS.

## The pipeline

```
goal (plain language)
  → planDeterministically()      (recogniseIntent → one validated tool step; NO AI)
  → [only if unrecognised] planWithAi()  (model → JSON → hard-validated against registry)
  → preview (numbered steps, risk, rationale, consequential badges)
  → per-step confirmation for consequential steps
  → deterministic execution through existing safe actions
  → live status + bounded results
```

A **plan is a list of steps, and every step references a tool id that already
exists in the Tool Registry** (Phase 8) with arguments validated against that
tool's schema. A planner — deterministic *or* a model — can therefore only ever
assemble a mission from Orbit's existing safe capabilities. It cannot emit a
shell string, an arbitrary path, a new action name, or an unvalidated argument
(`parseMissionPlan` drops any step that fails this, mirroring `classify.ts`).

## Deterministic-first

`planDeterministically(goal, registry)` runs Orbit's own recogniser. Goals like
"Continue Orbit with the best coding agent", "Open the Orbit folder", "Find files
about Leonard", "Restart Relay" and "Show failed sessions" become a one-step plan
**with no AI call at all**. AI planning is the fallback for unrecognised/multi-
step goals and only runs when a provider is configured (`planMission` injects the
provider's `complete`).

## Launching agents is real (via Relay)

The headline capability — *launch an agent to do something* — runs through Orbit
Relay's existing, audited flow, not a mock:

1. `relayListAgents` → `chooseAgent(agents, preference)` (pure: a named preference
   matches an available agent; `best` picks the first available one).
2. `relayCreateLaunchPlan(agentId, projectPath)` → surfaces Relay's warnings.
3. `relayExecuteLaunch(planId, confirm: true)` — **only after** the user approved
   the step in the mission preview. We never auto-launch.

`dispatchAgentViaRelay` returns a clean result on any failure (Relay down, no
plan, no available agent) so the mission shows a failed step, never a crash. The
`dispatch_agent` tool is high-risk → always confirmed → never persistently
approvable.

## Step executor

`executeMissionStep` maps each whitelisted tool id to a real action — app launch,
folder reveal, file/note search, Control Center navigation, the Relay dispatch
above, a Relay restart, or a Quick AI sub-task. There is **no generic
"run-command" branch**; every side-effecting call is injected, so the executor is
fully unit-tested headless.

## The Orbit Agent view

Reachable from the **"Orbit Agent"** command and from natural language ("agent:
…", "have an agent …", "ask orbit to …", "… for me", "do …"). It shows the active
provider (on-device / leaves-device / none), warns when a dispatch step needs
Relay and Relay isn't ready, renders the plan with per-step risk + rationale,
gates every consequential step through the confirmation dialog (Approve / Skip),
executes sequentially with a Stop button, shows bounded per-step results, and
offers an "Open result" navigation when a step targets the Control Center.

## Honest gaps / deferred

- **Multi-step AI planning** needs a real provider. The offline Mock can't
  actually plan (it returns placeholder text → `parseMissionPlan` yields nothing
  → the view says so plainly). Deterministic single-step missions work fully
  offline.
- **Model routing preview** (verified/council strategy, primary model) is owned
  by the AgentOS **Model Intelligence Gateway** `/route` and surfaces here once
  the Gateway HTTP adapter exists — Orbit does **not** duplicate that routing
  (spec §9.2/§30). The view states this rather than faking a preview.
- **Mission persistence, audit log, handoffs, pause/resume across restarts** and
  a unified **Approval Centre** are later slices; today a mission is an
  in-session run with live status + confirmation gating.
- **Remote (AgentOS Gateway) agent dispatch** is not wired — only local Relay
  agents. Remote missions go through Hermes via the Gateway (not yet connected).

## Security stance

Deterministic and AI plans are held to the same validation bar. Consequential
steps (dispatch, restart, any future write/delete/deploy tool) are confirmed
individually and high/critical-risk steps can never be remembered. Tool output is
untrusted data; the planning prompt tells the model the goal is the only
instruction and to ignore instructions embedded in tool names/data
(prompt-injection defence). No step can widen Orbit's action surface.
