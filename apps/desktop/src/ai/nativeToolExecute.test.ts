import { describe, expect, it, vi } from 'vitest';
import { NATIVE_TOOL_IDS, nativeToolRecords, type ToolRecord } from '@orbit/tool-registry';
import { executeNativeTool, resolveApplication, type NativeToolDeps } from './nativeToolExecute.js';
import type { NativeApp } from '../native.js';

const APPS: NativeApp[] = [
  { id: 'vscode', name: 'Visual Studio Code', path: 'C:/vscode.exe', kind: 'app' },
  { id: 'calc', name: 'Calculator', path: 'calc.exe', kind: 'app' },
  { id: 'notepad', name: 'Notepad', path: 'notepad.exe', kind: 'app' },
  { id: 'vs', name: 'Visual Studio', path: 'C:/vs.exe', kind: 'app' },
];
const PROJECTS = [{ path: 'C:/projects/orbit', name: 'Orbit' }];

const rec = (id: string): ToolRecord => nativeToolRecords().find((t) => t.id === id)!;

function deps(over: Partial<NativeToolDeps> = {}): NativeToolDeps {
  return {
    listApplications: async () => APPS,
    listProjects: async () => PROJECTS,
    launchPath: async () => {},
    openProjectInApplication: async () => {},
    openFileInApplication: async () => {},
    recordUsage: async () => {},
    fileSearch: async () => [],
    findFolders: async () => [],
    noteList: async () => [],
    ...over,
  };
}

describe('executeNativeTool · open_file_in_application', () => {
  it('resolves the app and indexed file, then opens the file in that app', async () => {
    const openFileInApplication = vi.fn(async () => {});
    const recordUsage = vi.fn(async () => {});
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openFileInApplication),
      { applicationQuery: 'notepad', fileQuery: 'congregation accounts instructions kht' },
      deps({
        openFileInApplication,
        recordUsage,
        fileSearch: async () => [
          {
            name: 'KHT Congregation Accounts Instructions.pdf',
            path: 'C:/docs/KHT Congregation Accounts Instructions.pdf',
            kind: 'file',
          },
        ],
      }),
    );
    expect(out.ok).toBe(true);
    expect(openFileInApplication).toHaveBeenCalledWith(
      'notepad',
      'C:/docs/KHT Congregation Accounts Instructions.pdf',
    );
    expect(recordUsage).toHaveBeenCalledWith('notepad');
    expect(out.content).toContain('Opened KHT Congregation Accounts Instructions.pdf in Notepad');
  });

  it('does not claim success when opening the file fails', async () => {
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openFileInApplication),
      { applicationQuery: 'notepad', fileQuery: 'map' },
      deps({
        openFileInApplication: async () => {
          throw new Error('launch failed');
        },
        fileSearch: async () => [{ name: 'map.png', path: 'C:/docs/map.png', kind: 'file' }],
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toContain('launch failed');
  });

  it('asks for a narrower query when several indexed files match', async () => {
    const openFileInApplication = vi.fn(async () => {});
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openFileInApplication),
      { applicationQuery: 'notepad', fileQuery: 'accounts instructions' },
      deps({
        openFileInApplication,
        fileSearch: async () => [
          { name: 'KHT Accounts Instructions.pdf', path: 'C:/docs/kht.pdf', kind: 'file' },
          { name: 'ABC Accounts Instructions.pdf', path: 'C:/docs/abc.pdf', kind: 'file' },
        ],
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/Multiple indexed files match/);
    expect(out.content).toContain('C:/docs/kht.pdf');
    expect(openFileInApplication).not.toHaveBeenCalled();
  });
});

describe('resolveApplication', () => {
  it('matches an exact name (case-insensitive)', () => {
    expect(resolveApplication('calculator', APPS)).toEqual({ kind: 'match', app: APPS[1] });
  });
  it('resolves common aliases', () => {
    expect(resolveApplication('vs code', APPS)).toEqual({ kind: 'match', app: APPS[0] });
    expect(resolveApplication('VSCode', APPS)).toEqual({ kind: 'match', app: APPS[0] });
  });
  it('returns choices when ambiguous', () => {
    const r = resolveApplication('visual', APPS);
    expect(r.kind).toBe('choices');
    if (r.kind === 'choices') expect(r.apps.map((a) => a.id).sort()).toEqual(['vs', 'vscode']);
  });
  it('returns none when nothing matches', () => {
    expect(resolveApplication('photoshop', APPS).kind).toBe('none');
    expect(resolveApplication('   ', APPS).kind).toBe('none');
  });
});

describe('executeNativeTool · open_project_in_application', () => {
  it('resolves both entities and reports success only after native success', async () => {
    const openProjectInApplication = vi.fn(async () => {});
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openProjectInApplication),
      { applicationQuery: 'vs code', projectQuery: 'orbit' },
      deps({ openProjectInApplication }),
    );
    expect(out.ok).toBe(true);
    expect(openProjectInApplication).toHaveBeenCalledWith('vscode', 'C:/projects/orbit');
    expect(out.content).toContain('Opened Orbit in Visual Studio Code');
  });

  it('falls back to an indexed folder when no catalogued project matches', async () => {
    const openProjectInApplication = vi.fn(async () => {});
    const findFolders = vi.fn(async () => [
      { name: 'Personal Research Assistant', path: 'C:/Personal Research Assistant' },
      { name: 'Old Research', path: 'C:/Old Research' },
    ]);
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openProjectInApplication),
      { applicationQuery: 'vs code', projectQuery: 'Personal Research Assistant' },
      deps({ openProjectInApplication, findFolders }),
    );
    expect(out.ok).toBe(true);
    expect(findFolders).toHaveBeenCalledWith('Personal Research Assistant');
    expect(openProjectInApplication).toHaveBeenCalledWith(
      'vscode',
      'C:/Personal Research Assistant',
    );
  });

  it('asks the user to disambiguate when several indexed folders match equally', async () => {
    const openProjectInApplication = vi.fn(async () => {});
    const findFolders = vi.fn(async () => [
      { name: 'Research', path: 'C:/Work/Research' },
      { name: 'Research', path: 'D:/Archive/Research' },
    ]);
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openProjectInApplication),
      { applicationQuery: 'vs code', projectQuery: 'Research' },
      deps({ openProjectInApplication, findFolders }),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/Multiple indexed folders match/);
    expect(out.content).toContain('C:/Work/Research');
    expect(out.content).toContain('D:/Archive/Research');
    expect(openProjectInApplication).not.toHaveBeenCalled();
  });

  it('asks for confirmation on a low-confidence folder match (confidence gate)', async () => {
    const openProjectInApplication = vi.fn(async () => {});
    const findFolders = vi.fn(async () => [{ name: 'Research Notes', path: 'C:/Research Notes' }]);
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openProjectInApplication),
      { applicationQuery: 'vs code', projectQuery: 'research' },
      // A strict gate makes the strong-but-inexact match uncertain.
      deps({ openProjectInApplication, findFolders, folderConfidence: 0.99 }),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/Not confident/);
    expect(out.content).toContain('Research Notes');
    expect(openProjectInApplication).not.toHaveBeenCalled();
  });

  it('opens a low-confidence match when the gate is lowered', async () => {
    const openProjectInApplication = vi.fn(async () => {});
    const findFolders = vi.fn(async () => [{ name: 'Research Notes', path: 'C:/Research Notes' }]);
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openProjectInApplication),
      { applicationQuery: 'vs code', projectQuery: 'research' },
      deps({ openProjectInApplication, findFolders, folderConfidence: 0 }),
    );
    expect(out.ok).toBe(true);
    expect(openProjectInApplication).toHaveBeenCalledWith('vscode', 'C:/Research Notes');
  });

  it('reports clearly when neither a project nor an indexed folder matches', async () => {
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openProjectInApplication),
      { applicationQuery: 'vs code', projectQuery: 'nonexistent thing' },
      deps(),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/No known project or indexed folder matches/);
  });

  it('does not claim success when the native launch fails', async () => {
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openProjectInApplication),
      { applicationQuery: 'vs code', projectQuery: 'orbit' },
      deps({
        openProjectInApplication: async () => {
          throw new Error('launch failed');
        },
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toContain('launch failed');
  });
});

describe('executeNativeTool · open_application', () => {
  it('launches the resolved app and records usage AFTER success', async () => {
    const launchPath = vi.fn(async () => {});
    const recordUsage = vi.fn(async () => {});
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openApplication),
      { applicationQuery: 'vs code' },
      deps({ launchPath, recordUsage }),
    );
    expect(out.ok).toBe(true);
    expect(out.content).toMatch(/Opened Visual Studio Code/);
    expect(launchPath).toHaveBeenCalledWith('C:/vscode.exe');
    expect(recordUsage).toHaveBeenCalledWith('vscode');
  });

  it('reports failure and does NOT record usage when launch throws (no false success)', async () => {
    const recordUsage = vi.fn(async () => {});
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openApplication),
      { applicationQuery: 'calculator' },
      deps({
        launchPath: async () => {
          throw new Error('ShellExecute failed');
        },
        recordUsage,
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/Failed to open Calculator/);
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('asks the user to disambiguate when several apps match', async () => {
    const launchPath = vi.fn(async () => {});
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openApplication),
      { applicationQuery: 'visual' },
      deps({ launchPath }),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/Multiple applications match/);
    expect(launchPath).not.toHaveBeenCalled();
  });

  it('reports no match', async () => {
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.openApplication),
      { applicationQuery: 'photoshop' },
      deps(),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/No installed application matches/);
  });
});

describe('executeNativeTool · search', () => {
  it('formats file results', async () => {
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.findFiles),
      { fileQuery: 'leonard' },
      deps({ fileSearch: async () => [{ name: 'leonard.md', path: 'C:/notes/leonard.md' }] }),
    );
    expect(out.ok).toBe(true);
    expect(out.content).toContain('leonard.md — C:/notes/leonard.md');
  });

  it('reports an empty file search clearly', async () => {
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.findFiles),
      { fileQuery: 'zzz' },
      deps(),
    );
    expect(out.ok).toBe(true);
    expect(out.content).toMatch(/No files found/);
  });

  it('formats note results', async () => {
    const out = await executeNativeTool(
      rec(NATIVE_TOOL_IDS.findNotes),
      { noteQuery: 'ideas' },
      deps({ noteList: async () => [{ title: 'Ideas' }, { title: 'More ideas' }] }),
    );
    expect(out.content).toContain('• Ideas');
  });
});
