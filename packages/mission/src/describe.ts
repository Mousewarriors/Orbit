/**
 * Pure helpers to render + reason about a plan, kept out of the UI so they are
 * unit-testable. A step's display + danger come straight from its registry tool,
 * so the preview can never claim a step is safer than the tool actually is.
 */
import type { ToolRecord, ToolRisk } from '@orbit/tool-registry';
import type { MissionPlan, MissionStep } from './types.js';
import type { ToolLookup } from './plan.js';

export interface MissionStepView {
  readonly toolId: string;
  readonly title: string;
  readonly description: string;
  readonly rationale?: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly risk: ToolRisk;
  readonly requiresConfirmation: boolean;
  /** True when the backing tool id no longer resolves (defensive). */
  readonly unknownTool: boolean;
}

function viewFor(step: MissionStep, tool: ToolRecord | undefined): MissionStepView {
  if (!tool) {
    return {
      toolId: step.toolId,
      title: step.toolId,
      description: 'Unknown tool',
      args: step.args,
      risk: 'high',
      requiresConfirmation: true,
      unknownTool: true,
      ...(step.rationale ? { rationale: step.rationale } : {}),
    };
  }
  return {
    toolId: step.toolId,
    title: tool.title,
    description: tool.description,
    args: step.args,
    risk: tool.risk,
    requiresConfirmation: tool.requiresConfirmation,
    unknownTool: false,
    ...(step.rationale ? { rationale: step.rationale } : {}),
  };
}

export function missionStepView(step: MissionStep, registry: ToolLookup): MissionStepView {
  return viewFor(step, registry.get(step.toolId));
}

export function missionStepViews(plan: MissionPlan, registry: ToolLookup): MissionStepView[] {
  return plan.steps.map((s) => missionStepView(s, registry));
}

/** How many steps in the plan need explicit confirmation. */
export function missionConsequentialCount(plan: MissionPlan, registry: ToolLookup): number {
  return plan.steps.reduce((n, s) => n + (registry.get(s.toolId)?.requiresConfirmation ? 1 : 0), 0);
}
