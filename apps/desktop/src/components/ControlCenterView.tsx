import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as native from '../native.js';
import {
  ALL_TABS,
  TAB_LABELS,
  isRelayReady,
  relayState,
  type ControlCenterTab,
} from '../controlCenterState.js';
import {
  EMPTY_ROOT_MESSAGE,
  SCAN_ROOT_SETTING_KEY,
  agentId,
  agentTitle,
  asObject,
  availabilityLabel,
  boolOf,
  canExecuteLaunch,
  canStopSession,
  displayTime,
  isScanDisabled,
  planId,
  projectPath,
  projectTitle,
  recordArray,
  recordString,
  recordsFrom,
  resolveInitialScanRoot,
  sessionId,
  statusTone,
  validateScanRoot,
  warningList,
  type RelayObject,
} from '../relayViewModel.js';

export interface ControlCenterViewProps {
  readonly onPop: () => void;
  readonly initialTab?: ControlCenterTab | undefined;
}

export function ControlCenterView({ onPop, initialTab }: ControlCenterViewProps): JSX.Element {
  const [tab, setTab] = useState<ControlCenterTab>(initialTab ?? 'projects');
  const [status, setStatus] = useState<native.RelayStatus | null>(null);
  const [agents, setAgents] = useState<RelayObject[]>([]);
  const [projects, setProjects] = useState<RelayObject[]>([]);
  const [sessions, setSessions] = useState<RelayObject[]>([]);
  const [events, setEvents] = useState<RelayObject[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [projectRoot, setProjectRoot] = useState('');
  const [rootHydrated, setRootHydrated] = useState(false);
  const [inspection, setInspection] = useState<RelayObject | null>(null);
  const [plan, setPlan] = useState<RelayObject | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tabErrors, setTabErrors] = useState<Partial<Record<ControlCenterTab, string>>>({});
  const mountedRef = useRef(true);
  const eventPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (eventPollRef.current) clearTimeout(eventPollRef.current);
    };
  }, []);

  const selectedAgentRecord = useMemo(
    () => agents.find((agent) => agentId(agent) === selectedAgent) ?? null,
    [agents, selectedAgent],
  );
  const selectedProjectRecord = useMemo(
    () => projects.find((project) => projectPath(project) === selectedProject) ?? null,
    [projects, selectedProject],
  );

  const setTabError = useCallback((t: ControlCenterTab, msg: string | null) => {
    setTabErrors((prev) => {
      if (prev[t] === msg) return prev;
      const next = { ...prev };
      if (msg) next[t] = msg;
      else delete next[t];
      return next;
    });
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!native.isTauri()) return;
    try {
      const s = await native.relayStatus();
      if (mountedRef.current) setStatus(s);
    } catch {
      // non-fatal
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!native.isTauri()) return;
    try {
      const payload = await native.relayListSessions();
      if (mountedRef.current) setSessions(recordsFrom(payload, 'sessions'));
    } catch (e) {
      if (mountedRef.current) setTabError('sessions', e instanceof Error ? e.message : String(e));
    }
  }, [setTabError]);

  const refreshAgents = useCallback(async () => {
    if (!native.isTauri()) return;
    try {
      const payload = await native.relayListAgents();
      const next = recordsFrom(payload, 'agents');
      if (mountedRef.current) {
        setAgents(next);
        setSelectedAgent((current) =>
          current && next.some((agent) => agentId(agent) === current)
            ? current
            : agentId(next[0] ?? null),
        );
      }
    } catch (e) {
      if (mountedRef.current) setTabError('launch', e instanceof Error ? e.message : String(e));
    }
  }, [setTabError]);

  const refreshEvents = useCallback(async () => {
    if (!native.isTauri()) return;
    try {
      const payload = await native.relayListEvents();
      if (mountedRef.current) {
        const next = recordsFrom(payload, 'events');
        setEvents((prev) => deduplicateEvents(prev, next));
        setTabError('activity', null);
      }
    } catch (e) {
      if (mountedRef.current) setTabError('activity', e instanceof Error ? e.message : String(e));
    }
  }, [setTabError]);

  const scanProjects = useCallback(async () => {
    if (!native.isTauri()) return;
    const trimmedRoot = validateScanRoot(projectRoot);
    if (!trimmedRoot) {
      setError(EMPTY_ROOT_MESSAGE);
      return;
    }
    setBusy('projects');
    setError(null);
    try {
      const payload = await native.relayScanProjects(trimmedRoot);
      const next = recordsFrom(payload, 'projects');
      if (mountedRef.current) {
        setProjects(next);
        setSelectedProject((current) =>
          current && next.some((project) => projectPath(project) === current)
            ? current
            : projectPath(next[0] ?? null),
        );
        await native.setSetting(SCAN_ROOT_SETTING_KEY, trimmedRoot);
      }
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [projectRoot]);

  const inspectSelectedProject = useCallback(async () => {
    if (!native.isTauri() || !selectedProject) return;
    setBusy('inspect');
    setError(null);
    try {
      const payload = await native.relayInspectProject(selectedProject);
      if (mountedRef.current) setInspection(asObject(payload));
    } catch (e) {
      if (mountedRef.current) {
        setInspection(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [selectedProject]);

  const createPlan = useCallback(async () => {
    if (!native.isTauri() || !selectedAgent || !selectedProject) return;
    setBusy('plan');
    setError(null);
    setPlan(null);
    setConfirmed(false);
    try {
      const payload = await native.relayCreateLaunchPlan(selectedAgent, selectedProject);
      if (mountedRef.current) setPlan(asObject(payload));
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [selectedAgent, selectedProject]);

  const executePlan = useCallback(async () => {
    const id = planId(plan);
    const relayReady = isRelayReady(status);
    if (!native.isTauri() || !id || !canExecuteLaunch(plan, confirmed, relayReady, busy)) return;
    setBusy('execute');
    setError(null);
    try {
      await native.relayExecuteLaunch(id, true);
      if (mountedRef.current) {
        setConfirmed(false);
        setPlan(null);
        await refreshSessions();
        setTab('sessions');
      }
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [busy, confirmed, plan, refreshSessions, status]);

  const stopSession = useCallback(
    async (id: string) => {
      if (!native.isTauri() || !id) return;
      setBusy(`stop:${id}`);
      setError(null);
      try {
        await native.relayStopSession(id);
        await refreshSessions();
      } catch (e) {
        if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [refreshSessions],
  );

  const restartRelay = useCallback(async () => {
    if (!native.isTauri()) return;
    setBusy('restart');
    setError(null);
    try {
      const s = await native.relayRestart();
      if (mountedRef.current) setStatus(s);
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, []);

  const loadInitialRelayData = useCallback(async () => {
    if (!native.isTauri()) return;
    try {
      await refreshStatus();
      await refreshAgents();
      await refreshSessions();
      const persisted = await native.getSetting(SCAN_ROOT_SETTING_KEY);
      const homeDir = await native.getHomeDir();
      if (mountedRef.current) setProjectRoot(resolveInitialScanRoot(persisted, homeDir));
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setRootHydrated(true);
    }
  }, [refreshAgents, refreshSessions, refreshStatus]);

  useEffect(() => {
    void loadInitialRelayData();
  }, [loadInitialRelayData]);

  useEffect(() => {
    if (!native.isTauri()) return;
    let cancelled = false;
    let cleanup: Array<() => void> = [];
    void (async () => {
      const unlisteners = [
        await native.onRelayStateChanged((s) => {
          if (!cancelled) setStatus(s);
        }),
        await native.onRelayDiagnosticsUpdated((s) => {
          if (!cancelled) setStatus(s);
        }),
        ...(await native.onRelaySessionEvent(() => void refreshSessions())),
      ];
      if (cancelled) {
        for (const unlisten of unlisteners) unlisten();
      } else {
        cleanup = unlisteners;
      }
    })();
    return () => {
      cancelled = true;
      for (const unlisten of cleanup) unlisten();
    };
  }, [refreshSessions]);

  useEffect(() => {
    setPlan(null);
    setConfirmed(false);
    if (tab === 'launch') void inspectSelectedProject();
  }, [inspectSelectedProject, tab]);

  // Bounded event polling when Activity tab is visible
  useEffect(() => {
    if (tab !== 'activity') return;
    void refreshEvents();
    const poll = () => {
      eventPollRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        await refreshEvents();
        if (mountedRef.current && tab === 'activity') poll();
      }, 5000);
    };
    poll();
    return () => {
      if (eventPollRef.current) {
        clearTimeout(eventPollRef.current);
        eventPollRef.current = null;
      }
    };
  }, [tab, refreshEvents]);

  const rState = relayState(status);
  const relayReady = rState === 'ready';
  const launchDisabled = !relayReady || !selectedAgent || !selectedProject || busy === 'plan';
  const executeDisabled = !canExecuteLaunch(plan, confirmed, relayReady, busy);

  const onTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = ALL_TABS.indexOf(tab);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        const next = (idx + dir + ALL_TABS.length) % ALL_TABS.length;
        setTab(ALL_TABS[next]!);
      }
    },
    [tab],
  );

  const handleBack = useCallback(
    (e: React.KeyboardEvent | React.MouseEvent) => {
      e.preventDefault();
      onPop();
    },
    [onPop],
  );

  const onViewKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onPop();
      }
    },
    [onPop],
  );

  return (
    <div className="orbit-launcher agent-center" onKeyDown={onViewKeyDown} tabIndex={-1}>
      {/* Header */}
      <div className="orbit-search">
        <button className="orbit-back" onClick={handleBack} aria-label="Back">
          Back
        </button>
        <span className="orbit-breadcrumb">Control Center</span>
        <div className={`relay-pill ${statusTone(rState)}`}>
          {status?.userMessage ?? 'Relay status unavailable'}
        </div>
        <button
          className="relay-icon-button"
          onClick={() => void restartRelay()}
          disabled={busy === 'restart'}
          title="Restart Relay"
        >
          Restart
        </button>
      </div>

      {/* Tab bar */}
      <div className="relay-tabs" role="tablist" aria-label="Control Center" onKeyDown={onTabKeyDown}>
        {ALL_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'is-active' : ''}
            onClick={() => setTab(t)}
            tabIndex={tab === t ? 0 : -1}
          >
            {TAB_LABELS[t]}
            {tabErrors[t] ? ' !' : ''}
          </button>
        ))}
      </div>

      {/* Global error */}
      {error && <div className="orbit-error">{error}</div>}

      {/* Tab panels — each wrapped in an error boundary equivalent (try-catch in render is not possible in React, so we isolate via conditional rendering) */}
      <TabPanel active={tab === 'projects'}>
        <ProjectsPanel
          projects={projects}
          selectedProject={selectedProject}
          setSelectedProject={setSelectedProject}
          projectRoot={projectRoot}
          setProjectRoot={setProjectRoot}
          rootHydrated={rootHydrated}
          relayReady={relayReady}
          scanning={busy === 'projects'}
          scanProjects={scanProjects}
          inspection={inspection}
          inspectSelectedProject={inspectSelectedProject}
          busy={busy}
          tabError={tabErrors['projects'] ?? null}
        />
      </TabPanel>

      <TabPanel active={tab === 'launch'}>
        <LaunchPanel
          agents={agents}
          selectedAgent={selectedAgent}
          setSelectedAgent={setSelectedAgent}
          selectedAgentRecord={selectedAgentRecord}
          selectedProjectRecord={selectedProjectRecord}
          projects={projects}
          selectedProject={selectedProject}
          setSelectedProject={setSelectedProject}
          projectRoot={projectRoot}
          setProjectRoot={setProjectRoot}
          rootHydrated={rootHydrated}
          relayReady={relayReady}
          scanning={busy === 'projects'}
          scanProjects={scanProjects}
          inspection={inspection}
          plan={plan}
          confirmed={confirmed}
          setConfirmed={setConfirmed}
          setPlan={setPlan}
          busy={busy}
          launchDisabled={launchDisabled}
          executeDisabled={executeDisabled}
          refreshAgents={refreshAgents}
          createPlan={createPlan}
          executePlan={executePlan}
        />
      </TabPanel>

      <TabPanel active={tab === 'sessions'}>
        <SessionsPanel
          sessions={sessions}
          busy={busy}
          stopSession={stopSession}
          tabError={tabErrors['sessions'] ?? null}
        />
      </TabPanel>

      <TabPanel active={tab === 'activity'}>
        <ActivityPanel
          events={events}
          tabError={tabErrors['activity'] ?? null}
          relayReady={relayReady}
          onNavigate={(t) => setTab(t)}
        />
      </TabPanel>

      <TabPanel active={tab === 'handoffs'}>
        <HandoffsPanel relayReady={relayReady} tabError={tabErrors['handoffs'] ?? null} />
      </TabPanel>

      <TabPanel active={tab === 'approvals'}>
        <ApprovalsPanel tabError={tabErrors['approvals'] ?? null} />
      </TabPanel>

      <TabPanel active={tab === 'diagnostics'}>
        <DiagnosticsPanel status={status} relayState={rState} />
      </TabPanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab panel wrapper (mounts/unmounts on switch to avoid stale state)
// ---------------------------------------------------------------------------

function TabPanel({
  active,
  children,
}: {
  readonly active: boolean;
  readonly children: React.ReactNode;
}): JSX.Element | null {
  if (!active) return null;
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Projects tab
// ---------------------------------------------------------------------------

function ProjectsPanel({
  projects,
  selectedProject,
  setSelectedProject,
  projectRoot,
  setProjectRoot,
  rootHydrated,
  relayReady,
  scanning,
  scanProjects,
  inspection,
  inspectSelectedProject,
  busy,
  tabError,
}: {
  readonly projects: RelayObject[];
  readonly selectedProject: string;
  readonly setSelectedProject: (p: string) => void;
  readonly projectRoot: string;
  readonly setProjectRoot: (v: string) => void;
  readonly rootHydrated: boolean;
  readonly relayReady: boolean;
  readonly scanning: boolean;
  readonly scanProjects: () => Promise<void>;
  readonly inspection: RelayObject | null;
  readonly inspectSelectedProject: () => Promise<void>;
  readonly busy: string | null;
  readonly tabError: string | null;
}): JSX.Element {
  const selected = useMemo(
    () => projects.find((p) => projectPath(p) === selectedProject) ?? null,
    [projects, selectedProject],
  );

  return (
    <div className="relay-workspace cc-projects-workspace">
      <section className="relay-column" aria-label="Projects">
        <div className="relay-section-head">
          <span>Projects</span>
          <button
            onClick={() => void scanProjects()}
            disabled={isScanDisabled({ rootHydrated, root: projectRoot, relayReady, scanning })}
          >
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
        </div>
        <input
          className="relay-input"
          value={projectRoot}
          onChange={(e) => setProjectRoot(e.target.value)}
          placeholder="Project scan root"
        />
        {tabError && <div className="relay-tab-error">{tabError}</div>}
        <div className="relay-list">
          {projects.length === 0 ? (
            <div className="relay-empty">
              {rootHydrated ? 'No projects scanned yet' : 'Loading...'}
            </div>
          ) : (
            projects.map((project) => {
              const path = projectPath(project);
              return (
                <button
                  key={path}
                  className={selectedProject === path ? 'relay-row is-selected' : 'relay-row'}
                  onClick={() => setSelectedProject(path)}
                >
                  <span>{projectTitle(project)}</span>
                  <small>{path}</small>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="relay-detail cc-project-detail" aria-label="Project details">
        {selected ? (
          <>
            <div className="relay-detail-block">
              <strong>{projectTitle(selected)}</strong>
              <span>{recordString(selected, 'kind') ?? 'Project'}</span>
              <span>{projectPath(selected)}</span>
              {asObject(inspection?.git) && (
                <span>
                  Branch: {recordString(asObject(inspection?.git), 'branch') ?? 'unknown'} |{' '}
                  {boolOf(asObject(inspection?.git)?.dirty) ? 'dirty' : 'clean'}
                </span>
              )}
              {recordArray(inspection, 'contextFiles').length > 0 && (
                <span>
                  Context:{' '}
                  {recordArray(inspection, 'contextFiles')
                    .filter((item): item is string => typeof item === 'string')
                    .join(', ')}
                </span>
              )}
            </div>
            <div className="cc-project-actions">
              <button
                className="relay-primary"
                onClick={() => void inspectSelectedProject()}
                disabled={busy === 'inspect'}
              >
                {busy === 'inspect' ? 'Inspecting...' : 'Inspect Project'}
              </button>
            </div>
          </>
        ) : (
          <div className="relay-empty">Select a project to see details</div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Launch tab (preserves existing flow)
// ---------------------------------------------------------------------------

function LaunchPanel({
  agents,
  selectedAgent,
  setSelectedAgent,
  selectedAgentRecord,
  selectedProjectRecord,
  projects,
  selectedProject,
  setSelectedProject,
  projectRoot,
  setProjectRoot,
  rootHydrated,
  relayReady,
  scanning,
  scanProjects,
  inspection,
  plan,
  confirmed,
  setConfirmed,
  setPlan,
  busy,
  launchDisabled,
  executeDisabled,
  refreshAgents,
  createPlan,
  executePlan,
}: {
  readonly agents: RelayObject[];
  readonly selectedAgent: string;
  readonly setSelectedAgent: (id: string) => void;
  readonly selectedAgentRecord: RelayObject | null;
  readonly selectedProjectRecord: RelayObject | null;
  readonly projects: RelayObject[];
  readonly selectedProject: string;
  readonly setSelectedProject: (p: string) => void;
  readonly projectRoot: string;
  readonly setProjectRoot: (v: string) => void;
  readonly rootHydrated: boolean;
  readonly relayReady: boolean;
  readonly scanning: boolean;
  readonly scanProjects: () => Promise<void>;
  readonly inspection: RelayObject | null;
  readonly plan: RelayObject | null;
  readonly confirmed: boolean;
  readonly setConfirmed: (v: boolean) => void;
  readonly setPlan: (v: RelayObject | null) => void;
  readonly busy: string | null;
  readonly launchDisabled: boolean;
  readonly executeDisabled: boolean;
  readonly refreshAgents: () => Promise<void>;
  readonly createPlan: () => Promise<void>;
  readonly executePlan: () => Promise<void>;
}): JSX.Element {
  return (
    <div className="relay-workspace">
      <section className="relay-column" aria-label="Agents">
        <div className="relay-section-head">
          <span>Agent</span>
          <button onClick={() => void refreshAgents()} disabled={!relayReady}>
            Refresh
          </button>
        </div>
        <div className="relay-list">
          {agents.length === 0 ? (
            <div className="relay-empty">No agents</div>
          ) : (
            agents.map((agent) => {
              const id = agentId(agent);
              return (
                <button
                  key={id}
                  className={selectedAgent === id ? 'relay-row is-selected' : 'relay-row'}
                  onClick={() => setSelectedAgent(id)}
                >
                  <span>{agentTitle(agent)}</span>
                  <small>{availabilityLabel(agent)}</small>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="relay-column" aria-label="Projects">
        <div className="relay-section-head">
          <span>Project</span>
          <button
            onClick={() => void scanProjects()}
            disabled={isScanDisabled({ rootHydrated, root: projectRoot, relayReady, scanning })}
          >
            Scan
          </button>
        </div>
        <input
          className="relay-input"
          value={projectRoot}
          onChange={(e) => setProjectRoot(e.target.value)}
          placeholder="Project root path"
        />
        <div className="relay-list">
          {projects.length === 0 ? (
            <div className="relay-empty">No projects</div>
          ) : (
            projects.map((project) => {
              const path = projectPath(project);
              return (
                <button
                  key={path}
                  className={selectedProject === path ? 'relay-row is-selected' : 'relay-row'}
                  onClick={() => setSelectedProject(path)}
                >
                  <span>{projectTitle(project)}</span>
                  <small>{path}</small>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="relay-detail" aria-label="Launch">
        <div className="relay-detail-block">
          <strong>{projectTitle(inspection ?? selectedProjectRecord)}</strong>
          <span>{recordString(inspection, 'kind') ?? 'Project'}</span>
          <span>
            {projectPath(inspection ?? selectedProjectRecord) || selectedProject || 'No project selected'}
          </span>
          {asObject(inspection?.git) && (
            <span>
              Git {recordString(asObject(inspection?.git), 'branch') ?? 'unknown'} |{' '}
              {boolOf(asObject(inspection?.git)?.dirty) ? 'dirty' : 'clean'}
            </span>
          )}
          {recordArray(inspection, 'contextFiles').length > 0 && (
            <span>
              Context{' '}
              {recordArray(inspection, 'contextFiles')
                .filter((item): item is string => typeof item === 'string')
                .join(', ')}
            </span>
          )}
        </div>

        <button className="relay-primary" onClick={() => void createPlan()} disabled={launchDisabled}>
          {busy === 'plan' ? 'Planning...' : 'Create Launch Plan'}
        </button>

        {plan && (
          <div className="relay-preview">
            <strong>Launch Preview</strong>
            <code>{recordString(plan, 'preview') ?? 'No preview returned'}</code>
            <span>Agent {agentTitle(selectedAgentRecord)}</span>
            <span>Project {recordString(plan, 'projectPath') ?? selectedProject}</span>
            <span>Executable {recordString(plan, 'executable') ?? 'Not returned'}</span>
            <span>Working directory {recordString(plan, 'cwd') ?? 'Not returned'}</span>
            <span>Expires {displayTime(plan.expiresAtMs)}</span>
            {warningList(plan).map((warning) => (
              <span key={warning} className="relay-warning">
                {warning}
              </span>
            ))}
            <label className="relay-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Confirm launch
            </label>
            <div className="relay-actions">
              <button onClick={() => void executePlan()} disabled={executeDisabled}>
                {busy === 'execute' ? 'Launching...' : 'Launch'}
              </button>
              <button
                onClick={() => {
                  setPlan(null);
                  setConfirmed(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions tab (preserved)
// ---------------------------------------------------------------------------

function SessionsPanel({
  sessions,
  busy,
  stopSession,
  tabError,
}: {
  readonly sessions: RelayObject[];
  readonly busy: string | null;
  readonly stopSession: (id: string) => Promise<void>;
  readonly tabError: string | null;
}): JSX.Element {
  return (
    <div className="relay-session-list">
      {tabError && <div className="relay-tab-error">{tabError}</div>}
      {sessions.length === 0 ? (
        <div className="relay-empty">No sessions</div>
      ) : (
        sessions.map((session) => {
          const id = sessionId(session);
          const stoppable = canStopSession(session);
          return (
            <div key={id} className="relay-session-row">
              <div>
                <strong>{recordString(session, 'agentId') ?? 'Unknown agent'}</strong>
                <span>{recordString(session, 'projectPath') ?? 'Unknown project'}</span>
                <small>
                  {recordString(session, 'status') ?? 'unknown'} |{' '}
                  {recordString(session, 'ownership') ?? 'unknown'} |{' '}
                  {displayTime(session.startedAtMs)}
                </small>
              </div>
              <button
                disabled={!stoppable || busy === `stop:${id}`}
                onClick={() => void stopSession(id)}
                title={
                  stoppable
                    ? 'Stop session'
                    : 'Relay does not report this session as safely stoppable'
                }
              >
                Stop
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity tab
// ---------------------------------------------------------------------------

function ActivityPanel({
  events,
  tabError,
  relayReady,
  onNavigate,
}: {
  readonly events: RelayObject[];
  readonly tabError: string | null;
  readonly relayReady: boolean;
  readonly onNavigate: (tab: ControlCenterTab) => void;
}): JSX.Element {
  return (
    <div className="relay-session-list cc-activity">
      {!relayReady && <div className="relay-tab-error">Relay is not ready — events unavailable</div>}
      {tabError && <div className="relay-tab-error">{tabError}</div>}
      {events.length === 0 ? (
        <div className="relay-empty">No activity yet</div>
      ) : (
        events.map((event, i) => {
          const type = recordString(event, 'type') ?? recordString(event, 'kind') ?? 'event';
          const ts = displayTime(event.timestamp ?? event.timestampMs ?? event.ts);
          const agent = recordString(event, 'agentId') ?? '';
          const project = recordString(event, 'projectPath') ?? '';
          const summary = recordString(event, 'summary') ?? recordString(event, 'message') ?? type;
          const sid = recordString(event, 'sessionId') ?? '';
          return (
            <div key={eventKey(event, i)} className="relay-session-row cc-event-row">
              <div>
                <strong>{summary}</strong>
                <span>
                  {type}
                  {agent ? ` · ${agent}` : ''}
                  {project ? ` · ${project.split(/[\\/]/).pop()}` : ''}
                </span>
                <small>{ts}</small>
              </div>
              {sid && (
                <button onClick={() => onNavigate('sessions')} title="View session">
                  Session
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Handoffs tab (foundation)
// ---------------------------------------------------------------------------

function HandoffsPanel({
  relayReady,
  tabError,
}: {
  readonly relayReady: boolean;
  readonly tabError: string | null;
}): JSX.Element {
  return (
    <div className="relay-session-list cc-handoffs">
      {!relayReady && (
        <div className="relay-tab-error">Relay is not ready — handoff operations unavailable</div>
      )}
      {tabError && <div className="relay-tab-error">{tabError}</div>}
      <div className="relay-empty">
        <div>Handoff workspace</div>
        <small style={{ display: 'block', marginTop: 6 }}>
          Create, validate and continue agent-to-agent handoffs from the Launch tab or project
          details. Handoff history will appear here.
        </small>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approvals tab (observational foundation)
// ---------------------------------------------------------------------------

function ApprovalsPanel({
  tabError,
}: {
  readonly tabError: string | null;
}): JSX.Element {
  return (
    <div className="relay-session-list cc-approvals">
      {tabError && <div className="relay-tab-error">{tabError}</div>}
      <div className="relay-empty">
        <div>Approvals — observational</div>
        <small style={{ display: 'block', marginTop: 6 }}>
          Approval-related events from Relay will appear here when available. Approval responses are
          currently handled externally. This view will combine Relay and AgentOS Gateway approvals
          once the Gateway integration is complete.
        </small>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diagnostics tab (preserved)
// ---------------------------------------------------------------------------

function DiagnosticsPanel({
  status,
  relayState: rState,
}: {
  readonly status: native.RelayStatus | null;
  readonly relayState: string;
}): JSX.Element {
  return (
    <div className="relay-diagnostics">
      <div className="relay-detail-block">
        <strong>{rState}</strong>
        <span>{status?.technicalDetail ?? status?.userMessage ?? 'No status detail'}</span>
        <span>
          Relay {status?.expected.relayVersion ?? 'unknown'} | protocol{' '}
          {status?.ready?.protocolVersion ?? status?.expected.protocolVersion ?? 'unknown'}
        </span>
        <span>PID {status?.pid ?? 'none'}</span>
        <span>
          Sidecar {status?.sidecarPath ?? status?.expected.sidecarFileName ?? 'not resolved'}
        </span>
        <span>SHA-256 {status?.sidecarSha256 ?? 'not verified'}</span>
      </div>
      {status?.missingMethods.length ? (
        <div className="relay-warning">Missing methods: {status.missingMethods.join(', ')}</div>
      ) : null}
      <pre>{status?.diagnostics.length ? status.diagnostics.join('\n') : 'No diagnostics'}</pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventKey(event: RelayObject, fallbackIndex: number): string {
  const id = recordString(event, 'id') ?? recordString(event, 'eventId');
  if (id) return id;
  const ts = String(event.timestamp ?? event.timestampMs ?? event.ts ?? '');
  const type = recordString(event, 'type') ?? recordString(event, 'kind') ?? '';
  return ts && type ? `${type}-${ts}` : `event-${fallbackIndex}`;
}

const MAX_EVENTS = 200;

function deduplicateEvents(
  prev: readonly RelayObject[],
  next: readonly RelayObject[],
): RelayObject[] {
  const seen = new Set<string>();
  const merged: RelayObject[] = [];
  for (const event of [...next, ...prev]) {
    const key = eventKey(event, merged.length);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(event);
    }
    if (merged.length >= MAX_EVENTS) break;
  }
  return merged;
}
