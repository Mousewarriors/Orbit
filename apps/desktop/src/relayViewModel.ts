export type RelayObject = Record<string, unknown>;

export function asObject(value: unknown): RelayObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RelayObject)
    : null;
}

export function stringOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function boolOf(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function recordString(record: RelayObject | null, key: string): string | null {
  return record ? stringOf(record[key]) : null;
}

export function recordArray(record: RelayObject | null, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

export function recordsFrom(payload: unknown, key: string): RelayObject[] {
  const root = asObject(payload);
  const source = Array.isArray(payload) ? payload : recordArray(root, key);
  return source.flatMap((item) => {
    const object = asObject(item);
    return object ? [object] : [];
  });
}

export function displayTime(ms: unknown): string {
  const value = numberOf(ms);
  if (!value || value <= 0) return 'Unknown';
  return new Date(value).toLocaleString();
}

export function agentId(agent: RelayObject | null): string {
  return recordString(agent, 'id') ?? recordString(agent, 'agentId') ?? '';
}

export function agentTitle(agent: RelayObject | null): string {
  return recordString(agent, 'displayName') ?? recordString(agent, 'name') ?? agentId(agent);
}

export function projectPath(project: RelayObject | null): string {
  return recordString(project, 'path') ?? recordString(project, 'projectPath') ?? '';
}

export function projectTitle(project: RelayObject | null): string {
  const path = projectPath(project);
  return recordString(project, 'name') ?? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function sessionId(session: RelayObject | null): string {
  return recordString(session, 'id') ?? recordString(session, 'sessionId') ?? '';
}

export function availabilityLabel(agent: RelayObject): string {
  if (boolOf(agent.requiresGateway) === true) return 'Gateway only';
  if (boolOf(agent.available) === true) return 'Available';
  const reason = recordString(agent, 'unavailableReason') ?? '';
  if (reason.toLowerCase().includes('not found')) return 'Not detected';
  const capabilities = recordArray(agent, 'capabilities').filter(
    (item): item is string => typeof item === 'string',
  );
  if (capabilities.length > 0 && !capabilities.includes('local_launch')) {
    return 'Capability limited';
  }
  return 'Unavailable';
}

export function statusTone(state: string): string {
  if (state === 'ready') return 'is-ready';
  if (state === 'starting' || state === 'awaiting-ready' || state === 'restarting') {
    return 'is-busy';
  }
  if (state === 'incompatible' || state === 'failed') return 'is-bad';
  if (state === 'degraded') return 'is-warn';
  return 'is-muted';
}

export function canStopSession(session: RelayObject): boolean {
  const explicit = boolOf(session.stoppable);
  if (explicit !== null) return explicit;
  const ownership = recordString(session, 'ownership');
  const status = recordString(session, 'status');
  return ownership === 'owned' && (status === 'running' || status === 'starting');
}

export function planId(plan: RelayObject | null): string {
  return recordString(plan, 'id') ?? recordString(plan, 'planId') ?? '';
}

export function warningList(record: RelayObject | null): string[] {
  return recordArray(record, 'warnings').filter((item): item is string => typeof item === 'string');
}

export function canExecuteLaunch(
  plan: RelayObject | null,
  confirmed: boolean,
  relayReady: boolean,
  busy: string | null,
): boolean {
  return relayReady && Boolean(planId(plan)) && confirmed && busy !== 'execute';
}
