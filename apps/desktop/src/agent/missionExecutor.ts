/**
 * Execute one validated mission step against Orbit's real capabilities.
 *
 * Every branch maps a whitelisted tool id to an existing, audited action — app
 * launch, folder reveal, file/note search, Control Center navigation, a real
 * Relay agent dispatch, a Relay restart, or a Quick AI sub-task. There is no
 * generic "run command" branch and no path/argument comes from anywhere but the
 * step's already-validated args. All side-effecting calls are injected, so the
 * whole executor is unit-tested headless.
 */
import type { AgentPreference } from '@orbit/intent';
import type { MissionStep, MissionStepOutcome } from '@orbit/mission';
import { NATIVE_TOOL_IDS } from '@orbit/tool-registry';
import { encodeControlCenterArg } from '../controlCenterState.js';
import type { DispatchResult } from './agentDispatch.js';

export interface ResolvedEntity {
  readonly name: string;
  readonly path: string;
}

export interface MissionExecutorDeps {
  readonly resolveApp: (query: string) => ResolvedEntity | null;
  readonly resolveProject: (query: string) => ResolvedEntity | null;
  readonly launchApp: (path: string) => Promise<void>;
  readonly revealFolder: (path: string) => Promise<void>;
  readonly fileSearch: (
    query: string,
    limit: number,
  ) => Promise<ReadonlyArray<{ name: string; parent: string }>>;
  readonly noteSearch: (query: string, limit: number) => Promise<ReadonlyArray<{ title: string }>>;
  readonly dispatchAgent: (
    projectPath: string,
    pref: AgentPreference | undefined,
  ) => Promise<DispatchResult>;
  readonly restartRelay: () => Promise<void>;
  readonly runQuickAi: (prompt: string, useClipboard: boolean) => Promise<string>;
}

function str(args: Readonly<Record<string, unknown>>, key: string): string {
  return typeof args[key] === 'string' ? (args[key] as string) : '';
}

function fail(summary: string, detail?: string): MissionStepOutcome {
  return detail ? { ok: false, summary, detail } : { ok: false, summary };
}

export async function executeMissionStep(
  step: MissionStep,
  deps: MissionExecutorDeps,
): Promise<MissionStepOutcome> {
  const { toolId, args } = step;

  switch (toolId) {
    case NATIVE_TOOL_IDS.openApplication: {
      const app = deps.resolveApp(str(args, 'applicationQuery'));
      if (!app) return fail(`No installed app matching "${str(args, 'applicationQuery')}"`);
      await deps.launchApp(app.path);
      return { ok: true, summary: `Opened ${app.name}` };
    }

    case NATIVE_TOOL_IDS.openProjectFolder: {
      const project = deps.resolveProject(str(args, 'projectQuery'));
      if (!project) return fail(`No known project matching "${str(args, 'projectQuery')}"`);
      await deps.revealFolder(project.path);
      return { ok: true, summary: `Revealed ${project.name}`, detail: project.path };
    }

    case NATIVE_TOOL_IDS.openControlCenter: {
      const tab = str(args, 'controlCenterTab') || 'projects';
      const status = str(args, 'sessionStatus');
      const projectQuery = str(args, 'projectQuery');
      const project = projectQuery ? deps.resolveProject(projectQuery) : null;
      const arg = encodeControlCenterArg({
        tab: tab as Parameters<typeof encodeControlCenterArg>[0]['tab'],
        ...(project ? { project: project.path } : {}),
        ...(status ? { sessionStatus: status } : {}),
      });
      return {
        ok: true,
        summary: `Open Control Center → ${tab}${status ? ` (${status})` : ''}`,
        navigateTo: { viewId: 'control-center', arg },
      };
    }

    case NATIVE_TOOL_IDS.findFiles: {
      const q = str(args, 'fileQuery');
      const hits = await deps.fileSearch(q, 20);
      if (hits.length === 0) return { ok: true, summary: `No files match "${q}"` };
      const top = hits.slice(0, 5).map((f) => `• ${f.name} — ${f.parent}`).join('\n');
      return { ok: true, summary: `Found ${hits.length} file(s) for "${q}"`, detail: top };
    }

    case NATIVE_TOOL_IDS.findNotes: {
      const q = str(args, 'noteQuery');
      const hits = await deps.noteSearch(q, 15);
      if (hits.length === 0) return { ok: true, summary: `No notes match "${q}"` };
      const top = hits.slice(0, 5).map((n) => `• ${n.title || 'Untitled'}`).join('\n');
      return { ok: true, summary: `Found ${hits.length} note(s) for "${q}"`, detail: top };
    }

    case NATIVE_TOOL_IDS.dispatchAgent: {
      const project = deps.resolveProject(str(args, 'projectQuery'));
      if (!project) return fail(`No known project matching "${str(args, 'projectQuery')}"`);
      const prefRaw = str(args, 'agentPreference');
      const pref = prefRaw ? (prefRaw as AgentPreference) : undefined;
      const result = await deps.dispatchAgent(project.path, pref);
      const detail = result.warnings.length > 0 ? `Warnings:\n${result.warnings.join('\n')}` : result.detail;
      return detail ? { ok: result.ok, summary: result.summary, detail } : { ok: result.ok, summary: result.summary };
    }

    case NATIVE_TOOL_IDS.restartRelay: {
      await deps.restartRelay();
      return { ok: true, summary: 'Relay restarted' };
    }

    case NATIVE_TOOL_IDS.quickAi: {
      const prompt = str(args, 'prompt');
      if (!prompt) return fail('Quick AI step had no prompt');
      const useClipboard = args['useClipboard'] === true;
      const text = await deps.runQuickAi(prompt, useClipboard);
      return { ok: true, summary: 'Quick AI completed', detail: text };
    }

    default:
      return fail(`Unknown tool: ${toolId}`);
  }
}
