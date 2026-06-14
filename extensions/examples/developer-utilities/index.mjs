// @ts-check
/**
 * Developer Utilities — a minimal but real Orbit extension.
 *
 * Demonstrates: a no-view command with a brokered effect (copy) and a storage
 * write; and a list command that reads from the extension's namespaced storage.
 * `crypto` is a Node global (Node 18+).
 */
import { defineExtension } from '@orbit/extension-sdk';

const HISTORY_KEY = 'history';
const MAX_HISTORY = 20;

function readHistory(storage) {
  try {
    const parsed = JSON.parse(storage[HISTORY_KEY] ?? '[]');
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

defineExtension({
  'random-uuid': (ctx) => {
    const id = crypto.randomUUID();
    const history = [id, ...readHistory(ctx.storage)].slice(0, MAX_HISTORY);
    return {
      effects: [{ kind: 'copy', text: id }],
      storageWrites: { [HISTORY_KEY]: JSON.stringify(history) },
      toast: `Copied ${id}`,
    };
  },
  'uuid-history': (ctx) => {
    const history = readHistory(ctx.storage);
    const q = ctx.query.trim().toLowerCase();
    const items = history
      .filter((id) => !q || id.toLowerCase().includes(q))
      .map((id, i) => ({
        id: `uuid-${i}`,
        title: id,
        subtitle: 'Generated UUID — select to copy',
        action: { kind: 'copy', text: id },
      }));
    return { items };
  },
});
