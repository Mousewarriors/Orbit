/**
 * Root Search provider that opens Orbit Agent for explicit "do this for me"
 * goals. It is deliberately conservative: it only triggers on clear agent-mode
 * phrasing, so ordinary searches, calculator input and the existing
 * deterministic intents are untouched. The goal text is extracted and passed to
 * Orbit Agent, which does the (deterministic-first) planning + gating.
 */
import type { SearchItem, SearchProvider } from '@orbit/shared-types';
import { encodeQuickAiArg } from '../ai/quickAi.js';

interface AgentTrigger {
  readonly re: RegExp;
  /** Extract the goal from the match (group 1), or the whole query. */
  readonly goal: (m: RegExpExecArray, q: string) => string;
}

const TRIGGERS: readonly AgentTrigger[] = [
  { re: /^(?:orbit\s+)?agent[:,]?\s+(.+)$/i, goal: (m) => m[1] ?? '' },
  { re: /^(?:please\s+)?(?:have|get|tell|ask)\s+(?:an?\s+)?(?:orbit\s+)?agent\s+(?:to\s+)?(.+)$/i, goal: (m) => m[1] ?? '' },
  { re: /^(?:ask|tell)\s+orbit\s+to\s+(.+)$/i, goal: (m) => m[1] ?? '' },
  { re: /^(.+?)\s+for\s+me\.?$/i, goal: (m) => m[1] ?? '' },
  { re: /^do\s+(.+)$/i, goal: (m) => m[1] ?? '' },
];

/** Detect an agent-mode goal, returning the extracted goal text or null. */
export function detectAgentGoal(query: string): string | null {
  const q = query.trim();
  if (q.length < 6) return null;
  for (const trigger of TRIGGERS) {
    const m = trigger.re.exec(q);
    if (m) {
      const goal = trigger.goal(m, q).trim();
      if (goal.length >= 3) return goal;
    }
  }
  return null;
}

export function createAgentProvider(): SearchProvider {
  return {
    id: 'orbit-agent',
    source: 'ai',
    canHandle: (q) => q.trim().length >= 6,
    search(query): Promise<SearchItem[]> {
      const goal = detectAgentGoal(query);
      if (!goal) return Promise.resolve([]);
      const item: SearchItem = {
        id: 'orbit-agent.goal',
        title: `Run a mission: "${goal}"`,
        subtitle: 'Plan and run this as an Orbit Agent mission (preview + approval first)',
        keywords: [query],
        category: 'Orbit Agent',
        source: 'ai',
        icon: { kind: 'builtin', name: 'agentos' },
        confidence: 0.9,
        primaryAction: {
          id: 'orbit-agent.goal.open',
          title: 'Plan mission',
          run: { kind: 'push-view', viewId: 'orbit-agent', args: { id: encodeQuickAiArg({ prompt: goal }) } },
        },
      };
      return Promise.resolve([item]);
    },
  };
}
