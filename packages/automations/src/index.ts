/**
 * @orbit/automations — saved, reusable workflows (spec §19, the 5th execution
 * mode). An automation is a named, ordered list of **whitelisted tool steps**
 * that compiles into a `MissionPlan` and runs through the *same* Orbit Agent
 * executor (preview → per-step confirmation → deterministic execution). So an
 * automation inherits every safety property of a mission for free: it can only
 * use existing safe tools, and its consequential steps are still gated.
 *
 * Honest scope: only the **manual** trigger is active. Scheduled / app-opened /
 * file-changed / session-completed triggers are enumerated but require native
 * wiring (a scheduler + filesystem/relay watchers) and are not yet live. A
 * user-editable automation builder + import/export are later; these are curated
 * starters built from real, existing capabilities.
 */
import { toValidStep, type MissionPlan, type ToolLookup } from '@orbit/mission';
import { NATIVE_TOOL_IDS } from '@orbit/tool-registry';

/** Triggers an automation can declare. Only `manual` runs today. */
export type AutomationTrigger =
  | 'manual'
  | 'hotkey'
  | 'schedule'
  | 'app-opened'
  | 'project-selected'
  | 'file-changed'
  | 'session-completed';

/** A single step as authored in an automation (validated against the registry). */
export interface AutomationStep {
  readonly toolId: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly rationale?: string;
}

export interface AutomationDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly keywords: readonly string[];
  readonly trigger: AutomationTrigger;
  readonly steps: readonly AutomationStep[];
}

/** Curated starter automations, all built from existing safe tools. */
export const AUTOMATIONS: readonly AutomationDefinition[] = [
  {
    id: 'review-approvals',
    title: 'Review Pending Approvals',
    description: 'Open the Approval Centre to see anything waiting on you.',
    icon: 'agentos',
    keywords: ['approvals', 'review', 'pending', 'approve'],
    trigger: 'manual',
    steps: [{ toolId: NATIVE_TOOL_IDS.openControlCenter, args: { controlCenterTab: 'approvals' } }],
  },
  {
    id: 'triage-failed-sessions',
    title: 'Triage Failed Sessions',
    description: 'Open agent sessions filtered to failed/errored runs.',
    icon: 'agentos',
    keywords: ['failed', 'sessions', 'errors', 'triage'],
    trigger: 'manual',
    steps: [
      {
        toolId: NATIVE_TOOL_IDS.openControlCenter,
        args: { controlCenterTab: 'sessions', sessionStatus: 'failed' },
      },
    ],
  },
  {
    id: 'recent-activity',
    title: 'Catch Up on Activity',
    description: 'Open the live Relay activity feed.',
    icon: 'agentos',
    keywords: ['activity', 'recent', 'catch up', 'events'],
    trigger: 'manual',
    steps: [{ toolId: NATIVE_TOOL_IDS.openControlCenter, args: { controlCenterTab: 'activity' } }],
  },
  {
    id: 'summarise-clipboard',
    title: 'Summarise Clipboard',
    description: 'Run Quick AI to summarise whatever you last copied.',
    icon: 'ai',
    keywords: ['summarise', 'summarize', 'clipboard', 'tldr'],
    trigger: 'manual',
    steps: [
      {
        toolId: NATIVE_TOOL_IDS.quickAi,
        args: { prompt: 'Summarise the clipboard contents in a few bullet points.', useClipboard: true },
        rationale: 'Summarise the clipboard',
      },
    ],
  },
  {
    id: 'restart-relay',
    title: 'Restart Relay',
    description: 'Restart the Relay sidecar (consequential — confirmed).',
    icon: 'refresh-cw',
    keywords: ['restart', 'relay', 'reconnect', 'reset'],
    trigger: 'manual',
    steps: [{ toolId: NATIVE_TOOL_IDS.restartRelay, args: {} }],
  },
];

export function getAutomation(id: string): AutomationDefinition | undefined {
  return AUTOMATIONS.find((a) => a.id === id);
}

/**
 * Compile an automation into a validated MissionPlan against the live registry.
 * Returns null when no step survives validation (e.g. a tool was removed) — the
 * caller then shows an honest "unavailable" state instead of a broken run.
 */
export function buildAutomationPlan(
  def: AutomationDefinition,
  registry: ToolLookup,
): MissionPlan | null {
  const steps = def.steps.flatMap((s) => {
    const step = toValidStep(s.toolId, { ...s.args }, registry, s.rationale ?? def.title);
    return step ? [step] : [];
  });
  if (steps.length === 0) return null;
  return { goal: def.title, steps, source: 'deterministic', summary: def.description };
}
