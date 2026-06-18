/**
 * Launch a local agent on a project — the real thing, via Orbit Relay.
 *
 * This is the capability behind "launch an agent to do X". It does NOT invent a
 * shell command or talk to a model: it drives Relay's existing, audited
 * create-plan → execute flow (the same path the Control Center launch composer
 * uses), which is the local execution spine. Agent *selection* from a
 * preference is a small pure function so it is unit-testable; the Relay calls
 * are injected so the orchestration is too.
 *
 * Consequence handling: a launch is only executed with `confirm: true` AFTER the
 * mission UI has shown the plan + any Relay warnings and the user approved. We
 * never auto-execute.
 */
import type { AgentPreference } from '@orbit/intent';
import {
  agentId as readAgentId,
  agentTitle,
  availabilityLabel,
  planId as readPlanId,
  recordsFrom,
  warningList,
  type RelayObject,
} from '../relayViewModel.js';

/** The Relay surface a dispatch needs (injected for tests; native.ts in prod). */
export interface RelayDispatchDeps {
  listAgents: () => Promise<unknown>;
  createLaunchPlan: (agentId: string, projectPath: string) => Promise<unknown>;
  executeLaunch: (planId: string, confirm: boolean) => Promise<unknown>;
}

export interface ChosenAgent {
  readonly id: string;
  readonly title: string;
}

/** Whether a Relay agent record is currently usable for a local launch. */
function isAvailable(agent: RelayObject): boolean {
  const label = availabilityLabel(agent).toLowerCase();
  return label === 'available';
}

/**
 * Pick an agent id from a preference. A named preference matches an agent whose
 * id/title contains that name (and is available); `best` (or an unmatched name)
 * falls back to the first available agent. Returns null when none are available.
 */
export function chooseAgent(agents: readonly RelayObject[], pref: AgentPreference | undefined): ChosenAgent | null {
  const available = agents.filter(isAvailable);
  const pool = available.length > 0 ? available : agents;

  if (pref && pref !== 'best') {
    const match = pool.find((a) => {
      const hay = `${readAgentId(a)} ${agentTitle(a)}`.toLowerCase();
      return hay.includes(pref);
    });
    if (match) return { id: readAgentId(match), title: agentTitle(match) };
  }
  const first = available[0] ?? pool[0];
  if (!first) return null;
  const id = readAgentId(first);
  return id ? { id, title: agentTitle(first) } : null;
}

export interface DispatchResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly detail?: string;
  readonly agentTitle?: string;
  readonly warnings: readonly string[];
}

/**
 * Resolve an agent for the preference, create a Relay launch plan, surface its
 * warnings, and execute it (confirmed). Any failure becomes a clean result, not
 * an exception — the mission runner shows it as a failed step.
 */
export async function dispatchAgentViaRelay(
  deps: RelayDispatchDeps,
  projectPath: string,
  pref: AgentPreference | undefined,
): Promise<DispatchResult> {
  let agentsPayload: unknown;
  try {
    agentsPayload = await deps.listAgents();
  } catch (e) {
    return { ok: false, summary: 'Could not reach Relay to list agents', detail: errText(e), warnings: [] };
  }
  const agents = recordsFrom(agentsPayload, 'agents');
  const chosen = chooseAgent(agents, pref);
  if (!chosen) {
    return {
      ok: false,
      summary: 'No available local agent to launch',
      detail: 'Relay reported no agents available for a local launch.',
      warnings: [],
    };
  }

  let planPayload: unknown;
  try {
    planPayload = await deps.createLaunchPlan(chosen.id, projectPath);
  } catch (e) {
    return { ok: false, summary: `Could not create a launch plan for ${chosen.title}`, detail: errText(e), agentTitle: chosen.title, warnings: [] };
  }
  const plan = (planPayload && typeof planPayload === 'object' ? (planPayload as RelayObject) : null);
  const pid = readPlanId(plan);
  const warnings = warningList(plan);
  if (!pid) {
    return {
      ok: false,
      summary: `Relay did not return a launch plan for ${chosen.title}`,
      agentTitle: chosen.title,
      warnings,
    };
  }

  try {
    await deps.executeLaunch(pid, true);
  } catch (e) {
    return { ok: false, summary: `Launch failed for ${chosen.title}`, detail: errText(e), agentTitle: chosen.title, warnings };
  }
  return {
    ok: true,
    summary: `Launched ${chosen.title} on the project`,
    agentTitle: chosen.title,
    warnings,
  };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
