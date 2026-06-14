// @ts-check
/**
 * Orbit Extension SDK (host protocol v1).
 *
 * An extension is a Node module that calls `defineExtension({...})` with a map of
 * command handlers. The host spawns the extension as a child process, writes one
 * JSON `invoke` request to stdin, and reads one JSON response from stdout. This
 * SDK handles that one-shot lifecycle so authors only write handlers.
 *
 * A handler receives a context `{ command, query, storage, preferences }` and
 * returns `{ items?, effects?, storageWrites?, toast? }`:
 *   - items:        list rows for `list` commands ({ id, title, subtitle?, action? })
 *   - effects:      brokered actions the host performs ({ kind: 'open-url'|'copy'|'open-path', ... })
 *   - storageWrites: { key: value } persisted to this extension's namespace
 *   - toast:        a short message to show the user
 *
 * Effects and item actions are only performed if the extension declared the
 * matching permission in its manifest; otherwise the host drops them.
 */

import process from 'node:process';

export const PROTOCOL_VERSION = 1;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    // If nothing is piped, end fires immediately on a closed stdin.
  });
}

function write(obj) {
  process.stdout.write(JSON.stringify(obj));
}

/**
 * Register command handlers and run the one-shot request/response loop.
 * @param {Record<string, (ctx: {command:string, query:string, storage:Record<string,string>, preferences:Record<string,unknown>}) => (object|Promise<object>)>} handlers
 */
export function defineExtension(handlers) {
  readStdin()
    .then(async (raw) => {
      let req;
      try {
        req = JSON.parse(raw);
      } catch {
        return write({ v: PROTOCOL_VERSION, type: 'error', message: 'invalid request JSON' });
      }
      if (!req || req.v !== PROTOCOL_VERSION) {
        return write({ v: PROTOCOL_VERSION, type: 'error', message: 'unsupported protocol version' });
      }
      const handler = handlers[req.command];
      if (typeof handler !== 'function') {
        return write({ v: PROTOCOL_VERSION, type: 'error', message: `unknown command: ${req.command}` });
      }
      try {
        const out = (await handler({
          command: req.command,
          query: typeof req.query === 'string' ? req.query : '',
          storage: req.storage && typeof req.storage === 'object' ? req.storage : {},
          preferences: req.preferences && typeof req.preferences === 'object' ? req.preferences : {},
        })) || {};
        const response = {
          v: PROTOCOL_VERSION,
          type: 'result',
          items: Array.isArray(out.items) ? out.items : [],
          effects: Array.isArray(out.effects) ? out.effects : [],
          storageWrites: out.storageWrites && typeof out.storageWrites === 'object' ? out.storageWrites : {},
        };
        if (typeof out.toast === 'string') response.toast = out.toast;
        write(response);
      } catch (e) {
        write({ v: PROTOCOL_VERSION, type: 'error', message: String((e && e.message) || e) });
      }
    })
    .catch((e) => write({ v: PROTOCOL_VERSION, type: 'error', message: String(e) }));
}
