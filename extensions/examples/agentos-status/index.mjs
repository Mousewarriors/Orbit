// @ts-check
/**
 * AgentOS Status — a SAFE MOCK extension.
 *
 * It returns canned agent statuses and performs NO network calls. It exists to
 * exercise the `list` command path and permission-brokered item actions (copy).
 * A real AgentOS integration would live behind the `network` permission and a
 * configured endpoint; this sample deliberately stays offline.
 */
import { defineExtension } from '@orbit/extension-sdk';

const AGENTS = [
  { name: 'Indexer', status: 'idle', detail: 'Last run 4m ago' },
  { name: 'Sync', status: 'running', detail: 'Uploading 12 items' },
  { name: 'Summariser', status: 'idle', detail: 'Queue empty' },
  { name: 'Watcher', status: 'error', detail: 'Permission denied on /var' },
  { name: 'Planner', status: 'running', detail: 'Step 3 of 7' },
];

const ICON = { idle: '○', running: '●', error: '✕' };

defineExtension({
  'agent-status': (ctx) => {
    const q = ctx.query.trim().toLowerCase();
    const items = AGENTS.filter((a) => !q || a.name.toLowerCase().includes(q)).map((a, i) => ({
      id: `agent-${i}`,
      title: `${ICON[a.status] ?? '·'} ${a.name}`,
      subtitle: `${a.status} — ${a.detail}`,
      action: { kind: 'copy', text: `${a.name}: ${a.status} (${a.detail})` },
    }));
    return { items };
  },
});
