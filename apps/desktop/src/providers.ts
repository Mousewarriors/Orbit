/**
 * Search providers for the launcher slice: applications (from the native index)
 * and the calculator. Both conform to the shared SearchProvider contract so the
 * orchestrator can run them alongside the command provider.
 */
import type { SearchItem, SearchProvider } from '@orbit/shared-types';
import { calculate, FALLBACK_RATES } from '@orbit/calculator';
import { resolveTemplate } from '@orbit/placeholders';
import {
  DEFAULT_PASSWORD_OPTIONS,
  colorConversions,
  formatJson,
  generatePassword,
} from '@orbit/tools';
import * as native from './native.js';
import type { NativeApp } from './native.js';

/** First non-empty line of `text`, trimmed and bounded for a subtitle. */
function snippetPreview(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

/** Build an application provider over an already-loaded native app list. */
export function createAppProvider(getApps: () => ReadonlyArray<NativeApp>): SearchProvider {
  return {
    id: 'applications',
    source: 'application',
    canHandle: () => true,
    async search(): Promise<SearchItem[]> {
      return getApps().map((app) => ({
        id: app.id,
        title: app.name,
        subtitle: 'Application',
        category: 'Applications',
        source: 'application' as const,
        icon: { kind: 'letter' as const, text: app.name.slice(0, 1).toUpperCase() },
        confidence: 0.6,
        primaryAction: {
          id: `${app.id}.launch`,
          title: 'Open',
          run: { kind: 'open-path' as const, path: app.path },
          requires: ['apps.launch' as const],
        },
        secondaryActions: [
          {
            id: `${app.id}.copy-path`,
            title: 'Copy Path',
            run: { kind: 'copy' as const, text: app.path },
          },
        ],
      }));
    },
  };
}

/**
 * Snippet provider. Surfaces stored snippets while typing (gated to ≥2 chars so
 * it doesn't crowd the root). Placeholders that need no user input ({date},
 * {time}, {uuid}, …) are resolved at search time so the pasted text is final;
 * the primary action injects it into the active app via paste-injection.
 */
export function createSnippetProvider(): SearchProvider {
  return {
    id: 'snippets',
    source: 'snippet',
    canHandle: (q) => native.isTauri() && q.trim().length >= 2,
    async search(query): Promise<SearchItem[]> {
      const snippets = await native.snippetList(query, 20);
      const now = new Date();
      return snippets.map((s) => {
        const resolved = resolveTemplate(s.content, { now }).text;
        const subtitle = s.keyword
          ? `⌨ ${s.keyword} · ${snippetPreview(resolved)}`
          : snippetPreview(resolved);
        return {
          id: `snippet.${s.id}`,
          title: s.name,
          subtitle,
          category: 'Snippets',
          source: 'snippet' as const,
          icon: { kind: 'letter' as const, text: s.name.slice(0, 1).toUpperCase() },
          confidence: 0.6,
          primaryAction: {
            id: `snippet.${s.id}.paste`,
            title: 'Paste Snippet',
            run: { kind: 'paste' as const, text: resolved, snippetId: s.id },
          },
          secondaryActions: [
            {
              id: `snippet.${s.id}.copy`,
              title: 'Copy to Clipboard',
              run: { kind: 'copy' as const, text: resolved },
            },
          ],
        };
      });
    },
  };
}

/**
 * Notes provider. Surfaces matching notes (title + body FTS) and opens the
 * selected one in the Notes editor via a push-view action carrying its id.
 */
export function createNoteProvider(): SearchProvider {
  return {
    id: 'notes',
    source: 'note',
    canHandle: (q) => native.isTauri() && q.trim().length >= 2,
    async search(query): Promise<SearchItem[]> {
      const notes = await native.noteList(query, 15);
      return notes.map((n) => ({
        id: `note.${n.id}`,
        title: n.title || 'Untitled',
        subtitle: n.body.split('\n')[0]?.slice(0, 80) || 'Empty note',
        category: 'Notes',
        source: 'note' as const,
        icon: { kind: 'builtin' as const, name: 'file-text' },
        confidence: 0.55,
        primaryAction: {
          id: `note.${n.id}.open`,
          title: 'Open Note',
          run: { kind: 'push-view' as const, viewId: 'notes', args: { id: n.id } },
        },
      }));
    },
  };
}

/** Does a (resolved) target use a web/mail scheme we open as a URL? */
function isWebTarget(target: string): boolean {
  return /^(https?|mailto):/i.test(target.trim());
}

/**
 * Derive the `{query}` argument for a Quicklink from the typed text. If the text
 * starts with the link's alias or title followed by a space, the remainder is the
 * argument (e.g. "gh tauri" → "tauri"); an exact alias/title match yields an
 * empty argument; otherwise the whole query is used.
 */
function deriveQuicklinkArg(query: string, ql: native.Quicklink): string {
  const q = query.trim();
  const lower = q.toLowerCase();
  for (const prefix of [ql.alias, ql.title]) {
    if (!prefix) continue;
    const p = prefix.toLowerCase();
    if (lower === p) return '';
    if (lower.startsWith(`${p} `)) return q.slice(p.length).trim();
  }
  return q;
}

/**
 * Quicklink provider. Surfaces saved links matching the typed text and opens
 * their (placeholder-resolved) target. `{query}` is filled from the text after a
 * matching alias/title prefix; date/time/uuid resolve automatically. Web/mail
 * targets open as URLs (scheme re-checked natively); everything else opens as a
 * path via the OS handler.
 */
export function createQuicklinkProvider(): SearchProvider {
  return {
    id: 'quicklinks',
    source: 'quicklink',
    canHandle: (q) => native.isTauri() && q.trim().length >= 2,
    async search(query): Promise<SearchItem[]> {
      const links = await native.quicklinkList(query, 20);
      const now = new Date();
      return links.map((ql) => {
        const arg = deriveQuicklinkArg(query, ql);
        const resolved = resolveTemplate(ql.target, { query: arg, now }).text;
        const web = isWebTarget(resolved);
        return {
          id: `quicklink.${ql.id}`,
          title: ql.title,
          subtitle: `${ql.alias ? `⚡ ${ql.alias} · ` : ''}${resolved}`,
          category: 'Quicklinks',
          source: 'quicklink' as const,
          icon: { kind: 'builtin' as const, name: 'link' },
          confidence: 0.65,
          primaryAction: {
            id: `quicklink.${ql.id}.open`,
            title: web ? 'Open Link' : 'Open',
            run: web
              ? { kind: 'open-url' as const, url: resolved }
              : { kind: 'open-path' as const, path: resolved },
          },
          secondaryActions: [
            {
              id: `quicklink.${ql.id}.copy`,
              title: 'Copy Target',
              run: { kind: 'copy' as const, text: resolved },
            },
          ],
        };
      });
    },
  };
}

/** Human-readable file size for a subtitle. */
function formatSize(bytes: number): string {
  if (bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/**
 * Local file-search provider. Queries the native file index (metadata only).
 * Gated to ≥3 characters and to the Tauri shell so it never blocks instant
 * results or runs in browser preview; the orchestrator runs it concurrently with
 * a per-provider timeout, so a large index can't stall apps/commands.
 */
export function createFileProvider(): SearchProvider {
  return {
    id: 'files',
    source: 'file',
    canHandle: (q) => native.isTauri() && q.trim().length >= 3,
    async search(query): Promise<SearchItem[]> {
      const files = await native.fileSearch(query, { limit: 30 });
      return files.map((f) => {
        const isDir = f.kind === 'dir';
        const meta = [isDir ? 'Folder' : f.ext ? f.ext.toUpperCase() : 'File', formatSize(f.size)]
          .filter(Boolean)
          .join(' · ');
        return {
          id: `file.${f.path}`,
          title: f.name,
          subtitle: `${meta} — ${f.parent}`,
          category: isDir ? 'Folders' : 'Files',
          source: 'file' as const,
          icon: { kind: 'builtin' as const, name: isDir ? 'folder' : 'file' },
          confidence: 0.5,
          primaryAction: {
            id: `file.${f.path}.open`,
            title: isDir ? 'Open Folder' : 'Open',
            run: { kind: 'open-path' as const, path: f.path },
            requires: ['files.read' as const],
          },
          secondaryActions: [
            {
              id: `file.${f.path}.reveal`,
              title: 'Reveal in File Manager',
              run: { kind: 'reveal-path' as const, path: f.path },
            },
            {
              id: `file.${f.path}.copy-path`,
              title: 'Copy Path',
              run: { kind: 'copy' as const, text: f.path },
            },
          ],
        };
      });
    },
  };
}

/**
 * Extension command provider. Surfaces commands from installed, enabled,
 * non-crashed extensions in Root Search (matched/ranked by title + keywords).
 * A `no-view` command runs in its child process (effects brokered natively); a
 * `list` command opens a dedicated view that streams its items.
 */
export function createExtensionProvider(
  getCommands: () => ReadonlyArray<native.ExtCommandInfo>,
): SearchProvider {
  return {
    id: 'extensions',
    source: 'extension',
    canHandle: () => native.isTauri(),
    async search(): Promise<SearchItem[]> {
      return getCommands().map((c) => {
        const isList = c.mode === 'list';
        return {
          id: `ext.${c.ext_id}.${c.command}`,
          title: c.title,
          subtitle: c.description ? `${c.ext_title} · ${c.description}` : c.ext_title,
          keywords: c.keywords,
          category: c.ext_title,
          source: 'extension' as const,
          icon: { kind: 'builtin' as const, name: 'puzzle' },
          confidence: 0.55,
          primaryAction: {
            id: `ext.${c.ext_id}.${c.command}.run`,
            title: isList ? 'Open' : 'Run',
            run: isList
              ? {
                  kind: 'push-view' as const,
                  viewId: 'extension-list',
                  args: { id: `${c.ext_id}::${c.command}` },
                }
              : { kind: 'run-extension' as const, extId: c.ext_id, command: c.command },
          },
        };
      });
    },
  };
}

/** Cryptographically secure float in [0, 1) for password generation. */
function secureRandom(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! / 2 ** 32;
}

function toolItem(
  id: string,
  title: string,
  subtitle: string,
  copy: string,
  keyword: string,
): SearchItem {
  return {
    id,
    title,
    subtitle,
    keywords: [keyword],
    category: 'Tools',
    source: 'system' as const,
    icon: { kind: 'builtin' as const, name: 'tool' },
    confidence: 0.9,
    primaryAction: {
      id: `${id}.copy`,
      title: 'Copy',
      run: { kind: 'copy' as const, text: copy },
    },
  };
}

/**
 * Built-in developer tools surfaced as instant results: UUID, secure password,
 * colour conversion (#hex / rgb()), and JSON formatting (`json {…}`). All compute
 * locally and synchronously; the primary action copies the result.
 */
export function createToolsProvider(): SearchProvider {
  return {
    id: 'tools',
    source: 'system',
    canHandle: (q) => q.trim().length >= 2,
    async search(query): Promise<SearchItem[]> {
      const q = query.trim();
      const lower = q.toLowerCase();
      const items: SearchItem[] = [];

      if (lower === 'uuid' || lower === 'guid') {
        const id = crypto.randomUUID();
        items.push(toolItem('tool.uuid', id, 'Generated UUID v4 — Enter to copy', id, q));
      }

      const pw = /^(password|pw|pass)(?:\s+(\d{1,3}))?$/.exec(lower);
      if (pw) {
        const length = pw[2] ? Number(pw[2]) : DEFAULT_PASSWORD_OPTIONS.length;
        const value = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length }, secureRandom);
        items.push(
          toolItem('tool.password', value, `Secure ${value.length}-char password`, value, q),
        );
      }

      const colors = colorConversions(q);
      if (colors) {
        items.push(toolItem('tool.color.hex', colors.hex, `HEX · ${colors.rgb}`, colors.hex, q));
        items.push(toolItem('tool.color.rgb', colors.rgb, `RGB · ${colors.hsl}`, colors.rgb, q));
        items.push(toolItem('tool.color.hsl', colors.hsl, `HSL · ${colors.hex}`, colors.hsl, q));
      }

      const jsonMatch = /^json\s+([\s\S]+)$/i.exec(q);
      if (jsonMatch) {
        const result = formatJson(jsonMatch[1]!);
        if (result.ok) {
          const preview = result.text.replace(/\s+/g, ' ').slice(0, 80);
          items.push(toolItem('tool.json', 'Format JSON', preview, result.text, q));
        } else {
          items.push({
            id: 'tool.json.error',
            title: 'Invalid JSON',
            subtitle: result.error,
            keywords: [q],
            category: 'Tools',
            source: 'system' as const,
            icon: { kind: 'builtin' as const, name: 'tool' },
            confidence: 0.9,
            primaryAction: { id: 'tool.json.noop', title: 'OK', run: { kind: 'copy', text: '' } },
          });
        }
      }

      return items;
    },
  };
}

/**
 * Calculator provider. Returns a single high-confidence result when the query
 * parses as a calculation, otherwise nothing (so it never pollutes results).
 */
export function createCalculatorProvider(): SearchProvider {
  return {
    id: 'calculator',
    source: 'calculator',
    canHandle: (q) => /\d/.test(q) || /\bin\b|\bto\b|%|of/.test(q),
    async search(query): Promise<SearchItem[]> {
      const result = calculate(query, { rates: FALLBACK_RATES });
      if (!result) return [];
      const value = String(result.value);
      const display = result.formatted;
      return [
        {
          id: 'calc.result',
          title: display,
          subtitle: result.expression + (result.stale ? '  ·  rates may be out of date' : ''),
          // The result text never matches the typed query, so carry the query
          // as a keyword to keep the item in the ranked set and at the top.
          keywords: [query],
          category: 'Calculator',
          source: 'calculator' as const,
          icon: { kind: 'builtin' as const, name: 'calculator' },
          // Calculator results are near-certain; rank at the top.
          confidence: 1,
          primaryAction: {
            id: 'calc.copy',
            title: 'Copy Result',
            run: { kind: 'copy' as const, text: display },
          },
          secondaryActions: [
            {
              id: 'calc.copy-value',
              title: 'Copy Value',
              run: { kind: 'copy' as const, text: value },
            },
            {
              id: 'calc.copy-equation',
              title: 'Copy Equation',
              run: { kind: 'copy' as const, text: `${result.expression} = ${display}` },
            },
          ],
        },
      ];
    },
  };
}
