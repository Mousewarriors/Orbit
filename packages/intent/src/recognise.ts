/**
 * Deterministic natural-language intent recognition.
 *
 * An ordered list of rules is tried against the normalised query; the first to
 * match wins. Rules are intentionally conservative — they require recognisable
 * verbs/phrases so a bare entity name ("Calculator", "Orbit") falls through to
 * the exact-match providers rather than being re-interpreted here. When nothing
 * matches we return null and Root Search behaves exactly as before.
 */
import type { AgentPreference, IntentName, IntentSlots, RecognisedIntent } from './types.js';

/** Lowercase, collapse whitespace, and strip surrounding punctuation. */
export function normalizeQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s,.;:!?'"]+/, '')
    .replace(/[\s,.;:!?]+$/, '');
}

/** Strip a leading politeness/wake prefix ("please", "can you", "hey orbit"). */
function stripPolite(text: string): string {
  let t = text;
  let changed = true;
  const prefixes = [
    /^(hey|ok|okay|yo)\s+orbit\b[,:]?\s*/,
    /^orbit[,:]\s*/,
    /^(please|pls)\s+/,
    /^(can|could|would|will)\s+you\s+(please\s+)?/,
    /^(i\s+(want|need|would like)\s+(to|you to)\s+)/,
    /^(let'?s|lets)\s+/,
  ];
  while (changed) {
    changed = false;
    for (const re of prefixes) {
      const next = t.replace(re, '');
      if (next !== t) {
        t = next;
        changed = true;
      }
    }
  }
  return t.trim();
}

/** Detect a named/abstract agent preference anywhere in the text. */
function detectAgent(text: string): AgentPreference | undefined {
  if (/\bthe\s+best\b/.test(text) || /\bbest\s+(coding\s+)?agent\b/.test(text)) return 'best';
  if (/\bclaude(\s+code)?\b/.test(text)) return 'claude';
  if (/\bcodex\b/.test(text)) return 'codex';
  if (/\bantigravity\b/.test(text)) return 'antigravity';
  if (/\bopenclaw\b/.test(text)) return 'openclaw';
  return undefined;
}

/**
 * Clean a captured project reference: drop articles, the word "project", a
 * trailing "with <agent>" clause and a leading "work on"/"where i left off on".
 */
function cleanProjectQuery(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let t = raw.trim();
  // Remove a trailing agent clause: "... with the best coding agent".
  t = t.replace(/\b(with|using|via)\b.*$/, '').trim();
  // Remove an explicit handoff clause: "... and the latest handoff".
  t = t.replace(/\b(and|with|including|plus)\b.*\bhandoff\b.*$/, '').trim();
  // Strip leading filler.
  t = t
    .replace(/^(work(ing)?\s+on\s+)/, '')
    .replace(/^(where\s+i\s+left\s+off\s+(on\s+)?)/, '')
    .replace(/^(my|the|on|in)\s+/, '')
    .trim();
  // Strip a trailing "project"/"repo"/"folder" noun and leading article again.
  t = t.replace(/\b(project|projects|repo|repository|folder|directory)\b$/, '').trim();
  t = t.replace(/^(the|my)\s+/, '').trim();
  return t.length > 0 ? t : undefined;
}

/** Build a RecognisedIntent, omitting empty slots (exactOptionalPropertyTypes). */
function make(
  intent: IntentName,
  matchedRule: string,
  opts: {
    slots?: IntentSlots;
    confidence: number;
    requiresConfirmation?: boolean;
  },
): RecognisedIntent {
  return {
    intent,
    matchedRule,
    slots: opts.slots ?? {},
    confidence: opts.confidence,
    requiresConfirmation: opts.requiresConfirmation ?? false,
  };
}

type Rule = (text: string) => RecognisedIntent | null;

// --- Individual rules (ordered; first match wins) ----------------------------

const restartRelay: Rule = (t) =>
  /\b(restart|reboot|reconnect|reset|relaunch)\b.*\brelay\b/.test(t)
    ? make('restart_relay', 'restart-relay', { confidence: 0.95, requiresConfirmation: true })
    : null;

const scanProjects: Rule = (t) =>
  /\b(scan|rescan|re-scan|discover|index)\b\s+(for\s+)?(my\s+|new\s+)?projects?\b/.test(t) ||
  /\bscan\b.*\bfor\s+projects?\b/.test(t)
    ? make('scan_projects', 'scan-projects', { confidence: 0.9 })
    : null;

const validateHandoff: Rule = (t) =>
  /\bvalidate\b.*\bhandoff\b/.test(t) || /\bcheck\b.*\bhandoff\b.*\bvalid/.test(t)
    ? make('validate_handoff', 'validate-handoff', { confidence: 0.9 })
    : null;

const showHandoffs: Rule = (t) =>
  /\b(show|view|see|open|list|my)\b.*\bhandoffs?\b/.test(t) || /^handoffs?$/.test(t)
    ? make('show_handoffs', 'show-handoffs', {
        confidence: 0.88,
        slots: /\blatest\b/.test(t) ? { includeLatestHandoff: true } : {},
      })
    : null;

const showFailedSessions: Rule = (t) =>
  /\b(failed|failing|errored|crashed|broken|unsuccessful)\b/.test(t) &&
  /\b(session|sessions|agent|agents|run|runs|launch|launches)\b/.test(t)
    ? make('show_failed_sessions', 'show-failed-sessions', { confidence: 0.9 })
    : null;

const showActiveSessions: Rule = (t) => {
  const sessiony = /\b(session|sessions|agent|agents)\b/.test(t);
  if (
    (/\b(show|view|see|list|what'?s|whats|display|open)\b/.test(t) && sessiony) ||
    /\bwhat'?s\s+running\b/.test(t) ||
    /\bwhat\s+is\s+running\b/.test(t) ||
    /\b(active|running|current|live|open)\b.*\b(session|sessions|agent|agents)\b/.test(t) ||
    /\bwhat\b.*\b(working\s+on|doing)\b/.test(t) ||
    /^sessions?$/.test(t)
  ) {
    return make('show_active_sessions', 'show-active-sessions', { confidence: 0.85 });
  }
  return null;
};

const showActivity: Rule = (t) =>
  /\b(recent\s+activity|activity\s+(log|feed|timeline)?|what\s+happened|recent\s+events)\b/.test(t) ||
  /\b(show|view|see|open)\b.*\bactivity\b/.test(t)
    ? make('show_recent_activity', 'show-activity', { confidence: 0.85 })
    : null;

const showApprovals: Rule = (t) =>
  /\bapprovals?\b/.test(t) ||
  /\b(waiting|pending|needs?)\b.*\b(approv|my\s+sign-?off|confirmation)\b/.test(t) ||
  /\banything\s+(waiting|pending|to\s+approve)\b/.test(t)
    ? make('show_approvals', 'show-approvals', { confidence: 0.85 })
    : null;

const explainError: Rule = (t) =>
  /\b(explain|investigate|diagnose|debug|what'?s\s+wrong\s+with|fix|look\s+at|why)\b/.test(t) &&
  /\b(error|exception|traceback|stack\s*trace|crash|failure|bug)\b/.test(t)
    ? make('explain_error', 'explain-error', {
        confidence: 0.8,
        slots: { question: t },
      })
    : null;

const explainSelection: Rule = (t) =>
  /\bexplain\b\s+(this|that|it|the\s+selection|the\s+selected|my\s+selection)\b/.test(t) ||
  /\bexplain\s+(the\s+)?(selected|highlighted)\b/.test(t)
    ? make('explain_selection', 'explain-selection', { confidence: 0.78, slots: { question: t } })
    : null;

const summariseClipboard: Rule = (t) =>
  /\bsummari[sz]e\b.*\bclipboard\b/.test(t)
    ? make('summarise_clipboard', 'summarise-clipboard', { confidence: 0.82 })
    : null;

const summariseSelection: Rule = (t) =>
  /\bsummari[sz]e\b\s+(this|that|it|the\s+selection|the\s+selected|my\s+selection|the\s+highlighted|the\s+text|selected\s+text)\b/.test(
    t,
  ) || /\b(tl;?dr|tldr)\b/.test(t)
    ? make('summarise_selection', 'summarise-selection', { confidence: 0.8, slots: { question: t } })
    : null;

const continueProject: Rule = (t) => {
  const m = /^(continue|resume|carry on|pick up|keep going on|get back to)\b\s*(.*)$/.exec(t);
  if (!m) return null;
  // "continue" alone (no project) is ambiguous — let the command provider win.
  const remainder = (m[2] ?? '').trim();
  const projectQuery = cleanProjectQuery(remainder);
  if (!projectQuery) return null;
  const agent = detectAgent(t);
  const slots: IntentSlots = {
    projectQuery,
    ...(agent ? { agentPreference: agent } : {}),
    ...(/\bhandoff\b/.test(t) ? { includeLatestHandoff: true } : {}),
  };
  return make('continue_project', 'continue-project', {
    confidence: 0.9,
    requiresConfirmation: true,
    slots,
  });
};

const launchAgentOnProject: Rule = (t) => {
  if (!/^(launch|start|run|fire up|spin up|ask|use|get|tell)\b/.test(t)) return null;
  const agent = detectAgent(t);
  if (!agent) return null;
  // The project follows "on"/"for"/"against"/"in"/"to work on".
  const pm = /\b(?:on|for|against|in|onto|to\s+work\s+on)\s+(.+)$/.exec(t);
  const projectQuery = cleanProjectQuery(pm?.[1]);
  // A pure-pronoun target ("this error") is not a project reference.
  if (pm && projectQuery && /^(this|that|it|the\s+error|this\s+error)\b/.test(projectQuery)) {
    return null;
  }
  const slots: IntentSlots = {
    agentPreference: agent,
    ...(projectQuery ? { projectQuery } : {}),
  };
  return make('launch_agent_on_project', 'launch-agent', {
    confidence: 0.85,
    requiresConfirmation: true,
    slots,
  });
};

const openLatestProject: Rule = (t) =>
  /\bopen\b.*\b(latest|most\s+recent|last|newest)\b.*\bproject\b/.test(t) ||
  /\bopen\b\s+(my\s+)?(latest|most\s+recent|last)\s+project\b/.test(t)
    ? make('open_latest_project', 'open-latest-project', { confidence: 0.88 })
    : null;

const openProjectFolder: Rule = (t) => {
  // "open the Orbit folder", "open the folder for Orbit", "reveal Orbit's folder"
  const m1 = /\b(open|reveal|show)\b.*\bfolder\s+(for|of)\s+(.+)$/.exec(t);
  const m2 = /\b(open|reveal|show)\b\s+(the\s+)?(.+?)\s+(folder|directory)\b/.exec(t);
  const raw = m1?.[3] ?? m2?.[3];
  const projectQuery = cleanProjectQuery(raw);
  if (!projectQuery) return null;
  return make('open_project_folder', 'open-project-folder', {
    confidence: 0.85,
    slots: { projectQuery },
  });
};

const openProject: Rule = (t) => {
  // "open the Orbit project", "open project Orbit"
  const m1 = /\bopen\b\s+(the\s+)?(.+?)\s+project\b/.exec(t);
  const m2 = /\bopen\b\s+project\s+(.+)$/.exec(t);
  const raw = m1?.[2] ?? m2?.[1];
  const projectQuery = cleanProjectQuery(raw);
  if (!projectQuery) return null;
  return make('open_project', 'open-project', {
    confidence: 0.85,
    slots: { projectQuery },
  });
};

const findNotes: Rule = (t) => {
  // "find notes about X", "search my notes for X", "find the note that mentions X"
  const m =
    /\b(find|search|look\s+for|show)\b.*\bnotes?\b(?:\s+(?:about|for|on|mentioning|that\s+(?:mentions|mention|says|say|references|reference)|containing|with))?\s*(.*)$/.exec(
      t,
    );
  if (!m) return null;
  const noteQuery = (m[2] ?? '').trim().replace(/^(about|for|on)\s+/, '');
  const slots: IntentSlots = noteQuery ? { noteQuery } : {};
  return make('find_notes', 'find-notes', { confidence: 0.85, slots });
};

const findFile: Rule = (t) => {
  // "find the document that mentioned Leonard", "find file report.pdf", "where is X"
  const m =
    /\b(find|search\s+for|search|locate|where\s+is|look\s+for|open)\b.*?\b(file|files|document|documents|doc|docs|pdf|spreadsheet|presentation|the\s+document|the\s+file)\b(?:\s+(?:that\s+(?:mentioned|mentions|mention|says|say|contains|contained|contain|references|reference)|about|named|called|with|containing|on|for))?\s*(.*)$/.exec(
      t,
    );
  if (!m) return null;
  const fileQuery = (m[3] ?? '').trim().replace(/^(about|named|called)\s+/, '');
  const slots: IntentSlots = fileQuery ? { fileQuery } : {};
  return make('find_file', 'find-file', { confidence: 0.78, slots });
};

const openApplication: Rule = (t) => {
  const m = /^(open|launch|start|run|fire up|boot|switch to)\s+(.+)$/.exec(t);
  if (!m) return null;
  let app = (m[2] ?? '').trim();
  app = app.replace(/^(the|my)\s+/, '').replace(/\s+(app|application|programme|program)$/, '').trim();
  if (!app) return null;
  const slots: IntentSlots = { applicationQuery: app };
  return make('open_application', 'open-application', { confidence: 0.7, slots });
};

const askQuickAi: Rule = (t) => {
  const m = /^(ask\s+ai|quick\s+ai|ai|hey\s+ai)\b[:,]?\s*(.*)$/.exec(t);
  if (!m) return null;
  const question = (m[2] ?? '').trim();
  if (!question) return null;
  return make('ask_quick_ai', 'ask-quick-ai', { confidence: 0.7, slots: { question } });
};

/**
 * Ordered rule set. Specific/consequential intents are tried before broad ones
 * ("open the Orbit project" must beat the generic "open <app>" rule).
 */
const RULES: readonly Rule[] = [
  restartRelay,
  scanProjects,
  validateHandoff,
  showHandoffs,
  showFailedSessions,
  showActiveSessions,
  showActivity,
  showApprovals,
  explainError,
  explainSelection,
  summariseClipboard,
  summariseSelection,
  continueProject,
  launchAgentOnProject,
  openLatestProject,
  openProjectFolder,
  openProject,
  findNotes,
  findFile,
  openApplication,
  askQuickAi,
];

/**
 * Recognise a natural-language intent in `query`, or return null when the text
 * isn't a recognised request (the common case for short/entity queries, which
 * should fall through to the exact-match providers).
 */
export function recogniseIntent(query: string): RecognisedIntent | null {
  const text = stripPolite(normalizeQuery(query));
  if (text.length < 3) return null;
  for (const rule of RULES) {
    const hit = rule(text);
    if (hit) return hit;
  }
  return null;
}
