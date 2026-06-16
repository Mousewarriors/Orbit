import { useCallback, useEffect, useMemo, useState } from 'react';
import * as native from '../native.js';
import {
  agentId,
  agentTitle,
  asObject,
  availabilityLabel,
  boolOf,
  canExecuteLaunch,
  canStopSession,
  displayTime,
  planId,
  projectPath,
  projectTitle,
  recordArray,
  recordString,
  recordsFrom,
  sessionId,
  statusTone,
  warningList,
  type RelayObject,
} from '../relayViewModel.js';

type Tab = 'launch' | 'sessions' | 'diagnostics';

export interface AgentCenterViewProps {
  readonly onPop: () => void;
}

export function AgentCenterView({ onPop }: AgentCenterViewProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('launch');
  const [status, setStatus] = useState<native.RelayStatus | null>(null);
  const [agents, setAgents] = useState<RelayObject[]>([]);
  const [projects, setProjects] = useState<RelayObject[]>([]);
  const [sessions, setSessions] = useState<RelayObject[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [projectRoot, setProjectRoot] = useState('');
  const [inspection, setInspection] = useState<RelayObject | null>(null);
  const [plan, setPlan] = useState<RelayObject | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedAgentRecord = useMemo(
    () => agents.find((agent) => agentId(agent) === selectedAgent) ?? null,
    [agents, selectedAgent],
  );
  const selectedProjectRecord = useMemo(
    () => projects.find((project) => projectPath(project) === selectedProject) ?? null,
    [projects, selectedProject],
  );

  const refreshStatus = useCallback(async () => {
    if (!native.isTauri()) return;
    setStatus(await native.relayStatus());
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!native.isTauri()) return;
    const payload = await native.relayListSessions();
    setSessions(recordsFrom(payload, 'sessions'));
  }, []);

  const refreshAgents = useCallback(async () => {
    if (!native.isTauri()) return;
    const payload = await native.relayListAgents();
    const next = recordsFrom(payload, 'agents');
    setAgents(next);
    setSelectedAgent((current) =>
      current && next.some((agent) => agentId(agent) === current)
        ? current
        : agentId(next[0] ?? null),
    );
  }, []);

  const scanProjects = useCallback(async () => {
    if (!native.isTauri()) return;
    setBusy('projects');
    setError(null);
    try {
      const payload = await native.relayScanProjects(projectRoot.trim() || null);
      const next = recordsFrom(payload, 'projects');
      setProjects(next);
      setSelectedProject((current) =>
        current && next.some((project) => projectPath(project) === current)
          ? current
          : projectPath(next[0] ?? null),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [projectRoot]);

  const inspectSelectedProject = useCallback(async () => {
    if (!native.isTauri() || !selectedProject) return;
    setBusy('inspect');
    setError(null);
    try {
      const payload = await native.relayInspectProject(selectedProject);
      setInspection(asObject(payload));
    } catch (e) {
      setInspection(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
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
      setPlan(asObject(payload));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [selectedAgent, selectedProject]);

  const executePlan = useCallback(async () => {
    const id = planId(plan);
    const relayReady = status?.state === 'ready';
    if (!native.isTauri() || !id || !canExecuteLaunch(plan, confirmed, relayReady, busy)) return;
    setBusy('execute');
    setError(null);
    try {
      await native.relayExecuteLaunch(id, true);
      setConfirmed(false);
      setPlan(null);
      await refreshSessions();
      setTab('sessions');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
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
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [refreshSessions],
  );

  const restartRelay = useCallback(async () => {
    if (!native.isTauri()) return;
    setBusy('restart');
    setError(null);
    try {
      setStatus(await native.relayRestart());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const loadInitialRelayData = useCallback(async () => {
    if (!native.isTauri()) return;
    try {
      await refreshStatus();
      await refreshAgents();
      const payload = await native.relayScanProjects(null);
      const next = recordsFrom(payload, 'projects');
      setProjects(next);
      setSelectedProject((current) =>
        current && next.some((project) => projectPath(project) === current)
          ? current
          : projectPath(next[0] ?? null),
      );
      await refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
        await native.onRelayStateChanged(setStatus),
        await native.onRelayDiagnosticsUpdated(setStatus),
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
    void inspectSelectedProject();
  }, [inspectSelectedProject]);

  const relayState = status?.state ?? 'stopped';
  const relayReady = relayState === 'ready';
  const launchDisabled = !relayReady || !selectedAgent || !selectedProject || busy === 'plan';
  const executeDisabled = !canExecuteLaunch(plan, confirmed, relayReady, busy);

  return (
    <div className="orbit-launcher agent-center">
      <div className="orbit-search">
        <button className="orbit-back" onClick={onPop} aria-label="Back">
          Back
        </button>
        <span className="orbit-breadcrumb">Agent Control</span>
        <div className={`relay-pill ${statusTone(relayState)}`}>
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

      <div className="relay-tabs" role="tablist" aria-label="Agent Control">
        <button className={tab === 'launch' ? 'is-active' : ''} onClick={() => setTab('launch')}>
          Launch
        </button>
        <button className={tab === 'sessions' ? 'is-active' : ''} onClick={() => setTab('sessions')}>
          Sessions
        </button>
        <button className={tab === 'diagnostics' ? 'is-active' : ''} onClick={() => setTab('diagnostics')}>
          Diagnostics
        </button>
      </div>

      {error && <div className="orbit-error">{error}</div>}

      {tab === 'launch' && (
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
              <button onClick={() => void scanProjects()} disabled={!relayReady || busy === 'projects'}>
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
              <span>{projectPath(inspection ?? selectedProjectRecord) || selectedProject || 'No project selected'}</span>
              {asObject(inspection?.git) && (
                <span>
                  Git {recordString(asObject(inspection?.git), 'branch') ?? 'unknown'} |{' '}
                  {boolOf(asObject(inspection?.git)?.dirty) ? 'dirty' : 'clean'}
                </span>
              )}
              {recordArray(inspection, 'contextFiles').length > 0 && (
                <span>Context {recordArray(inspection, 'contextFiles').filter((item): item is string => typeof item === 'string').join(', ')}</span>
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
      )}

      {tab === 'sessions' && (
        <div className="relay-session-list">
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
                    title={stoppable ? 'Stop session' : 'Relay does not report this session as safely stoppable'}
                  >
                    Stop
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'diagnostics' && (
        <div className="relay-diagnostics">
          <div className="relay-detail-block">
            <strong>{relayState}</strong>
            <span>{status?.technicalDetail ?? status?.userMessage ?? 'No status detail'}</span>
            <span>
              Relay {status?.expected.relayVersion ?? 'unknown'} | protocol{' '}
              {status?.ready?.protocolVersion ?? status?.expected.protocolVersion ?? 'unknown'}
            </span>
            <span>PID {status?.pid ?? 'none'}</span>
            <span>Sidecar {status?.sidecarPath ?? status?.expected.sidecarFileName ?? 'not resolved'}</span>
            <span>SHA-256 {status?.sidecarSha256 ?? 'not verified'}</span>
          </div>
          {status?.missingMethods.length ? (
            <div className="relay-warning">Missing methods: {status.missingMethods.join(', ')}</div>
          ) : null}
          <pre>{status?.diagnostics.length ? status.diagnostics.join('\n') : 'No diagnostics'}</pre>
        </div>
      )}
    </div>
  );
}
