import { describe, expect, it } from 'vitest';
import {
  basename,
  bestProject,
  projectDisplayName,
  rankApps,
  rankProjects,
  resolveProjectMatch,
  type AppCandidate,
  type ProjectCandidate,
} from './resolve.js';

const projects: ProjectCandidate[] = [
  { path: 'C:\\Users\\Simon Wood\\Raycast Clone', name: 'Orbit' },
  { path: 'C:\\code\\website', name: null },
  { path: '/home/me/orbit-docs', name: 'Orbit Docs' },
];

describe('basename / projectDisplayName', () => {
  it('takes the leaf folder across separators', () => {
    expect(basename('C:\\code\\website')).toBe('website');
    expect(basename('/home/me/orbit-docs')).toBe('orbit-docs');
  });

  it('falls back to the folder name when no explicit name', () => {
    expect(projectDisplayName({ path: 'C:\\code\\website', name: null })).toBe('website');
    expect(projectDisplayName({ path: 'C:\\code\\website', name: 'Site' })).toBe('Site');
  });
});

describe('rankProjects', () => {
  it('matches on explicit name', () => {
    expect(bestProject('orbit', projects)?.name).toBe('Orbit');
  });

  it('matches on folder name when there is no explicit name', () => {
    expect(bestProject('website', projects)?.path).toBe('C:\\code\\website');
  });

  it('returns nothing when no project matches', () => {
    expect(bestProject('nonexistent-xyz', projects)).toBeNull();
  });

  it('an empty query returns candidates unchanged (for "latest project")', () => {
    const ranked = rankProjects(undefined, projects);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.item).toBe(projects[0]);
  });

  it('prefers the closer of two similar names', () => {
    const best = bestProject('orbit docs', projects);
    expect(best?.name).toBe('Orbit Docs');
  });

  it('prefers a canonical monorepo over a similarly named package', () => {
    const candidates = [
      { path: 'C:\\code\\orbit\\crates\\orbit-core', name: 'orbit-core' },
      { path: 'C:\\Users\\me\\Raycast Clone', name: 'orbit-monorepo' },
    ];
    expect(bestProject('orbit', candidates)?.path).toBe('C:\\Users\\me\\Raycast Clone');
  });
});

describe('resolveProjectMatch', () => {
  it('returns a confident single match', () => {
    const res = resolveProjectMatch('Personal Research Assistant', [
      { path: 'C:\\Personal Research Assistant', name: 'Personal Research Assistant' },
      { path: 'C:\\Old Notes', name: 'Old Notes' },
    ]);
    expect(res.kind).toBe('match');
    if (res.kind === 'match') expect(res.project.path).toBe('C:\\Personal Research Assistant');
  });

  it('returns choices when several candidates score near-equally', () => {
    const res = resolveProjectMatch('research', [
      { path: 'C:\\Work\\research', name: 'research' },
      { path: 'D:\\Archive\\research', name: 'research' },
    ]);
    expect(res.kind).toBe('choices');
    if (res.kind === 'choices') {
      expect(res.projects.map((p) => p.path).sort()).toEqual([
        'C:\\Work\\research',
        'D:\\Archive\\research',
      ]);
    }
  });

  it('returns none when nothing scores', () => {
    expect(resolveProjectMatch('zzz-nope', [{ path: 'C:\\foo', name: 'foo' }]).kind).toBe('none');
  });
});

describe('rankApps', () => {
  const apps: AppCandidate[] = [
    { id: 'calc', name: 'Calculator', path: 'calc.exe' },
    { id: 'cal', name: 'Calendar', path: 'cal.exe' },
    { id: 'chrome', name: 'Google Chrome', path: 'chrome.exe' },
  ];

  it('ranks the best name match first', () => {
    expect(rankApps('calculator', apps)[0]!.item.id).toBe('calc');
    expect(rankApps('chrome', apps)[0]!.item.id).toBe('chrome');
  });

  it('returns nothing for an empty query', () => {
    expect(rankApps('', apps)).toHaveLength(0);
  });
});
