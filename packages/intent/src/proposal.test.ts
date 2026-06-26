import { describe, expect, it } from 'vitest';
import { recogniseIntent } from './recognise.js';
import { proposeIntent } from './proposal.js';
import { isAiIntent } from './types.js';

/** Recognise then propose, asserting recognition succeeded. */
function plan(query: string) {
  const r = recogniseIntent(query);
  expect(r, query).not.toBeNull();
  return proposeIntent(r!);
}

describe('proposeIntent — control-center navigation', () => {
  it('show sessions → sessions tab, no project needed', () => {
    const p = plan('show active sessions');
    expect(p.plan).toEqual({
      kind: 'control-center',
      target: { tab: 'sessions', selectProject: false },
      needsProject: false,
    });
  });

  it('failed sessions → sessions tab with a status filter', () => {
    const p = plan('show failed sessions');
    expect(p.plan.kind).toBe('control-center');
    if (p.plan.kind === 'control-center') {
      expect(p.plan.target.tab).toBe('sessions');
      expect(p.plan.target.sessionStatus).toBe('failed');
    }
  });

  it('continue project → launch tab, selects project, needs a project', () => {
    const p = plan('continue Orbit');
    expect(p.plan).toEqual({
      kind: 'control-center',
      target: { tab: 'launch', selectProject: true },
      needsProject: true,
    });
    expect(p.requiresConfirmation).toBe(true);
    expect(p.display.title).toBe('Continue orbit');
  });

  it('open project → projects tab, selects project', () => {
    const p = plan('open the Orbit project');
    expect(p.plan.kind).toBe('control-center');
    if (p.plan.kind === 'control-center') {
      expect(p.plan.target.tab).toBe('projects');
      expect(p.plan.target.selectProject).toBe(true);
      expect(p.plan.needsProject).toBe(true);
    }
  });

  it('approvals / activity / handoffs map to their tabs', () => {
    expect((plan('show approvals').plan as { target: { tab: string } }).target.tab).toBe(
      'approvals',
    );
    expect((plan('show recent activity').plan as { target: { tab: string } }).target.tab).toBe(
      'activity',
    );
    expect((plan('show handoffs').plan as { target: { tab: string } }).target.tab).toBe('handoffs');
  });
});

describe('proposeIntent — direct actions', () => {
  it('restart relay → run-builtin', () => {
    const p = plan('restart relay');
    expect(p.plan).toEqual({ kind: 'run-builtin', action: 'restart-relay' });
    expect(p.requiresConfirmation).toBe(true);
  });

  it('open application → open-application plan', () => {
    expect(plan('open Calculator').plan).toEqual({ kind: 'open-application' });
  });

  it('open project folder → open-project-folder plan', () => {
    expect(plan('open the Orbit folder').plan).toEqual({ kind: 'open-project-folder' });
  });

  it('open file in application maps to the file/application action plan', () => {
    const p = plan('load up the convention attendant positions map in paint');
    expect(p.plan).toEqual({ kind: 'open-file-in-application' });
    expect(p.display.title).toContain('convention attendant positions map');
    expect(p.display.title).toContain('paint');
  });

  it('find file / notes → search plans with the term in the title', () => {
    const f = plan('find the document that mentioned Leonard');
    expect(f.plan).toEqual({ kind: 'find-files' });
    expect(f.display.title.toLowerCase()).toContain('leonard');

    const n = plan('find notes about onboarding');
    expect(n.plan).toEqual({ kind: 'find-notes' });
    expect(n.display.title.toLowerCase()).toContain('onboarding');
  });
});

describe('proposeIntent — AI intents are honest', () => {
  it('explain/summarise/ask map to unsupported-ai with a helpful subtitle', () => {
    for (const q of ['explain this error', 'summarise the clipboard', 'ask ai what is a monad']) {
      const p = plan(q);
      expect(p.plan).toEqual({ kind: 'unsupported-ai' });
      expect(p.display.subtitle).toMatch(/not available yet/i);
    }
  });

  it('isAiIntent flags the AI intents', () => {
    expect(isAiIntent('ask_quick_ai')).toBe(true);
    expect(isAiIntent('open_application')).toBe(false);
  });
});
