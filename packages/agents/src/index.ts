/**
 * @orbit/agents — specialist agent profiles + a task→specialist *recommendation*.
 *
 * Scope boundary (spec §3.4/§3.5): Orbit does NOT own agent orchestration or
 * model selection — Hermes selects/sequences agents and the Model Intelligence
 * Gateway selects models. This module only provides (a) a small catalogue of the
 * specialist agents Orbit knows how to surface, with their genuine strengths, and
 * (b) a *suggestion* of which specialist suits a goal, shown to the user as a
 * hint. The final choice stays with the user's explicit preference and, for
 * dispatched work, with Relay/Hermes. It deliberately does not pick models, modes
 * or routing — that would duplicate the gateway.
 */

/** Named specialist agents Orbit can reference (mirrors AgentPreference, sans "best"). */
export type SpecialistAgentId = 'codex' | 'claude' | 'antigravity' | 'openclaw';

/** Coarse kind of work a goal represents — used only for an agent *hint*. */
export type AgentRole = 'coding' | 'debugging' | 'research' | 'planning' | 'general';

export interface AgentProfile {
  readonly id: SpecialistAgentId;
  readonly name: string;
  /** Where the agent is reached from. */
  readonly source: 'relay' | 'gateway';
  /** What this agent is genuinely good at. */
  readonly strengths: readonly AgentRole[];
  readonly description: string;
}

export const AGENT_PROFILES: readonly AgentProfile[] = [
  {
    id: 'codex',
    name: 'Codex',
    source: 'relay',
    strengths: ['coding', 'debugging'],
    description: 'Fast, focused implementation and fixes via the Codex CLI.',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    source: 'relay',
    strengths: ['coding', 'planning', 'research', 'debugging'],
    description: 'Strong reasoning, planning and multi-file changes via the Claude Code CLI.',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    source: 'relay',
    strengths: ['coding'],
    description: 'Agentic coding workflows.',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    source: 'gateway',
    strengths: ['research', 'general'],
    description: 'Autonomous research and operations via the AgentOS Gateway.',
  },
];

export function agentProfile(id: SpecialistAgentId): AgentProfile | undefined {
  return AGENT_PROFILES.find((a) => a.id === id);
}

const ROLE_KEYWORDS: ReadonlyArray<{ role: AgentRole; words: readonly string[] }> = [
  { role: 'debugging', words: ['debug', 'bug', 'error', 'fix', 'failing', 'broken', 'traceback', 'crash', 'stack trace'] },
  { role: 'research', words: ['research', 'investigate', 'compare', 'explore', 'analyse', 'analyze', 'find out', 'look into'] },
  { role: 'planning', words: ['plan', 'design', 'architecture', 'strategy', 'roadmap', 'organise', 'organize', 'scope'] },
  { role: 'coding', words: ['code', 'implement', 'build', 'refactor', 'feature', 'function', 'component', 'add', 'write', 'test'] },
];

/** Classify a goal into a coarse role by keywords (most specific first). */
export function classifyGoalRole(goal: string): AgentRole {
  const g = goal.toLowerCase();
  for (const { role, words } of ROLE_KEYWORDS) {
    if (words.some((w) => g.includes(w))) return role;
  }
  return 'general';
}

/** Ordered specialist preference per role (a hint, not a routing policy). */
const ROLE_PREFERENCE: Readonly<Record<AgentRole, readonly SpecialistAgentId[]>> = {
  debugging: ['claude', 'codex'],
  coding: ['codex', 'claude', 'antigravity'],
  research: ['openclaw', 'claude'],
  planning: ['claude'],
  general: ['claude', 'codex'],
};

export interface AgentRecommendation {
  readonly agent: AgentProfile;
  readonly role: AgentRole;
  readonly reason: string;
}

/**
 * Suggest a specialist for a goal. Returns null only if the catalogue is empty.
 * This is a hint surfaced to the user; it never overrides an explicit preference
 * and never makes the final dispatch decision (Relay/Hermes do).
 */
export function recommendAgent(goal: string): AgentRecommendation | null {
  const role = classifyGoalRole(goal);
  const order = ROLE_PREFERENCE[role];
  for (const id of order) {
    const profile = agentProfile(id);
    if (profile) {
      return { agent: profile, role, reason: `${profile.name} suits ${role} work` };
    }
  }
  return null;
}
