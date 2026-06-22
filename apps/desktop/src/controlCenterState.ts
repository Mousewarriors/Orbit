/**
 * Control Center state model — shared typed state for the unified
 * project-first agent command surface.
 */
import type { RelayStatus, RelaySupervisorState } from './native.js';
import type { RelayObject } from './relayViewModel.js';
import { ALL_AGENT_PREFERENCES, type AgentPreference } from '@orbit/intent';

export type ControlCenterTab =
  | 'projects'
  | 'launch'
  | 'sessions'
  | 'activity'
  | 'handoffs'
  | 'approvals'
  | 'diagnostics';

export const ALL_TABS: readonly ControlCenterTab[] = [
  'projects',
  'launch',
  'sessions',
  'activity',
  'handoffs',
  'approvals',
  'diagnostics',
] as const;

export const TAB_LABELS: Record<ControlCenterTab, string> = {
  projects: 'Projects',
  launch: 'Launch',
  sessions: 'Sessions',
  activity: 'Activity',
  handoffs: 'Handoffs',
  approvals: 'Approvals',
  diagnostics: 'Diagnostics',
};

/**
 * A deep-link into the Control Center carried as the push-view argument. The
 * natural-language intent provider uses this to open a specific tab and, when
 * relevant, pre-select a resolved project or filter the Sessions list.
 */
export interface ControlCenterArg {
  readonly tab: ControlCenterTab;
  /** Absolute path of a project to pre-select (and continue, on 'launch'). */
  readonly project?: string;
  /** Substring to filter the Sessions list by status (e.g. 'failed'). */
  readonly sessionStatus?: string;
  /** A session to highlight after a launch. */
  readonly sessionId?: string;
  /** Agent requested by a natural-language launch/continue intent. */
  readonly agentPreference?: AgentPreference;
  /** Validate and surface the newest handoff for the selected project. */
  readonly includeLatestHandoff?: boolean;
}

function isTab(value: string): value is ControlCenterTab {
  return (ALL_TABS as readonly string[]).includes(value);
}

/**
 * Encode a Control Center deep-link as a push-view argument string. A bare tab
 * name (the common case, used by the static built-in commands) is passed
 * through unchanged; richer targets are JSON-encoded.
 */
export function encodeControlCenterArg(arg: ControlCenterArg): string {
  if (
    arg.project === undefined &&
    arg.sessionStatus === undefined &&
    arg.sessionId === undefined &&
    arg.agentPreference === undefined &&
    arg.includeLatestHandoff === undefined
  ) {
    return arg.tab;
  }
  return JSON.stringify(arg);
}

/**
 * Decode a push-view argument back into a Control Center target. Accepts both a
 * bare tab name and the JSON form; falls back to the Projects tab for anything
 * unrecognised so a malformed deep-link never crashes the view.
 */
export function decodeControlCenterArg(raw: string | null): ControlCenterArg {
  if (!raw) return { tab: 'projects' };
  if (isTab(raw)) return { tab: raw };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const tab = typeof obj['tab'] === 'string' && isTab(obj['tab']) ? obj['tab'] : 'projects';
      const project = typeof obj['project'] === 'string' ? obj['project'] : undefined;
      const sessionStatus =
        typeof obj['sessionStatus'] === 'string' ? obj['sessionStatus'] : undefined;
      const sessionId = typeof obj['sessionId'] === 'string' ? obj['sessionId'] : undefined;
      const agentPreference =
        typeof obj['agentPreference'] === 'string' &&
        (ALL_AGENT_PREFERENCES as readonly string[]).includes(obj['agentPreference'])
          ? (obj['agentPreference'] as AgentPreference)
          : undefined;
      const includeLatestHandoff =
        obj['includeLatestHandoff'] === true ? true : undefined;
      return {
        tab,
        ...(project ? { project } : {}),
        ...(sessionStatus ? { sessionStatus } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(agentPreference ? { agentPreference } : {}),
        ...(includeLatestHandoff ? { includeLatestHandoff } : {}),
      };
    }
  } catch {
    // not JSON — fall through
  }
  return { tab: 'projects' };
}

export interface ProjectMeta {
  readonly path: string;
  readonly name: string;
  readonly favourite: boolean;
  readonly lastOpened: number;
  readonly preferredAgent: string | null;
}

export interface ControlCenterState {
  readonly tab: ControlCenterTab;
  readonly relayStatus: RelayStatus | null;
  readonly selectedProject: string;
  readonly selectedAgent: string;
  readonly selectedSession: string;
  readonly agents: readonly RelayObject[];
  readonly projects: readonly RelayObject[];
  readonly sessions: readonly RelayObject[];
  readonly events: readonly RelayObject[];
  readonly busy: string | null;
  readonly error: string | null;
  readonly lastRefresh: number;
}

export function initialState(tab: ControlCenterTab = 'projects'): ControlCenterState {
  return {
    tab,
    relayStatus: null,
    selectedProject: '',
    selectedAgent: '',
    selectedSession: '',
    agents: [],
    projects: [],
    sessions: [],
    events: [],
    busy: null,
    error: null,
    lastRefresh: 0,
  };
}

export function relayState(status: RelayStatus | null): RelaySupervisorState {
  return status?.state ?? 'stopped';
}

export function isRelayReady(status: RelayStatus | null): boolean {
  return relayState(status) === 'ready';
}
