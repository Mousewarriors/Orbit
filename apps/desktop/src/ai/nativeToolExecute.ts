/**
 * Native tool execution for AI Chat / Quick AI.
 *
 * The tool loop hands us a `ToolRecord` the model chose plus its arguments; this
 * module turns the **native** ones into real, safe Orbit actions (open an
 * installed app, search files/notes). The model never supplies a path, argv or
 * command — only a query string — and Orbit resolves it through its own
 * application index, so this can't become arbitrary execution.
 *
 * Pure + injected: `resolveApplication` is a pure function (unit-tested for
 * exact/alias/ambiguous cases) and `executeNativeTool` takes its native calls as
 * `NativeToolDeps`, so the whole path is headless-testable. Crucially, opening an
 * app reports success **only after the native launch resolves** — a failure or a
 * no-match returns `ok: false`, so the model can't falsely claim it opened.
 */
import { NATIVE_TOOL_IDS, type ToolRecord } from '@orbit/tool-registry';
import { bestProject, resolveProjectMatch, type ProjectCandidate } from '@orbit/intent';
import type { NativeApp } from '../native.js';

/** Native tools AI Chat is allowed to call in this slice. */
export const CHAT_NATIVE_TOOL_IDS: readonly string[] = [
  NATIVE_TOOL_IDS.openApplication,
  NATIVE_TOOL_IDS.openProjectInApplication,
  NATIVE_TOOL_IDS.findFiles,
  NATIVE_TOOL_IDS.findNotes,
];

/** Common spoken names → the canonical installed-app name they refer to. */
const APP_ALIASES: Readonly<Record<string, string>> = {
  'vs code': 'visual studio code',
  vscode: 'visual studio code',
  code: 'visual studio code',
  terminal: 'windows terminal',
  explorer: 'file explorer',
  files: 'file explorer',
  cmd: 'command prompt',
};

export type AppResolution =
  | { readonly kind: 'match'; readonly app: NativeApp }
  | { readonly kind: 'choices'; readonly apps: readonly NativeApp[] }
  | { readonly kind: 'none' };

/**
 * Resolve a free-text app query to a single installed app, a short choice list,
 * or nothing — preferring exact name, then alias, then prefix, then substring.
 */
export function resolveApplication(query: string, apps: readonly NativeApp[]): AppResolution {
  const q = query.trim().toLowerCase();
  if (!q) return { kind: 'none' };
  const target = APP_ALIASES[q] ?? q;

  const exact = apps.filter((a) => a.name.toLowerCase() === target);
  if (exact.length === 1) return { kind: 'match', app: exact[0]! };
  if (exact.length > 1) return { kind: 'choices', apps: exact.slice(0, 5) };

  const prefix = apps.filter((a) => a.name.toLowerCase().startsWith(target));
  if (prefix.length === 1) return { kind: 'match', app: prefix[0]! };

  const pool = prefix.length > 0 ? prefix : apps.filter((a) => a.name.toLowerCase().includes(target));
  if (pool.length === 1) return { kind: 'match', app: pool[0]! };
  if (pool.length > 1) return { kind: 'choices', apps: pool.slice(0, 5) };
  return { kind: 'none' };
}

export interface NativeToolDeps {
  listApplications(): Promise<readonly NativeApp[]>;
  listProjects(): Promise<readonly ProjectCandidate[]>;
  launchPath(path: string): Promise<void>;
  openProjectInApplication(applicationId: string, projectPath: string): Promise<void>;
  recordUsage(commandId: string): Promise<void>;
  fileSearch(query: string): Promise<ReadonlyArray<{ name: string; path: string }>>;
  /** Search the file index restricted to directories (folders), for project fallback. */
  findFolders(query: string): Promise<ReadonlyArray<{ name: string; path: string }>>;
  noteList(query: string): Promise<ReadonlyArray<{ title: string }>>;
}

/**
 * Resolve a project name against the indexed file system when it isn't in the
 * curated project catalog: search indexed folders, then rank them by the same
 * name/path scoring the catalog uses, so "Personal Research Assistant" resolves
 * to `C:\Personal Research Assistant` once the drive is indexed. Returns a
 * disambiguation result so an ambiguous query (several folders of the same name)
 * can be bounced back to the user rather than silently guessing.
 */
async function resolveFolderProject(
  query: string,
  deps: NativeToolDeps,
): Promise<ReturnType<typeof resolveProjectMatch>> {
  const folders = await deps.findFolders(query).catch(() => []);
  return resolveProjectMatch(
    query,
    folders.map((f) => ({ path: f.path, name: f.name })),
  );
}

export interface NativeToolOutcome {
  readonly ok: boolean;
  readonly content: string;
}

/** Execute a native ToolRecord. Returns a result string fed back to the model. */
export async function executeNativeTool(
  record: ToolRecord,
  args: Readonly<Record<string, unknown>>,
  deps: NativeToolDeps,
): Promise<NativeToolOutcome> {
  switch (record.id) {
    case NATIVE_TOOL_IDS.openApplication: {
      const query = String(args['applicationQuery'] ?? '').trim();
      if (!query) return { ok: false, content: 'No application name was provided.' };
      const apps = await deps.listApplications();
      const res = resolveApplication(query, apps);
      if (res.kind === 'none') {
        return { ok: false, content: `No installed application matches "${query}".` };
      }
      if (res.kind === 'choices') {
        const names = res.apps.map((a) => a.name).join(', ');
        return {
          ok: false,
          content: `Multiple applications match "${query}": ${names}. Ask the user which one they mean.`,
        };
      }
      try {
        await deps.launchPath(res.app.path);
      } catch (e) {
        return {
          ok: false,
          content: `Failed to open ${res.app.name}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      // Usage is recorded only after a successful launch.
      await deps.recordUsage(res.app.id).catch(() => {});
      return { ok: true, content: `Opened ${res.app.name}.` };
    }

    case NATIVE_TOOL_IDS.openProjectInApplication: {
      const applicationQuery = String(args['applicationQuery'] ?? '').trim();
      const projectQuery = String(args['projectQuery'] ?? '').trim();
      if (!applicationQuery || !projectQuery) {
        return { ok: false, content: 'An application and project name are required.' };
      }
      const [apps, projects] = await Promise.all([
        deps.listApplications(),
        deps.listProjects(),
      ]);
      const app = resolveApplication(applicationQuery, apps);
      if (app.kind === 'none') {
        return {
          ok: false,
          content: `No installed application matches "${applicationQuery}".`,
        };
      }
      if (app.kind === 'choices') {
        return {
          ok: false,
          content: `Multiple applications match "${applicationQuery}": ${app.apps
            .map((candidate) => candidate.name)
            .join(', ')}. Ask the user which one they mean.`,
        };
      }
      let project: ProjectCandidate | null = bestProject(projectQuery, projects);
      if (!project) {
        const folder = await resolveFolderProject(projectQuery, deps);
        if (folder.kind === 'choices') {
          return {
            ok: false,
            content: `Multiple indexed folders match "${projectQuery}":\n${folder.projects
              .map((p) => p.path)
              .join('\n')}\nAsk the user which one they mean, then call this tool again with that exact folder name.`,
          };
        }
        if (folder.kind === 'match') project = folder.project;
      }
      if (!project) {
        return {
          ok: false,
          content: `No known project or indexed folder matches "${projectQuery}". If the folder exists, make sure its drive is indexed (Settings → File index).`,
        };
      }
      try {
        await deps.openProjectInApplication(app.app.id, project.path);
      } catch (e) {
        return {
          ok: false,
          content: `Failed to open ${project.name ?? project.path} in ${app.app.name}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        };
      }
      await deps.recordUsage(app.app.id).catch(() => {});
      return {
        ok: true,
        content: `Opened ${project.name ?? project.path} in ${app.app.name}.`,
      };
    }

    case NATIVE_TOOL_IDS.findFiles: {
      const query = String(args['fileQuery'] ?? '').trim();
      if (!query) return { ok: false, content: 'No search query was provided.' };
      const results = await deps.fileSearch(query);
      if (results.length === 0) return { ok: true, content: `No files found for "${query}".` };
      return {
        ok: true,
        content: results
          .slice(0, 10)
          .map((r) => `${r.name} — ${r.path}`)
          .join('\n'),
      };
    }

    case NATIVE_TOOL_IDS.findNotes: {
      const query = String(args['noteQuery'] ?? '').trim();
      const results = await deps.noteList(query);
      if (results.length === 0) return { ok: true, content: `No notes found for "${query}".` };
      return { ok: true, content: results.slice(0, 10).map((r) => `• ${r.title}`).join('\n') };
    }

    default:
      return {
        ok: false,
        content: `The native tool "${record.id}" isn't available in chat yet.`,
      };
  }
}
