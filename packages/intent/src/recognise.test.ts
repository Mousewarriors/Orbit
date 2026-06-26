import { describe, expect, it } from 'vitest';
import { normalizeQuery, recogniseIntent } from './recognise.js';
import type { IntentName } from './types.js';

/** Assert a query recognises to a given intent and return the result. */
function expectIntent(query: string, intent: IntentName) {
  const r = recogniseIntent(query);
  expect(r, `"${query}" should recognise as ${intent}`).not.toBeNull();
  expect(r!.intent, `"${query}"`).toBe(intent);
  return r!;
}

describe('normalizeQuery', () => {
  it('lowercases, collapses whitespace and strips edge punctuation', () => {
    expect(normalizeQuery('  Open   Calculator!! ')).toBe('open calculator');
    expect(normalizeQuery('Show me the sessions?')).toBe('show me the sessions');
  });
});

describe('recogniseIntent — returns null for non-requests', () => {
  it.each(['', 'a', 'ca', 'Calculator', 'Orbit', '125 * 4', '#ff0000', 'uuid'])(
    'leaves %j to the exact-match providers',
    (q) => {
      expect(recogniseIntent(q)).toBeNull();
    },
  );
});

describe('recogniseIntent — relay & sessions', () => {
  it('restart relay', () => {
    const r = expectIntent('Restart Relay', 'restart_relay');
    expect(r.requiresConfirmation).toBe(true);
    expectIntent('please reconnect the relay', 'restart_relay');
  });

  it('scan projects', () => {
    expectIntent('Scan projects', 'scan_projects');
    expectIntent('scan for new projects', 'scan_projects');
    expectIntent('rescan my projects', 'scan_projects');
  });

  it('show active sessions', () => {
    expectIntent('Show active sessions', 'show_active_sessions');
    expectIntent('show sessions', 'show_active_sessions');
    expectIntent("what's running", 'show_active_sessions');
    expectIntent('Show what Hermes is working on', 'show_active_sessions');
  });

  it('show failed sessions', () => {
    expectIntent('Show failed sessions', 'show_failed_sessions');
    expectIntent('show me failed agent sessions', 'show_failed_sessions');
    expectIntent('which agents crashed', 'show_failed_sessions');
  });

  it('failed takes priority over generic sessions', () => {
    expect(recogniseIntent('show failed sessions')!.intent).toBe('show_failed_sessions');
  });

  it('show recent activity', () => {
    expectIntent('Show recent activity', 'show_recent_activity');
    expectIntent('what happened recently', 'show_recent_activity');
  });

  it('show approvals', () => {
    expectIntent('Show approvals', 'show_approvals');
    expectIntent('anything waiting for my approval', 'show_approvals');
    expectIntent('show what needs my sign-off', 'show_approvals');
  });
});

describe('recogniseIntent — handoffs', () => {
  it('show handoffs', () => {
    expectIntent('Show handoffs', 'show_handoffs');
    expectIntent('open the latest handoff', 'show_handoffs');
    expect(recogniseIntent('open the latest handoff')!.slots.includeLatestHandoff).toBe(true);
  });

  it('validate handoff beats show handoffs', () => {
    expectIntent('Validate handoff', 'validate_handoff');
    expectIntent('validate the latest handoff', 'validate_handoff');
  });
});

describe('recogniseIntent — projects', () => {
  it('open project', () => {
    const r = expectIntent('Open the Orbit project', 'open_project');
    expect(r.slots.projectQuery).toBe('orbit');
    expectIntent('open project orbit', 'open_project');
  });

  it('open project folder', () => {
    const r = expectIntent('Open the Orbit folder', 'open_project_folder');
    expect(r.slots.projectQuery).toBe('orbit');
    expectIntent('open the folder for Orbit', 'open_project_folder');
  });

  it('open project in an application', () => {
    const r = expectIntent(
      'Open the Orbit project in Visual Studio Code',
      'open_project_in_application',
    );
    expect(r.slots.projectQuery).toBe('orbit');
    expect(r.slots.applicationQuery).toBe('visual studio code');
  });

  it('open file in an application', () => {
    const r = expectIntent(
      'Load up the convention attendant positions map in Paint',
      'open_file_in_application',
    );
    expect(r.slots.fileQuery).toBe('convention attendant positions map');
    expect(r.slots.applicationQuery).toBe('paint');
  });

  it('open latest project', () => {
    expectIntent('Open the latest project', 'open_latest_project');
    expectIntent('open my most recent project', 'open_latest_project');
  });

  it('continue project + agent + handoff slots', () => {
    const r = expectIntent('Continue Orbit with the best coding agent', 'continue_project');
    expect(r.slots.projectQuery).toBe('orbit');
    expect(r.slots.agentPreference).toBe('best');
    expect(r.requiresConfirmation).toBe(true);

    const r2 = expectIntent('resume work on the website', 'continue_project');
    expect(r2.slots.projectQuery).toBe('website');

    const r3 = expectIntent('pick up Orbit and the latest handoff', 'continue_project');
    expect(r3.slots.projectQuery).toBe('orbit');
    expect(r3.slots.includeLatestHandoff).toBe(true);
  });

  it('bare "continue" is ambiguous and not claimed', () => {
    expect(recogniseIntent('continue')).toBeNull();
  });

  it('does not mistake generic agent status wording for launch', () => {
    expect(recogniseIntent('get agent status for Orbit')?.intent).not.toBe(
      'launch_agent_on_project',
    );
  });

  it('launch agent on project', () => {
    const r = expectIntent('Launch Codex on Orbit', 'launch_agent_on_project');
    expect(r.slots.agentPreference).toBe('codex');
    expect(r.slots.projectQuery).toBe('orbit');
    expect(r.requiresConfirmation).toBe(true);

    const generic = expectIntent('Launch an agent on Orbit', 'launch_agent_on_project');
    expect(generic.slots.agentPreference).toBe('best');
    expect(generic.slots.projectQuery).toBe('orbit');

    const r2 = expectIntent('run Claude on the website project', 'launch_agent_on_project');
    expect(r2.slots.agentPreference).toBe('claude');
    expect(r2.slots.projectQuery).toBe('website');
  });
});

describe('recogniseIntent — applications', () => {
  it('open application', () => {
    const r = expectIntent('Open Calculator', 'open_application');
    expect(r.slots.applicationQuery).toBe('calculator');
    expectIntent('launch Spotify', 'open_application');
    expect(recogniseIntent('open the Notepad app')!.slots.applicationQuery).toBe('notepad');
  });

  it('"open the Orbit project" is NOT an application', () => {
    expect(recogniseIntent('open the Orbit project')!.intent).toBe('open_project');
  });
});

describe('recogniseIntent — find', () => {
  it('find file extracts the search term', () => {
    const r = expectIntent('Find the document that mentioned Leonard', 'find_file');
    expect(r.slots.fileQuery).toBe('leonard');
    expectIntent('find file report.pdf', 'find_file');
  });

  it('finds remembered file descriptions without requiring the word file', () => {
    const r = expectIntent('find the congregation accounts instructions for KHT', 'find_file');
    expect(r.slots.fileQuery).toBe('congregation accounts instructions kht');
  });

  it('find notes extracts the topic', () => {
    const r = expectIntent('Find notes about onboarding', 'find_notes');
    expect(r.slots.noteQuery).toBe('onboarding');
    expectIntent('search my notes for Leonard', 'find_notes');
  });
});

describe('recogniseIntent — AI intents (recognised, handled honestly later)', () => {
  it('explain selected error', () => {
    expectIntent('Explain this error', 'explain_error');
    expectIntent('Ask Codex to investigate this error', 'explain_error');
  });

  it('explain / summarise selection & clipboard', () => {
    expectIntent('Explain the selected text', 'explain_selection');
    expectIntent('Summarise the selected text', 'summarise_selection');
    expectIntent('Summarise the clipboard', 'summarise_clipboard');
  });

  it('ask quick ai', () => {
    const r = expectIntent('ask ai what is a monad', 'ask_quick_ai');
    expect(r.slots.question).toBe('what is a monad');
  });
});
