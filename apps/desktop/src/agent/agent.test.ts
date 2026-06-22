import { describe, expect, it, vi } from 'vitest';
import { NATIVE_TOOL_IDS } from '@orbit/tool-registry';
import { chooseAgent, dispatchAgentViaRelay, type RelayDispatchDeps } from './agentDispatch.js';
import { executeMissionStep, type MissionExecutorDeps } from './missionExecutor.js';

const AGENTS = [
  { id: 'codex', displayName: 'Codex', available: true },
  { id: 'claude-code', displayName: 'Claude Code', available: true },
  { id: 'antigravity', displayName: 'Antigravity', available: false },
];

describe('chooseAgent', () => {
  it('matches a named preference among available agents', () => {
    expect(chooseAgent(AGENTS, 'claude')?.id).toBe('claude-code');
    expect(chooseAgent(AGENTS, 'codex')?.id).toBe('codex');
  });

  it('skips an unavailable named agent and falls back to first available', () => {
    expect(chooseAgent(AGENTS, 'antigravity')?.id).toBe('codex');
  });

  it('picks the first available agent for "best"', () => {
    expect(chooseAgent(AGENTS, 'best')?.id).toBe('codex');
  });

  it('returns null when there are no agents', () => {
    expect(chooseAgent([], 'best')).toBeNull();
  });
});

describe('dispatchAgentViaRelay', () => {
  function deps(over: Partial<RelayDispatchDeps> = {}): RelayDispatchDeps {
    return {
      listAgents: () => Promise.resolve({ agents: AGENTS }),
      createLaunchPlan: () => Promise.resolve({ id: 'plan-1', warnings: ['dirty worktree'] }),
      executeLaunch: () => Promise.resolve({ sessionId: 's1' }),
      ...over,
    };
  }

  it('runs the real create-plan → execute flow and reports warnings', async () => {
    const executeLaunch = vi.fn().mockResolvedValue({ sessionId: 's1' });
    const result = await dispatchAgentViaRelay(deps({ executeLaunch }), 'C:/p/orbit', 'codex');
    expect(result.ok).toBe(true);
    expect(result.agentTitle).toBe('Codex');
    expect(result.sessionId).toBe('s1');
    expect(result.warnings).toContain('dirty worktree');
    // confirm:true must be passed — we never auto-launch unconfirmed.
    expect(executeLaunch).toHaveBeenCalledWith('plan-1', true);
  });

  it('fails cleanly when no plan id comes back', async () => {
    const result = await dispatchAgentViaRelay(
      deps({ createLaunchPlan: () => Promise.resolve({ warnings: [] }) }),
      'C:/p/orbit',
      'best',
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/did not return a launch plan/i);
  });

  it('fails cleanly when Relay is unreachable', async () => {
    const result = await dispatchAgentViaRelay(
      deps({ listAgents: () => Promise.reject(new Error('relay down')) }),
      'C:/p/orbit',
      'best',
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('relay down');
  });
});

describe('executeMissionStep', () => {
  function deps(over: Partial<MissionExecutorDeps> = {}): MissionExecutorDeps {
    return {
      resolveApp: (q) =>
        q.toLowerCase().includes('calc')
          ? { id: 'calc', name: 'Calculator', path: 'calc.exe' }
          : q.toLowerCase().includes('code')
            ? { id: 'vscode', name: 'Visual Studio Code', path: 'code.exe' }
            : null,
      resolveProject: (q) => (q.toLowerCase().includes('orbit') ? { name: 'Orbit', path: 'C:/p/orbit' } : null),
      resolveProjectFromIndex: async (q) =>
        q.toLowerCase().includes('research')
          ? {
              kind: 'match',
              project: { name: 'Personal Research Assistant', path: 'C:/Personal Research Assistant' },
            }
          : { kind: 'none' },
      chooseFolder: async (_q, choices) => choices[0] ?? null,
      launchApp: vi.fn().mockResolvedValue(undefined),
      openProjectInApplication: vi.fn().mockResolvedValue(undefined),
      revealFolder: vi.fn().mockResolvedValue(undefined),
      fileSearch: () => Promise.resolve([{ name: 'a.txt', parent: 'C:/docs' }]),
      noteSearch: () => Promise.resolve([{ title: 'Leonard' }]),
      dispatchAgent: () => Promise.resolve({ ok: true, summary: 'Launched Codex', warnings: [] }),
      restartRelay: vi.fn().mockResolvedValue(undefined),
      runQuickAi: () => Promise.resolve('a summary'),
      ...over,
    };
  }

  it('launches a resolved application', async () => {
    const launchApp = vi.fn().mockResolvedValue(undefined);
    const out = await executeMissionStep(
      { toolId: NATIVE_TOOL_IDS.openApplication, args: { applicationQuery: 'calculator' } },
      deps({ launchApp }),
    );
    expect(out.ok).toBe(true);
    expect(launchApp).toHaveBeenCalledWith('calc.exe');
  });

  it('fails an app step that resolves to nothing', async () => {
    const out = await executeMissionStep(
      { toolId: NATIVE_TOOL_IDS.openApplication, args: { applicationQuery: 'nope' } },
      deps(),
    );
    expect(out.ok).toBe(false);
  });

  it('opens a resolved project in a resolved application', async () => {
    const openProjectInApplication = vi.fn().mockResolvedValue(undefined);
    const out = await executeMissionStep(
      {
        toolId: NATIVE_TOOL_IDS.openProjectInApplication,
        args: { applicationQuery: 'vs code', projectQuery: 'orbit' },
      },
      deps({ openProjectInApplication }),
    );
    expect(out.ok).toBe(true);
    expect(openProjectInApplication).toHaveBeenCalledWith('vscode', 'C:/p/orbit');
  });

  it('falls back to an indexed folder when the catalog has no project', async () => {
    const openProjectInApplication = vi.fn().mockResolvedValue(undefined);
    const out = await executeMissionStep(
      {
        toolId: NATIVE_TOOL_IDS.openProjectInApplication,
        args: { applicationQuery: 'vs code', projectQuery: 'Personal Research Assistant' },
      },
      deps({ openProjectInApplication }),
    );
    expect(out.ok).toBe(true);
    expect(openProjectInApplication).toHaveBeenCalledWith(
      'vscode',
      'C:/Personal Research Assistant',
    );
  });

  it('asks the user to choose among ambiguous indexed folders, then opens the pick', async () => {
    const openProjectInApplication = vi.fn().mockResolvedValue(undefined);
    const chooseFolder = vi.fn(async (_q: string, choices: readonly { name: string; path: string }[]) =>
      choices[1] ?? null,
    );
    const out = await executeMissionStep(
      {
        toolId: NATIVE_TOOL_IDS.openProjectInApplication,
        args: { applicationQuery: 'vs code', projectQuery: 'reports' },
      },
      deps({
        openProjectInApplication,
        chooseFolder,
        resolveProjectFromIndex: async () => ({
          kind: 'choices',
          projects: [
            { name: 'reports', path: 'C:/Work/reports' },
            { name: 'reports', path: 'D:/Archive/reports' },
          ],
        }),
      }),
    );
    expect(chooseFolder).toHaveBeenCalledOnce();
    expect(out.ok).toBe(true);
    expect(openProjectInApplication).toHaveBeenCalledWith('vscode', 'D:/Archive/reports');
  });

  it('does not open anything when the user cancels the folder picker', async () => {
    const openProjectInApplication = vi.fn().mockResolvedValue(undefined);
    const out = await executeMissionStep(
      {
        toolId: NATIVE_TOOL_IDS.openProjectInApplication,
        args: { applicationQuery: 'vs code', projectQuery: 'reports' },
      },
      deps({
        openProjectInApplication,
        chooseFolder: async () => null,
        resolveProjectFromIndex: async () => ({
          kind: 'choices',
          projects: [
            { name: 'reports', path: 'C:/Work/reports' },
            { name: 'reports', path: 'D:/Archive/reports' },
          ],
        }),
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.summary).toMatch(/No folder chosen/);
    expect(openProjectInApplication).not.toHaveBeenCalled();
  });

  it('reveals an indexed folder when the catalog has no project', async () => {
    const revealFolder = vi.fn().mockResolvedValue(undefined);
    const out = await executeMissionStep(
      { toolId: NATIVE_TOOL_IDS.openProjectFolder, args: { projectQuery: 'research' } },
      deps({ revealFolder }),
    );
    expect(out.ok).toBe(true);
    expect(revealFolder).toHaveBeenCalledWith('C:/Personal Research Assistant');
  });

  it('dispatches an agent through the injected Relay path', async () => {
    const dispatchAgent = vi.fn().mockResolvedValue({
      ok: true,
      summary: 'Launched Codex',
      sessionId: 's1',
      warnings: ['w'],
    });
    const out = await executeMissionStep(
      { toolId: NATIVE_TOOL_IDS.dispatchAgent, args: { projectQuery: 'orbit', agentPreference: 'best' } },
      deps({ dispatchAgent }),
    );
    expect(dispatchAgent).toHaveBeenCalledWith('C:/p/orbit', 'best');
    expect(out.ok).toBe(true);
    expect(out.detail).toContain('w');
    expect(out.navigateTo?.viewId).toBe('control-center');
  });

  it('does not launch an untasked agent when Relay cannot accept the objective', async () => {
    const dispatchAgent = vi.fn();
    const out = await executeMissionStep(
      {
        toolId: NATIVE_TOOL_IDS.dispatchAgent,
        args: { projectQuery: 'orbit', objective: 'Implement the feature' },
      },
      deps({ dispatchAgent }),
    );
    expect(out.ok).toBe(false);
    expect(out.detail).toMatch(/No session was launched/);
    expect(dispatchAgent).not.toHaveBeenCalled();
  });

  it('returns a navigation target for a Control Center step', async () => {
    const out = await executeMissionStep(
      { toolId: NATIVE_TOOL_IDS.openControlCenter, args: { controlCenterTab: 'sessions', sessionStatus: 'failed' } },
      deps(),
    );
    expect(out.ok).toBe(true);
    expect(out.navigateTo?.viewId).toBe('control-center');
  });

  it('summarises a file search', async () => {
    const out = await executeMissionStep(
      { toolId: NATIVE_TOOL_IDS.findFiles, args: { fileQuery: 'a' } },
      deps(),
    );
    expect(out.summary).toContain('Found 1 file');
  });

  it('runs a quick-ai sub-task and captures the text', async () => {
    const out = await executeMissionStep(
      { toolId: NATIVE_TOOL_IDS.quickAi, args: { prompt: 'summarise this' } },
      deps(),
    );
    expect(out.detail).toBe('a summary');
  });
});
