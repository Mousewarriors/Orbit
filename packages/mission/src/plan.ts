/**
 * Deterministic-first mission planning.
 *
 * Before any model is consulted, we try to build a plan from Orbit's own
 * deterministic recogniser (`@orbit/intent`). A great many real goals — "launch
 * the best agent on Orbit", "open the Orbit folder", "find files about Leonard",
 * "restart Relay", "show failed sessions" — map cleanly onto a single existing
 * tool with no AI call at all (spec: "Known local requests must not call AI").
 *
 * Each produced step references a native tool id and its arguments are validated
 * against that tool's schema via the Tool Registry, so a deterministic plan is
 * held to exactly the same safety bar as an AI plan.
 */
import { recogniseIntent, type IntentName, type RecognisedIntent } from '@orbit/intent';
import { NATIVE_TOOL_IDS, validateArgs, type ToolRecord } from '@orbit/tool-registry';
import { MAX_RATIONALE_LEN, type MissionPlan, type MissionStep } from './types.js';

/** The registry surface the planner needs (a `ToolRegistry` satisfies this). */
export interface ToolLookup {
  get(id: string): ToolRecord | undefined;
}

/** Control Center tab (+ optional filter) an informational intent maps to. */
const CC_TARGET: Partial<Record<IntentName, { tab: string; sessionStatus?: string }>> = {
  show_active_sessions: { tab: 'sessions' },
  show_failed_sessions: { tab: 'sessions', sessionStatus: 'failed' },
  show_recent_activity: { tab: 'activity' },
  show_approvals: { tab: 'approvals' },
  show_handoffs: { tab: 'handoffs' },
  validate_handoff: { tab: 'handoffs' },
  scan_projects: { tab: 'projects' },
  open_project: { tab: 'projects' },
  open_latest_project: { tab: 'projects' },
};

function clamp(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.trim().slice(0, MAX_RATIONALE_LEN);
  return t.length > 0 ? t : undefined;
}

/** Build the (toolId, raw args) pair an intent maps to, before validation. */
function intentToToolCall(
  recognised: RecognisedIntent,
): { toolId: string; args: Record<string, unknown> } | null {
  const { intent, slots } = recognised;
  switch (intent) {
    case 'open_application':
      return { toolId: NATIVE_TOOL_IDS.openApplication, args: { applicationQuery: slots.applicationQuery } };
    case 'open_project_folder':
      return { toolId: NATIVE_TOOL_IDS.openProjectFolder, args: { projectQuery: slots.projectQuery } };
    case 'continue_project':
    case 'launch_agent_on_project':
      return {
        toolId: NATIVE_TOOL_IDS.dispatchAgent,
        args: {
          ...(slots.projectQuery ? { projectQuery: slots.projectQuery } : {}),
          ...(slots.agentPreference ? { agentPreference: slots.agentPreference } : {}),
        },
      };
    case 'restart_relay':
      return { toolId: NATIVE_TOOL_IDS.restartRelay, args: {} };
    case 'find_file':
      return { toolId: NATIVE_TOOL_IDS.findFiles, args: { fileQuery: slots.fileQuery } };
    case 'find_notes':
      return { toolId: NATIVE_TOOL_IDS.findNotes, args: { noteQuery: slots.noteQuery } };
    case 'explain_selection':
    case 'explain_error':
    case 'summarise_selection':
    case 'summarise_clipboard':
    case 'ask_quick_ai':
      return {
        toolId: NATIVE_TOOL_IDS.quickAi,
        args: {
          prompt: slots.question ?? recognised.slots.question ?? '',
          ...(intent === 'summarise_clipboard' ? { useClipboard: true } : {}),
        },
      };
    default: {
      const cc = CC_TARGET[intent];
      if (!cc) return null;
      return {
        toolId: NATIVE_TOOL_IDS.openControlCenter,
        args: {
          controlCenterTab: cc.tab,
          ...(cc.sessionStatus ? { sessionStatus: cc.sessionStatus } : {}),
          ...(slots.projectQuery ? { projectQuery: slots.projectQuery } : {}),
        },
      };
    }
  }
}

/** Validate a tool call against the registry, returning a MissionStep or null. */
export function toValidStep(
  toolId: string,
  rawArgs: Record<string, unknown>,
  registry: ToolLookup,
  rationale?: string,
): MissionStep | null {
  const tool = registry.get(toolId);
  if (!tool) return null;
  // Drop undefined slots so validation sees only provided values.
  const provided: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawArgs)) if (v !== undefined) provided[k] = v;
  const check = validateArgs(tool.inputSchema, provided);
  if (!check.ok) return null;
  const clamped = clamp(rationale);
  return { toolId, args: check.cleaned, ...(clamped ? { rationale: clamped } : {}) };
}

/**
 * Try to build a one-step mission from deterministic recognition. Returns null
 * when the goal isn't a recognised single intent (the caller may then fall back
 * to AI planning, where a provider is configured).
 */
export function planDeterministically(goal: string, registry: ToolLookup): MissionPlan | null {
  const recognised = recogniseIntent(goal);
  if (!recognised) return null;
  const call = intentToToolCall(recognised);
  if (!call) return null;
  const step = toValidStep(call.toolId, call.args, registry, `Recognised: ${recognised.intent}`);
  if (!step) return null;
  return {
    goal,
    steps: [step],
    source: 'deterministic',
    summary: `Deterministic plan for "${recognised.intent}" (no AI needed).`,
  };
}
