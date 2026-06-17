/**
 * Map a recognised intent onto a *plan* the renderer can dispatch through
 * Orbit's existing safe actions, plus a base display (title/subtitle/icon).
 *
 * This stays pure: it decides *what kind* of safe action to take and *whether*
 * a project must be resolved, but never resolves entities or touches native —
 * that is the provider's job. Keeping the decision here makes it unit-testable
 * and keeps the provider a thin, auditable adapter.
 */
import { isAiIntent, type RecognisedIntent } from './types.js';

/** Control Center tabs an intent can deep-link into (mirrors the renderer). */
export type ControlCenterTab =
  | 'projects'
  | 'launch'
  | 'sessions'
  | 'activity'
  | 'handoffs'
  | 'approvals'
  | 'diagnostics';

export interface ControlCenterTarget {
  readonly tab: ControlCenterTab;
  /** Pre-select the resolved project (enters continuation mode on 'launch'). */
  readonly selectProject: boolean;
  /** When set, the Sessions tab opens filtered to this status (e.g. 'failed'). */
  readonly sessionStatus?: string;
}

/** A semantic, app-agnostic action id for the few non-navigation effects. */
export type BuiltinAction = 'restart-relay';

/** What the provider should do for a recognised intent. */
export type IntentPlan =
  | {
      readonly kind: 'control-center';
      readonly target: ControlCenterTarget;
      /** True when a project must be resolved before this is actionable. */
      readonly needsProject: boolean;
    }
  | { readonly kind: 'open-project-folder' }
  | { readonly kind: 'open-application' }
  | { readonly kind: 'find-files' }
  | { readonly kind: 'find-notes' }
  | { readonly kind: 'run-builtin'; readonly action: BuiltinAction }
  | { readonly kind: 'unsupported-ai' };

export interface IntentDisplay {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;
}

export interface IntentProposal {
  readonly plan: IntentPlan;
  readonly display: IntentDisplay;
  readonly requiresConfirmation: boolean;
}

function cc(
  tab: ControlCenterTab,
  selectProject: boolean,
  needsProject: boolean,
  sessionStatus?: string,
): Extract<IntentPlan, { kind: 'control-center' }> {
  const target: ControlCenterTarget = sessionStatus
    ? { tab, selectProject, sessionStatus }
    : { tab, selectProject };
  return { kind: 'control-center', target, needsProject };
}

/**
 * Produce the action plan + base display for a recognised intent. The provider
 * fills `{project}`/`{app}`/`{query}` placeholders once it has resolved the
 * concrete entity (kept out of this pure layer).
 */
export function proposeIntent(recognised: RecognisedIntent): IntentProposal {
  const { intent, slots } = recognised;
  const base = { requiresConfirmation: recognised.requiresConfirmation };

  switch (intent) {
    case 'restart_relay':
      return {
        ...base,
        plan: { kind: 'run-builtin', action: 'restart-relay' },
        display: { title: 'Restart Relay', subtitle: 'Restart the Relay sidecar process', icon: 'refresh-cw' },
      };
    case 'scan_projects':
      return {
        ...base,
        plan: cc('projects', false, false),
        display: { title: 'Scan Projects', subtitle: 'Open Projects to scan for repositories', icon: 'agentos' },
      };
    case 'validate_handoff':
      return {
        ...base,
        plan: cc('handoffs', false, false),
        display: { title: 'Validate Handoff', subtitle: 'Open Handoffs → Validate', icon: 'agentos' },
      };
    case 'show_handoffs':
      return {
        ...base,
        plan: cc('handoffs', false, false),
        display: { title: 'Show Handoffs', subtitle: 'Open the Handoffs workspace', icon: 'agentos' },
      };
    case 'show_failed_sessions':
      return {
        ...base,
        plan: cc('sessions', false, false, 'failed'),
        display: { title: 'Failed Sessions', subtitle: 'Sessions filtered to failed/errored', icon: 'agentos' },
      };
    case 'show_active_sessions':
      return {
        ...base,
        plan: cc('sessions', false, false),
        display: { title: 'Active Sessions', subtitle: 'View running agent sessions', icon: 'agentos' },
      };
    case 'show_recent_activity':
      return {
        ...base,
        plan: cc('activity', false, false),
        display: { title: 'Recent Activity', subtitle: 'Open the live Relay activity feed', icon: 'agentos' },
      };
    case 'show_approvals':
      return {
        ...base,
        plan: cc('approvals', false, false),
        display: { title: 'Approvals', subtitle: 'See anything waiting for your approval', icon: 'agentos' },
      };
    case 'open_latest_project':
      return {
        ...base,
        plan: cc('projects', true, true),
        display: { title: 'Open Latest Project', subtitle: 'Open your most recent project', icon: 'agentos' },
      };
    case 'open_project':
      return {
        ...base,
        plan: cc('projects', true, true),
        display: {
          title: `Open ${slots.projectQuery ?? 'Project'}`,
          subtitle: 'Open the project control surface',
          icon: 'agentos',
        },
      };
    case 'continue_project':
      return {
        ...base,
        plan: cc('launch', true, true),
        display: {
          title: `Continue ${slots.projectQuery ?? 'Project'}`,
          subtitle: agentSuffix('Resume work in the launch composer', slots.agentPreference),
          icon: 'agentos',
        },
      };
    case 'launch_agent_on_project':
      return {
        ...base,
        plan: cc('launch', true, true),
        display: {
          title: `Launch ${agentLabel(slots.agentPreference)}${
            slots.projectQuery ? ` on ${slots.projectQuery}` : ''
          }`,
          subtitle: 'Open the launch composer to start an agent session',
          icon: 'agentos',
        },
      };
    case 'open_project_folder':
      return {
        ...base,
        plan: { kind: 'open-project-folder' },
        display: {
          title: `Open ${slots.projectQuery ?? 'Project'} Folder`,
          subtitle: 'Reveal the project folder in your file manager',
          icon: 'folder',
        },
      };
    case 'open_application':
      return {
        ...base,
        plan: { kind: 'open-application' },
        display: {
          title: `Open ${slots.applicationQuery ?? 'Application'}`,
          subtitle: 'Launch the application',
          icon: 'app',
        },
      };
    case 'find_file':
      return {
        ...base,
        plan: { kind: 'find-files' },
        display: {
          title: slots.fileQuery ? `Find files matching "${slots.fileQuery}"` : 'Find files',
          subtitle: 'Search the local file index',
          icon: 'file',
        },
      };
    case 'find_notes':
      return {
        ...base,
        plan: { kind: 'find-notes' },
        display: {
          title: slots.noteQuery ? `Find notes matching "${slots.noteQuery}"` : 'Find notes',
          subtitle: 'Search your notes',
          icon: 'file-text',
        },
      };
    default:
      // AI-assisted intents are recognised but not yet executable.
      return {
        ...base,
        plan: { kind: 'unsupported-ai' },
        display: aiDisplay(recognised),
      };
  }
}

function agentLabel(pref: RecognisedIntent['slots']['agentPreference']): string {
  switch (pref) {
    case 'best':
      return 'the best agent';
    case 'codex':
      return 'Codex';
    case 'claude':
      return 'Claude Code';
    case 'antigravity':
      return 'Antigravity';
    case 'openclaw':
      return 'OpenClaw';
    default:
      return 'an agent';
  }
}

function agentSuffix(base: string, pref: RecognisedIntent['slots']['agentPreference']): string {
  return pref ? `${base} (${agentLabel(pref)})` : base;
}

function aiDisplay(recognised: RecognisedIntent): IntentDisplay {
  const map: Record<string, string> = {
    explain_error: 'Explain this error',
    explain_selection: 'Explain the selection',
    summarise_selection: 'Summarise the selection',
    summarise_clipboard: 'Summarise the clipboard',
    ask_quick_ai: 'Ask Quick AI',
  };
  return {
    title: map[recognised.intent] ?? 'Quick AI',
    subtitle: 'Quick AI is not available yet — press Enter to search the web instead',
    icon: 'ai',
  };
}

export { isAiIntent };
