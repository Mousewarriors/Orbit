import { collectRequiredInputs, parseTemplate, type TemplateNode } from './parse.js';
import { formatDate } from './datefmt.js';

/**
 * Runtime context supplied by the native layer when expanding a template.
 * Everything is optional; an unavailable source resolves to an empty string and
 * is reported in `missing` so the UI can warn (e.g. "no text was selected").
 */
export interface ResolveContext {
  readonly query?: string;
  readonly clipboard?: string;
  readonly selection?: string;
  readonly appName?: string;
  readonly browserUrl?: string;
  readonly browserTitle?: string;
  readonly now?: Date;
  /** Values for {input:Label} / {choice:...} keyed as in collectRequiredInputs. */
  readonly inputs?: Readonly<Record<string, string>>;
  /** Deterministic UUID generator override (for tests). */
  readonly uuid?: () => string;
  /** Default date format when {date} has no argument. */
  readonly dateFormat?: string;
  readonly timeFormat?: string;
}

export interface ResolveResult {
  readonly text: string;
  /** Character offset of {cursor}, or null if absent. */
  readonly cursor: number | null;
  /** Placeholder names that had no available value. */
  readonly missing: ReadonlyArray<string>;
}

function defaultUuid(): string {
  // RFC 4122 v4 using crypto when available.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback (non-crypto) — adequate for non-secret template values.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function resolveNode(
  node: Extract<TemplateNode, { kind: 'placeholder' }>,
  ctx: ResolveContext,
  state: { cursor: number | null; offset: number; missing: Set<string> },
): string {
  const now = ctx.now ?? new Date();
  const need = (value: string | undefined, label: string): string => {
    if (value == null || value === '') {
      state.missing.add(label);
      return '';
    }
    return value;
  };

  switch (node.name) {
    case 'query':
    case 'argument':
      return need(ctx.query, 'query');
    case 'clipboard':
      return need(ctx.clipboard, 'clipboard');
    case 'selection':
    case 'selected':
      return need(ctx.selection, 'selection');
    case 'app':
    case 'application':
      return need(ctx.appName, 'app');
    case 'browser-url':
    case 'url':
      return need(ctx.browserUrl, 'browser-url');
    case 'browser-title':
    case 'title':
      return need(ctx.browserTitle, 'browser-title');
    case 'uuid':
      return (ctx.uuid ?? defaultUuid)();
    case 'date':
      return formatDate(now, node.arg ?? ctx.dateFormat ?? 'yyyy-MM-dd');
    case 'time':
      return formatDate(now, node.arg ?? ctx.timeFormat ?? 'HH:mm');
    case 'datetime':
      return formatDate(now, node.arg ?? 'yyyy-MM-dd HH:mm');
    case 'cursor':
      state.cursor = state.offset;
      return '';
    case 'input': {
      const key = `input:${node.arg ?? ''}`;
      return need(ctx.inputs?.[key], key);
    }
    case 'choice': {
      const key = `choice:${node.arg ?? ''}`;
      const chosen = ctx.inputs?.[key];
      if (chosen != null && chosen !== '') return chosen;
      // Default to the first choice if none supplied.
      const first = (node.arg ?? '').split(',')[0]?.trim();
      return first ?? need(undefined, key);
    }
    default:
      // Unknown placeholder: leave its raw form so the user can see the typo.
      state.missing.add(node.name);
      return `{${node.raw}}`;
  }
}

/** Expand a template against a runtime context. */
export function resolveTemplate(template: string, ctx: ResolveContext = {}): ResolveResult {
  const nodes = parseTemplate(template);
  const state = { cursor: null as number | null, offset: 0, missing: new Set<string>() };
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'literal') {
      out += node.text;
      state.offset += node.text.length;
    } else {
      const resolved = resolveNode(node, ctx, state);
      out += resolved;
      state.offset += resolved.length;
    }
  }
  return { text: out, cursor: state.cursor, missing: [...state.missing] };
}

export { parseTemplate, collectRequiredInputs, formatDate };
