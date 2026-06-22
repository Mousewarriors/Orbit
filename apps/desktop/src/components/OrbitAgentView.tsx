import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bestProject, rankApps, resolveProjectMatch, type ProjectCandidate } from '@orbit/intent';
import { recommendAgent } from '@orbit/agents';
import {
  missionStepViews,
  planMission,
  type MissionPlan,
  type MissionStepOutcome,
  type MissionStepStatus,
  type MissionStepView,
} from '@orbit/mission';
import type { AiMessage } from '@orbit/ai-runtime';
import * as native from '../native.js';
import { AI_SETTING_KEYS, parseFolderConfidence, type ProviderInfo } from '../ai/providerConfig.js';
import { loadProviderInfo } from '../ai/providerLoad.js';
import { buildMessages, decodeQuickAiArg, type QuickAiContext } from '../ai/quickAi.js';
import { buildToolRegistry } from '../ai/toolRegistry.js';
import { buildAutomationPlan, getAutomation } from '@orbit/automations';
import { decodeAutomationArg } from '../agent/automationProvider.js';
import { dispatchAgentViaRelay } from '../agent/agentDispatch.js';
import {
  executeMissionStep,
  MISSION_EXECUTABLE_TOOL_IDS,
  type MissionExecutorDeps,
} from '../agent/missionExecutor.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { FolderPickerDialog, type FolderChoice } from './FolderPickerDialog.js';
import { ToolRegistry } from '@orbit/tool-registry';

type Phase = 'idle' | 'planning' | 'preview' | 'running' | 'done';

/**
 * Orbit Agent — say what you want done; Orbit turns it into a *validated* plan of
 * whitelisted tool calls, shows it, gates every consequential step, then executes
 * deterministically. Deterministic-first (no AI for recognised goals); agent
 * dispatch runs through the real Relay launch flow. Honest throughout: it never
 * claims a step succeeded that didn't, and it shows the active provider + Relay
 * state plainly.
 */
export function OrbitAgentView({
  initialArg,
  onPop,
  onNavigate,
}: {
  initialArg?: string | undefined;
  onPop: () => void;
  onNavigate: (viewId: string, arg: string | null) => void;
}): JSX.Element {
  const automationId = useMemo(() => decodeAutomationArg(initialArg), [initialArg]);
  const launch = useMemo(
    () => (automationId ? { prompt: '' } : decodeQuickAiArg(initialArg)),
    [automationId, initialArg],
  );
  const [goal, setGoal] = useState(launch.prompt);
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<MissionPlan | null>(null);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [info, setInfo] = useState<ProviderInfo | null>(null);
  const [registry, setRegistry] = useState<ToolRegistry | null>(null);
  const [relayState, setRelayState] = useState<string>('unknown');
  const [statuses, setStatuses] = useState<MissionStepStatus[]>([]);
  const [outcomes, setOutcomes] = useState<Array<MissionStepOutcome | null>>([]);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const [folderChoice, setFolderChoice] = useState<{
    query: string;
    choices: readonly FolderChoice[];
  } | null>(null);
  const [navTarget, setNavTarget] = useState<{ viewId: string; arg: string | null } | null>(null);

  const apps = useRef<native.NativeApp[]>([]);
  const projects = useRef<ProjectCandidate[]>([]);
  const folderConfidence = useRef<number | undefined>(undefined);
  const clipboard = useRef<string>('');
  const stoppedRef = useRef(false);
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null);
  const folderResolver = useRef<((choice: FolderChoice | null) => void) | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load registry, provider config, relay state and resolution caches.
  useEffect(() => {
    void (async () => {
      const built = await buildToolRegistry();
      setRegistry(built.registry);
      setInfo(await loadProviderInfo());
      if (!native.isTauri()) return;
      try {
        const [appList, recent, favs, catalogued, status, clip] = await Promise.all([
          native.listApplications().catch((): native.NativeApp[] => []),
          native.projectMetaListRecent(20).catch((): native.ProjectMeta[] => []),
          native.projectMetaListFavourites().catch((): native.ProjectMeta[] => []),
          native.projectMetaListCatalogued().catch((): native.ProjectMeta[] => []),
          native.relayStatus().catch(() => null),
          native.clipboardList('', 1).catch((): native.ClipboardEntry[] => []),
        ]);
        apps.current = appList;
        const merged = new Map<string, ProjectCandidate>();
        for (const p of [...favs, ...recent, ...catalogued]) {
          if (!merged.has(p.path)) merged.set(p.path, { path: p.path, name: p.name });
        }
        projects.current = [...merged.values()];
        folderConfidence.current = parseFolderConfidence(
          await native.getSetting(AI_SETTING_KEYS.folderConfidence).catch(() => null),
        );
        setRelayState(status?.state ?? 'unknown');
        clipboard.current = clip[0]?.content ?? '';
      } catch {
        /* secondary context is best-effort */
      }
    })();
  }, []);

  const missionRegistry = useMemo(() => {
    if (!registry) return null;
    const executable = new ToolRegistry();
    executable.register(
      registry.all().filter((tool) => MISSION_EXECUTABLE_TOOL_IDS.has(tool.id)),
    );
    return executable;
  }, [registry]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A saved automation arrives as a prebuilt plan: compile it against the live
  // registry once that's ready and land straight on the preview.
  useEffect(() => {
    if (!missionRegistry || !automationId) return;
    const def = getAutomation(automationId);
    if (!def) return;
    const built = buildAutomationPlan(def, missionRegistry);
    if (!built) {
      setPlanNote('This automation uses a tool that is currently unavailable.');
      return;
    }
    setGoal(def.title);
    setPlan(built);
    setStatuses(built.steps.map(() => 'pending'));
    setOutcomes(built.steps.map(() => null));
    setNavTarget(null);
    setPhase('preview');
  }, [missionRegistry, automationId]);

  const stepViews: MissionStepView[] = useMemo(
    () => (plan && missionRegistry ? missionStepViews(plan, missionRegistry) : []),
    [plan, missionRegistry],
  );

  const completeFn = useMemo(() => {
    const provider = info?.provider;
    if (!provider || !info?.configured) return undefined;
    return (messages: AiMessage[], signal?: AbortSignal) =>
      provider.complete({ messages, temperature: 0.2, json: true }, signal).then((r) => r.content);
  }, [info]);

  const doPlan = useCallback(async () => {
    if (!missionRegistry || !goal.trim()) return;
    setPhase('planning');
    setPlan(null);
    setPlanNote(null);
    const result = await planMission(goal.trim(), missionRegistry, {
      tools: missionRegistry.all(),
      ...(completeFn ? { complete: completeFn } : {}),
    });
    if (!result.plan) {
      setPhase('idle');
      setPlanNote(
        result.reason === 'no-match-no-ai'
          ? 'No deterministic match, and no AI provider is configured to plan this. Configure a provider in Settings → AI, or rephrase as a known request (e.g. "Continue Orbit with the best agent").'
          : result.reason === 'ai-empty'
            ? 'The configured provider did not return a usable plan (the offline Mock cannot really plan — connect a real provider).'
            : 'Planning failed (provider error).',
      );
      return;
    }
    setPlan(result.plan);
    setStatuses(result.plan.steps.map(() => 'pending'));
    setOutcomes(result.plan.steps.map(() => null));
    setNavTarget(null);
    setPhase('preview');
  }, [missionRegistry, goal, completeFn]);

  const executorDeps: MissionExecutorDeps = useMemo(
    () => ({
      resolveApp: (q) => {
        const ranked = rankApps(q, apps.current);
        const top = ranked[0]?.item;
        return top ? { id: top.id, name: top.name, path: top.path } : null;
      },
      resolveProject: (q) => {
        const p = bestProject(q, projects.current);
        return p ? { name: p.name ?? p.path, path: p.path } : null;
      },
      resolveProjectFromIndex: async (q) => {
        const folders = (await native.fileSearch(q, { kind: 'dir' })).map((f) => ({
          path: f.path,
          name: f.name as string | null,
        }));
        const conf = folderConfidence.current;
        const res = resolveProjectMatch(q, folders, conf !== undefined ? { confidence: conf } : {});
        if (res.kind === 'match' || res.kind === 'uncertain') {
          return {
            kind: res.kind,
            project: { name: res.project.name ?? res.project.path, path: res.project.path },
          };
        }
        if (res.kind === 'choices') {
          return {
            kind: 'choices',
            projects: res.projects.map((p) => ({ name: p.name ?? p.path, path: p.path })),
          };
        }
        return { kind: 'none' };
      },
      chooseFolder: (_query, choices) =>
        new Promise<{ name: string; path: string } | null>((resolve) => {
          folderResolver.current = resolve;
          setFolderChoice({
            query: _query,
            choices: choices.map((c) => ({ name: c.name, path: c.path })),
          });
        }),
      launchApp: (path) => native.launchPath(path),
      openProjectInApplication: (applicationId, projectPath) =>
        native.openProjectInApplication(applicationId, projectPath),
      revealFolder: (path) => native.revealPath(path),
      fileSearch: async (q, limit) =>
        (await native.fileSearch(q, { limit })).map((f) => ({ name: f.name, parent: f.parent })),
      noteSearch: async (q, limit) => (await native.noteList(q, limit)).map((n) => ({ title: n.title })),
      dispatchAgent: (projectPath, pref) =>
        dispatchAgentViaRelay(
          {
            listAgents: native.relayListAgents,
            createLaunchPlan: native.relayCreateLaunchPlan,
            executeLaunch: native.relayExecuteLaunch,
          },
          projectPath,
          pref,
        ),
      restartRelay: async () => {
        await native.relayRestart();
      },
      runQuickAi: async (prompt, useClipboard) => {
        const provider = info?.provider;
        if (!provider) return '[No AI provider configured]';
        const contexts: QuickAiContext[] =
          useClipboard && clipboard.current.trim()
            ? [{ kind: 'clipboard', label: 'Clipboard', text: clipboard.current, remote: !(info?.local ?? true) }]
            : [];
        const r = await provider.complete({ messages: buildMessages(prompt, contexts), temperature: 0.3 });
        return r.content;
      },
    }),
    [info],
  );

  const setStatus = useCallback((i: number, status: MissionStepStatus) => {
    setStatuses((prev) => prev.map((s, idx) => (idx === i ? status : s)));
  }, []);
  const setOutcome = useCallback((i: number, outcome: MissionStepOutcome) => {
    setOutcomes((prev) => prev.map((o, idx) => (idx === i ? outcome : o)));
  }, []);

  const runMission = useCallback(async () => {
    if (!plan) return;
    stoppedRef.current = false;
    setPhase('running');
    let lastNav: { viewId: string; arg: string | null } | null = null;

    for (let i = 0; i < plan.steps.length; i++) {
      if (stoppedRef.current) {
        setStatus(i, 'skipped');
        continue;
      }
      const view = stepViews[i];
      if (view?.requiresConfirmation) {
        setStatus(i, 'awaiting-approval');
        setConfirmIdx(i);
        const approved = await new Promise<boolean>((resolve) => {
          confirmResolver.current = resolve;
        });
        setConfirmIdx(null);
        confirmResolver.current = null;
        if (!approved) {
          setStatus(i, 'skipped');
          setOutcome(i, { ok: false, summary: 'Skipped (not approved)' });
          continue;
        }
      }
      setStatus(i, 'running');
      try {
        const step = plan.steps[i]!;
        const outcome = await executeMissionStep(step, executorDeps);
        setOutcome(i, outcome);
        setStatus(i, outcome.ok ? 'done' : 'failed');
        if (outcome.navigateTo) {
          lastNav = { viewId: outcome.navigateTo.viewId, arg: outcome.navigateTo.arg ?? null };
        }
      } catch (e) {
        setOutcome(i, { ok: false, summary: e instanceof Error ? e.message : String(e) });
        setStatus(i, 'failed');
      }
    }
    setNavTarget(lastNav);
    setPhase('done');
  }, [plan, stepViews, executorDeps, setStatus, setOutcome]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    confirmResolver.current?.(false);
    folderResolver.current?.(null);
  }, []);

  const hasDispatch = stepViews.some((v) => v.toolId === 'native:dispatch_agent');
  const relayReady = relayState === 'ready';

  return (
    <div className="orbit-launcher orbit-agent" tabIndex={-1}>
      <div className="orbit-search">
        <button className="orbit-back" onClick={onPop} aria-label="Back">
          Back
        </button>
        <span className="orbit-breadcrumb">Orbit Agent</span>
        {info && (
          <span className={`quick-ai-badge ${info.local ? 'is-local' : 'is-remote'}`}>
            {info.label} · {info.local ? 'On-device' : 'Leaves device'}
          </span>
        )}
      </div>

      <div className="agent-note">
        Describe what you want done. Orbit builds a plan from its own safe tools, shows it, and asks
        before anything consequential. Known requests are planned without any AI.
      </div>

      <textarea
        ref={inputRef}
        className="agent-goal"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder='e.g. "Continue Orbit with the best coding agent" · "Find files about Leonard" · "Restart Relay"'
        rows={2}
        spellCheck={false}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            void doPlan();
          }
        }}
      />
      <div className="agent-actions">
        <button className="agent-plan-btn" disabled={!goal.trim() || phase === 'planning'} onClick={() => void doPlan()}>
          {phase === 'planning' ? 'Planning…' : 'Plan mission'}
        </button>
        {phase === 'preview' && (
          <button className="agent-run-btn" onClick={() => void runMission()}>
            Run mission
          </button>
        )}
        {phase === 'running' && (
          <button className="agent-stop-btn" onClick={stop}>
            Stop
          </button>
        )}
      </div>

      {planNote && <div className="agent-plan-note">{planNote}</div>}

      {plan && (
        <div className="agent-plan">
          <div className="agent-plan-head">
            <span className={`agent-source agent-source-${plan.source}`}>
              {plan.source === 'deterministic' ? 'Deterministic plan' : 'AI plan'}
            </span>
            {plan.summary && <span className="agent-summary">{plan.summary}</span>}
          </div>

          {hasDispatch && !relayReady && (
            <div className="agent-warn">
              Relay is {relayState}. Launching an agent needs Relay ready — that step may fail until it
              is.
            </div>
          )}

          <ol className="agent-steps">
            {stepViews.map((v, i) => (
              <li key={i} className={`agent-step is-${statuses[i] ?? 'pending'}`}>
                <div className="agent-step-head">
                  <span className="agent-step-icon">{statusIcon(statuses[i] ?? 'pending')}</span>
                  <span className="agent-step-title">{v.title}</span>
                  <span className={`tools-risk risk-${v.risk}`}>{v.risk}</span>
                  {v.requiresConfirmation && <span className="tools-gated">Confirm</span>}
                </div>
                {v.rationale && <div className="agent-step-why">{v.rationale}</div>}
                {dispatchHint(v.toolId, v.args, goal) && (
                  <div className="agent-step-hint">{dispatchHint(v.toolId, v.args, goal)}</div>
                )}
                {argSummary(v.args) && <div className="agent-step-args">{argSummary(v.args)}</div>}
                {outcomes[i] && (
                  <div className={`agent-step-out${outcomes[i]!.ok ? '' : ' is-fail'}`}>
                    {outcomes[i]!.summary}
                    {outcomes[i]!.detail && <pre className="agent-step-detail">{outcomes[i]!.detail}</pre>}
                  </div>
                )}
              </li>
            ))}
          </ol>

          <div className="agent-routing-note">
            Model routing preview (verified/council strategy) is owned by the AgentOS Model Gateway
            and shows here once the Gateway adapter is connected.
          </div>

          {phase === 'done' && navTarget && (
            <button className="agent-run-btn" onClick={() => onNavigate(navTarget.viewId, navTarget.arg)}>
              Open result
            </button>
          )}
        </div>
      )}

      {confirmIdx !== null && stepViews[confirmIdx] && (
        <ConfirmDialog
          prompt={{
            title: `Run step ${confirmIdx + 1}: ${stepViews[confirmIdx]!.title}?`,
            body: `This is a consequential action (${stepViews[confirmIdx]!.risk} risk). ${
              stepViews[confirmIdx]!.toolId === 'native:dispatch_agent'
                ? 'It launches a real agent session via Relay.'
                : 'It may be hard to undo.'
            }`,
            confirmLabel: 'Approve & run',
            cancelLabel: 'Skip',
          }}
          onConfirm={() => confirmResolver.current?.(true)}
          onCancel={() => confirmResolver.current?.(false)}
        />
      )}

      {folderChoice && (
        <FolderPickerDialog
          query={folderChoice.query}
          choices={folderChoice.choices}
          onChoose={(choice) => {
            setFolderChoice(null);
            folderResolver.current?.(choice);
            folderResolver.current = null;
          }}
          onCancel={() => {
            setFolderChoice(null);
            folderResolver.current?.(null);
            folderResolver.current = null;
          }}
        />
      )}
    </div>
  );
}

function statusIcon(status: MissionStepStatus): string {
  switch (status) {
    case 'done':
      return '✓';
    case 'failed':
      return '✕';
    case 'running':
      return '⟳';
    case 'awaiting-approval':
      return '⏸';
    case 'skipped':
      return '–';
    default:
      return '•';
  }
}

/**
 * For an agent-dispatch step with no explicit specialist preference, surface a
 * suggestion of which specialist suits the goal — clearly a hint; Relay/Hermes
 * make the final choice.
 */
function dispatchHint(
  toolId: string,
  args: Readonly<Record<string, unknown>>,
  goal: string,
): string | null {
  if (toolId !== 'native:dispatch_agent') return null;
  const pref = args['agentPreference'];
  if (typeof pref === 'string' && pref !== 'best') return null;
  const rec = recommendAgent(goal);
  return rec ? `Suggested: ${rec.agent.name} (${rec.reason}). Relay/Hermes make the final choice.` : null;
}

function argSummary(args: Readonly<Record<string, unknown>>): string {
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${String(v)}`);
  return parts.join(' · ');
}
