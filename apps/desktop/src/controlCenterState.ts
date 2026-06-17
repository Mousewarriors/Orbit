/**
 * Control Center state model — shared typed state for the unified
 * project-first agent command surface.
 */
import type { RelayStatus, RelaySupervisorState } from './native.js';
import type { RelayObject } from './relayViewModel.js';

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
