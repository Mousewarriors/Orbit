// @ts-check
/**
 * AgentOS Controller — an INITIAL, SAFE, OBSERVATIONAL controller extension.
 *
 * It surfaces AgentOS state (agents, sessions, projects, recent activity,
 * pending approvals, health) inside Orbit. It is deliberately read-only:
 *
 *   NOT supported (by design, this slice): shell execution, SSH, service
 *   restarts, autonomous task dispatch, code execution, or any destructive /
 *   privileged action. The only effects it ever asks the host to perform are
 *   the brokered, permissioned `open-url`, `copy`, and `open-path` — and even
 *   those are validated here before being emitted.
 *
 * State comes from one of three adapters, chosen by the `source` preference:
 *   - mock  (default): bundled offline sample data, labelled "mock data".
 *   - json:            reads a local JSON file (path from the `jsonPath` pref).
 *   - http:            fetches a read-only endpoint (`httpBaseUrl` pref) with a
 *                      hard timeout and graceful error handling.
 *
 * Note on preferences: the host protocol v1 sends { v, type, command, query,
 * storage } today; preference VALUES are not yet plumbed to the child process.
 * Handlers therefore read `ctx.preferences` defensively and fall back to the
 * mock adapter, so the extension is fully functional offline now and will pick
 * up json/http automatically once the host forwards preferences. See
 * docs/architecture/AGENTOS_ADAPTER.md.
 */
import { defineExtension } from '@orbit/extension-sdk';

/* ------------------------------------------------------------------ *
 * Shared state shape (what every adapter returns)
 * ------------------------------------------------------------------ *
 * {
 *   agents:    [{ name, status, task, lastActivity, project, health }],
 *   sessions:  [{ id, agent, project, startedAt, state }],
 *   projects:  [{ name, path, agents, lastActivity }],
 *   activity:  [{ at, agent, project, message }],
 *   approvals: [{ id, agent, project, summary, requestedAt }],
 * }
 * Adapters always return this shape (missing arrays default to []).
 */

const STATUS_ICON = { idle: '○', running: '●', blocked: '◐', error: '✕', offline: '·' };
const HEALTH_ICON = { healthy: '✓', degraded: '!', unhealthy: '✕', unknown: '?' };

const FETCH_TIMEOUT_MS = 4000; // < host's 5s RPC budget, leaving headroom.

/* ------------------------------------------------------------------ *
 * Adapters
 * ------------------------------------------------------------------ */

/** Realistic, clearly-labelled offline sample data. */
function mockAdapter() {
  const now = Date.now();
  const ago = (m) => new Date(now - m * 60_000).toISOString();
  return {
    source: 'mock',
    label: 'mock data',
    data: {
      agents: [
        {
          name: 'Indexer',
          status: 'running',
          task: 'Reindexing 1,204 files',
          lastActivity: ago(1),
          project: 'second-brain',
          health: 'healthy',
        },
        {
          name: 'Planner',
          status: 'running',
          task: 'Step 3 of 7 — drafting handoff',
          lastActivity: ago(2),
          project: 'orbit',
          health: 'healthy',
        },
        {
          name: 'Summariser',
          status: 'idle',
          task: 'Queue empty',
          lastActivity: ago(14),
          project: 'second-brain',
          health: 'healthy',
        },
        {
          name: 'Watcher',
          status: 'blocked',
          task: 'Awaiting approval to write /var/agentos',
          lastActivity: ago(6),
          project: 'orbit',
          health: 'degraded',
        },
        {
          name: 'Trader',
          status: 'error',
          task: 'Adapter handshake failed',
          lastActivity: ago(22),
          project: 'ferrari-trader',
          health: 'unhealthy',
        },
      ],
      sessions: [
        { id: 'sess-8f21', agent: 'Indexer', project: 'second-brain', startedAt: ago(31), state: 'active' },
        { id: 'sess-3c0a', agent: 'Planner', project: 'orbit', startedAt: ago(12), state: 'active' },
        { id: 'sess-1b77', agent: 'Watcher', project: 'orbit', startedAt: ago(7), state: 'waiting' },
      ],
      projects: [
        { name: 'second-brain', path: 'C:/AgentOS', agents: ['Indexer', 'Summariser'], lastActivity: ago(1) },
        { name: 'orbit', path: 'C:/Users/Simon Wood/Raycast Clone', agents: ['Planner', 'Watcher'], lastActivity: ago(2) },
        { name: 'ferrari-trader', path: 'C:/AgentOS/public/ferrari-trader', agents: ['Trader'], lastActivity: ago(22) },
      ],
      activity: [
        { at: ago(1), agent: 'Indexer', project: 'second-brain', message: 'Reindex batch 4/12 complete' },
        { at: ago(2), agent: 'Planner', project: 'orbit', message: 'Wrote handoff draft v3' },
        { at: ago(6), agent: 'Watcher', project: 'orbit', message: 'Requested approval: write /var/agentos' },
        { at: ago(12), agent: 'Planner', project: 'orbit', message: 'Started session sess-3c0a' },
        { at: ago(22), agent: 'Trader', project: 'ferrari-trader', message: 'Adapter handshake failed (ECONNREFUSED)' },
      ],
      approvals: [
        { id: 'apr-001', agent: 'Watcher', project: 'orbit', summary: 'Write file /var/agentos/state.json', requestedAt: ago(6) },
        { id: 'apr-002', agent: 'Planner', project: 'orbit', summary: 'Open external URL for research', requestedAt: ago(4) },
      ],
    },
  };
}

/** Normalise an arbitrary parsed object into the shared state shape. */
function normalise(raw) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = raw && typeof raw === 'object' ? raw : {};
  return {
    agents: arr(obj.agents),
    sessions: arr(obj.sessions),
    projects: arr(obj.projects),
    activity: arr(obj.activity),
    approvals: arr(obj.approvals),
  };
}

/** Read state from a local JSON file. Never throws; returns an `error` field. */
async function jsonAdapter(jsonPath) {
  if (!jsonPath || typeof jsonPath !== 'string') {
    return { source: 'json', label: 'local JSON', error: 'No JSON file path configured (set the "Local JSON file path" preference).' };
  }
  try {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(text);
    return { source: 'json', label: `local JSON (${jsonPath})`, data: normalise(parsed) };
  } catch (e) {
    return { source: 'json', label: 'local JSON', error: `Could not read JSON file: ${String((e && e.message) || e)}` };
  }
}

/** Validate that a URL is plain http(s). */
function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Fetch state from a read-only HTTP endpoint with a hard timeout. Never throws. */
async function httpAdapter(baseUrl) {
  if (!baseUrl || !isHttpUrl(baseUrl)) {
    return { source: 'http', label: 'HTTP', error: 'No valid http(s) base URL configured (set the "AgentOS base URL" preference).' };
  }
  // Build the state URL by joining a fixed, read-only path onto the base.
  let url;
  try {
    url = new URL('state', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return { source: 'http', label: 'HTTP', error: `Invalid base URL: ${baseUrl}` };
  }
  try {
    const res = await globalThis.fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: globalThis.AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { source: 'http', label: `HTTP (${baseUrl})`, error: `Endpoint returned HTTP ${res.status}` };
    }
    const parsed = await res.json();
    return { source: 'http', label: `HTTP (${baseUrl})`, data: normalise(parsed) };
  } catch (e) {
    const msg = e && e.name === 'TimeoutError' ? `timed out after ${FETCH_TIMEOUT_MS}ms` : String((e && e.message) || e);
    return { source: 'http', label: `HTTP (${baseUrl})`, error: `Request failed: ${msg}` };
  }
}

/**
 * Resolve the active adapter result from preferences. Always resolves (never
 * rejects); on any misconfiguration falls back to mock so commands still work.
 */
async function resolveState(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : {};
  const source = typeof p.source === 'string' ? p.source : 'mock';
  if (source === 'json') return jsonAdapter(typeof p.jsonPath === 'string' ? p.jsonPath : '');
  if (source === 'http') return httpAdapter(typeof p.httpBaseUrl === 'string' ? p.httpBaseUrl : '');
  return mockAdapter();
}

/* ------------------------------------------------------------------ *
 * Rendering helpers
 * ------------------------------------------------------------------ */

function relTime(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso || 'unknown';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function matches(query, ...fields) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => String(f ?? '').toLowerCase().includes(q));
}

/** A subtitle suffix that makes the active adapter (esp. mock) obvious. */
function sourceSuffix(state) {
  return state.label ? ` · ${state.label}` : '';
}

/**
 * If an adapter failed (json/http), produce a single clean error item +
 * toast instead of an empty list. Returns null when there is no error.
 */
function adapterErrorResult(state) {
  if (!state.error) return null;
  return {
    items: [
      {
        id: 'adapter-error',
        title: `✕ AgentOS ${state.source} source unavailable`,
        subtitle: state.error,
        action: { kind: 'copy', text: state.error },
      },
    ],
    toast: `AgentOS ${state.source}: ${state.error}`,
  };
}

/** A workspace open-url effect, built safely from the URL template preference. */
function workspaceAction(prefs, agentName) {
  const tmpl = prefs && typeof prefs.workspaceUrlTemplate === 'string' ? prefs.workspaceUrlTemplate : '';
  if (!tmpl) return undefined;
  const url = tmpl.replace('{agent}', encodeURIComponent(agentName));
  return isHttpUrl(url) ? { kind: 'open-url', url } : undefined;
}

/**
 * Control rows that lead the agents list: open the dashboard (open-url) and a
 * refresh affordance. "Refresh" is just re-running the command — selecting any
 * item re-invokes the extension fresh — so the row copies a hint rather than
 * pretending to hold mutable state we don't have.
 */
function controlItems(prefs, state) {
  const items = [];
  const dash = prefs && typeof prefs.dashboardUrl === 'string' ? prefs.dashboardUrl : '';
  if (dash && isHttpUrl(dash)) {
    items.push({
      id: 'open-dashboard',
      title: '↗ Open AgentOS Dashboard',
      subtitle: `${dash}${sourceSuffix(state)}`,
      action: { kind: 'open-url', url: dash },
    });
  }
  items.push({
    id: 'refresh',
    title: '↻ Refresh',
    subtitle: `Re-query AgentOS · ${(state.data && state.data.agents.length) || 0} agent(s)${sourceSuffix(state)}`,
    action: { kind: 'copy', text: 'AgentOS: select an item to re-query (each invocation fetches fresh state)' },
  });
  return items;
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

defineExtension({
  'list-agents': async (ctx) => {
    const state = await resolveState(ctx.preferences);
    const err = adapterErrorResult(state);
    if (err) return err;
    const d = state.data;
    // Lead with control rows (dashboard / refresh) unless the query clearly
    // targets a specific agent; keep them when the query mentions them.
    const controls = controlItems(ctx.preferences, state).filter((c) =>
      matches(ctx.query, 'refresh', 'dashboard', 'open', 'agentos', c.title),
    );
    const items = d.agents
      .filter((a) => matches(ctx.query, a.name, a.status, a.task, a.project, a.health))
      .map((a, i) => {
        // Prefer opening the agent's workspace (open-url) if a safe template
        // is configured; otherwise fall back to copying the status (always safe).
        const ws = workspaceAction(ctx.preferences, a.name);
        const statusText = `${a.name}: ${a.status} — ${a.task} [project ${a.project}, health ${a.health}, ${relTime(a.lastActivity)}]`;
        return {
          id: `agent-${i}`,
          title: `${STATUS_ICON[a.status] ?? '·'} ${a.name}`,
          subtitle: `${a.status} · ${a.task} · ${a.project} · ${HEALTH_ICON[a.health] ?? '?'} ${a.health} · ${relTime(a.lastActivity)}${sourceSuffix(state)}`,
          action: ws ?? { kind: 'copy', text: statusText },
        };
      });
    return { items: [...controls, ...items] };
  },

  'list-sessions': async (ctx) => {
    const state = await resolveState(ctx.preferences);
    const err = adapterErrorResult(state);
    if (err) return err;
    const items = state.data.sessions
      .filter((s) => matches(ctx.query, s.id, s.agent, s.project, s.state))
      .map((s, i) => ({
        id: `session-${i}`,
        title: `${s.agent} — ${s.id}`,
        subtitle: `${s.state} · ${s.project} · started ${relTime(s.startedAt)}${sourceSuffix(state)}`,
        action: { kind: 'copy', text: `${s.id} (${s.agent}/${s.project}): ${s.state}, started ${relTime(s.startedAt)}` },
      }));
    return { items };
  },

  'list-projects': async (ctx) => {
    const state = await resolveState(ctx.preferences);
    const err = adapterErrorResult(state);
    if (err) return err;
    // A list item carries a single brokered action (protocol v1). The default
    // action opens the project folder (open-path); when the query mentions
    // "copy" or "path" we switch the action to copy the path instead, so both
    // "open project folder" and "copy project path" are reachable.
    const copyMode = /\b(copy|path)\b/i.test(ctx.query || '');
    const items = state.data.projects
      .filter((pr) => matches(ctx.query, pr.name, pr.path, (pr.agents || []).join(' '), 'copy path'))
      .map((pr, i) => {
        const path = pr.path ? String(pr.path) : '';
        let action;
        if (copyMode || !path) {
          action = { kind: 'copy', text: path || pr.name };
        } else {
          action = { kind: 'open-path', path };
        }
        const hint = copyMode ? 'copy path' : path ? 'open folder' : 'copy name';
        return {
          id: `project-${i}`,
          title: pr.name,
          subtitle: `${hint} · ${(pr.agents || []).length} agent(s) · ${path || 'no path'} · ${relTime(pr.lastActivity)}${sourceSuffix(state)}`,
          action,
        };
      });
    return { items };
  },

  'recent-activity': async (ctx) => {
    const state = await resolveState(ctx.preferences);
    const err = adapterErrorResult(state);
    if (err) return err;
    const items = state.data.activity
      .filter((ev) => matches(ctx.query, ev.agent, ev.project, ev.message))
      .map((ev, i) => ({
        id: `activity-${i}`,
        title: `${ev.agent}: ${ev.message}`,
        subtitle: `${ev.project} · ${relTime(ev.at)}${sourceSuffix(state)}`,
        action: { kind: 'copy', text: `[${relTime(ev.at)}] ${ev.agent}/${ev.project}: ${ev.message}` },
      }));
    return { items };
  },

  'pending-approvals': async (ctx) => {
    const state = await resolveState(ctx.preferences);
    const err = adapterErrorResult(state);
    if (err) return err;
    const approvals = state.data.approvals;
    if (approvals.length === 0) {
      return {
        items: [
          {
            id: 'approvals-empty',
            title: '✓ No pending approvals',
            subtitle: `Nothing awaiting review${sourceSuffix(state)}`,
            action: { kind: 'copy', text: 'No pending AgentOS approvals' },
          },
        ],
      };
    }
    const items = approvals
      .filter((ap) => matches(ctx.query, ap.agent, ap.project, ap.summary, ap.id))
      .map((ap, i) => ({
        id: `approval-${i}`,
        // Observational only: we surface the request and let the operator
        // approve it in AgentOS itself. We never approve/execute from here.
        title: `⧗ ${ap.agent}: ${ap.summary}`,
        subtitle: `${ap.project} · requested ${relTime(ap.requestedAt)} · approve in AgentOS${sourceSuffix(state)}`,
        action: { kind: 'copy', text: `${ap.id} (${ap.agent}/${ap.project}): ${ap.summary} — requested ${relTime(ap.requestedAt)}` },
      }));
    return { items };
  },

  'agent-health': async (ctx) => {
    const state = await resolveState(ctx.preferences);
    const err = adapterErrorResult(state);
    if (err) return err;
    const items = state.data.agents
      .filter((a) => matches(ctx.query, a.name, a.health, a.status))
      .map((a, i) => ({
        id: `health-${i}`,
        title: `${HEALTH_ICON[a.health] ?? '?'} ${a.name} — ${a.health ?? 'unknown'}`,
        subtitle: `status ${a.status} · last activity ${relTime(a.lastActivity)}${sourceSuffix(state)}`,
        action: { kind: 'copy', text: `${a.name} health: ${a.health ?? 'unknown'} (status ${a.status}, ${relTime(a.lastActivity)})` },
      }));
    return { items };
  },
});
