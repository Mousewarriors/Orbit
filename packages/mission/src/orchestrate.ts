/**
 * Compose deterministic-first planning with an optional AI fallback.
 *
 * `planMission` tries the deterministic recogniser first (no AI). Only if that
 * yields nothing — and a `complete` function is supplied — does it ask the model
 * for a plan, which is then hard-validated against the registry. The `complete`
 * function is injected (it wraps any configured `AiProvider`), so this stays
 * pure and testable and the package never depends on a live provider.
 */
import type { AiMessage } from '@orbit/ai-runtime';
import type { ToolRecord } from '@orbit/tool-registry';
import { planDeterministically, type ToolLookup } from './plan.js';
import { buildMissionPrompt } from './prompt.js';
import { parseMissionPlan } from './validate.js';
import type { MissionPlan } from './types.js';

export type CompleteFn = (messages: AiMessage[], signal?: AbortSignal) => Promise<string>;

export interface PlanMissionOptions {
  /** Tools the planner may use (already scoped to the active project). */
  readonly tools: readonly ToolRecord[];
  /** Wraps a configured AiProvider's `complete`; omit to stay deterministic-only. */
  readonly complete?: CompleteFn;
  readonly signal?: AbortSignal;
}

export interface PlanMissionResult {
  readonly plan: MissionPlan | null;
  /** Why there's no plan, when `plan` is null. */
  readonly reason?: 'no-match-no-ai' | 'ai-empty' | 'ai-error';
}

/** A registry that is both a lookup and a tool list source. */
export interface MissionRegistry extends ToolLookup {
  all(): ToolRecord[];
}

export async function planMission(
  goal: string,
  registry: MissionRegistry,
  options: PlanMissionOptions,
): Promise<PlanMissionResult> {
  const deterministic = planDeterministically(goal, registry);
  if (deterministic) return { plan: deterministic };

  if (!options.complete) return { plan: null, reason: 'no-match-no-ai' };

  try {
    const text = await options.complete(buildMissionPrompt(goal, options.tools), options.signal);
    const plan = parseMissionPlan(text, goal, registry);
    return plan ? { plan } : { plan: null, reason: 'ai-empty' };
  } catch {
    return { plan: null, reason: 'ai-error' };
  }
}
