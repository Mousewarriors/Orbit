/**
 * @orbit/intent — the structured vocabulary of natural-language requests Orbit
 * can understand and route to its existing safe capabilities.
 *
 * This package is deliberately deterministic and GUI-free. It recognises an
 * intent from typed text, ranks candidate entities (projects, applications)
 * against a slot, and maps a recognised intent onto a *navigation/action plan*
 * the renderer can dispatch through existing Orbit actions. It never executes
 * anything itself and never talks to a model: AI classification is a later,
 * separate fallback for the cases this layer cannot resolve.
 */

/** A natural-language intent Orbit can act on. */
export type IntentName =
  // Local, deterministic actions
  | 'open_application'
  | 'open_project'
  | 'open_project_folder'
  | 'open_latest_project'
  | 'continue_project'
  | 'launch_agent_on_project'
  | 'show_active_sessions'
  | 'show_failed_sessions'
  | 'show_recent_activity'
  | 'show_approvals'
  | 'show_handoffs'
  | 'validate_handoff'
  | 'restart_relay'
  | 'scan_projects'
  | 'find_file'
  | 'find_notes'
  // AI-assisted (not yet wired — recognised so we can answer honestly)
  | 'explain_selection'
  | 'explain_error'
  | 'summarise_selection'
  | 'summarise_clipboard'
  | 'ask_quick_ai';

/**
 * Preferred agent for an agent-bound request. `best` means "let the
 * orchestrator choose" (Hermes / Model Intelligence Gateway own that decision);
 * the named agents map to concrete local agents where Relay exposes them.
 */
export type AgentPreference = 'best' | 'codex' | 'claude' | 'antigravity' | 'openclaw';

/** Extracted parameters for an intent. Only the relevant slots are present. */
export interface IntentSlots {
  /** Free-text describing the project the user referred to (e.g. "Orbit"). */
  readonly projectQuery?: string;
  /** Free-text describing the application to open (e.g. "Calculator"). */
  readonly applicationQuery?: string;
  /** The search term for find_file (e.g. "the document that mentioned Leonard" → "Leonard"). */
  readonly fileQuery?: string;
  /** The search term for find_notes. */
  readonly noteQuery?: string;
  /** Which agent the user asked for, when stated. */
  readonly agentPreference?: AgentPreference;
  /** True when the user explicitly referenced the latest handoff. */
  readonly includeLatestHandoff?: boolean;
  /** The residual question/text for an AI-assisted intent. */
  readonly question?: string;
}

/** The result of deterministic recognition. */
export interface RecognisedIntent {
  readonly intent: IntentName;
  readonly slots: IntentSlots;
  /** Deterministic match confidence in [0,1]; broad/loose matches score lower. */
  readonly confidence: number;
  /** Whether dispatching the *effect* of this intent is consequential. */
  readonly requiresConfirmation: boolean;
  /** Identifier of the rule that matched, for diagnostics/tests. */
  readonly matchedRule: string;
}

/** Whether an intent needs an AI runtime that is not yet available. */
export function isAiIntent(intent: IntentName): boolean {
  return (
    intent === 'explain_selection' ||
    intent === 'explain_error' ||
    intent === 'summarise_selection' ||
    intent === 'summarise_clipboard' ||
    intent === 'ask_quick_ai'
  );
}
