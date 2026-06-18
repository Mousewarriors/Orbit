/**
 * @orbit/mission — the structured vocabulary for an *agent mission*: a goal the
 * user states in plain language, turned into an ordered plan of **whitelisted
 * tool calls** that Orbit can preview, gate and execute deterministically.
 *
 * The defining safety property (spec §20/§30): a plan is just a list of steps,
 * and each step references a **tool id that already exists in the Tool
 * Registry** plus arguments validated against that tool's schema. A planner —
 * deterministic *or* a model — can therefore only ever assemble a mission from
 * Orbit's existing safe capabilities. It can never introduce a shell string, an
 * arbitrary path, a new action name, or an unvalidated argument. The model
 * proposes; Orbit validates, the user approves, and Orbit's audited executor
 * runs the steps. The model never touches the OS.
 */

/** One step of a mission: a single validated tool call. */
export interface MissionStep {
  /** A tool id present in the Tool Registry (e.g. `native:dispatch_agent`). */
  readonly toolId: string;
  /** Arguments, already validated + cleaned against the tool's input schema. */
  readonly args: Readonly<Record<string, unknown>>;
  /** A short, clamped, human rationale (rule- or model-provided). */
  readonly rationale?: string;
}

/** Where a plan came from — surfaced to the user, never hidden. */
export type MissionPlanSource = 'deterministic' | 'ai';

/** A previewable, executable mission plan. */
export interface MissionPlan {
  readonly goal: string;
  readonly steps: readonly MissionStep[];
  readonly source: MissionPlanSource;
  /** Optional one-line summary of the approach (clamped). */
  readonly summary?: string;
}

/** Lifecycle of a single step during execution (spec §12.3, simplified). */
export type MissionStepStatus =
  | 'pending'
  | 'awaiting-approval'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';

/** The outcome of running one step (returned by the renderer executor). */
export interface MissionStepOutcome {
  readonly ok: boolean;
  /** Short human summary of what happened. */
  readonly summary: string;
  /** Optional longer detail (bounded by the caller). */
  readonly detail?: string;
  /** When set, the UI should navigate here after the mission completes. */
  readonly navigateTo?: { readonly viewId: string; readonly arg?: string };
}

export const MAX_MISSION_STEPS = 8;
export const MAX_RATIONALE_LEN = 240;
