/**
 * Template parser for snippet & Quicklink dynamic placeholders.
 *
 * Syntax:
 *   {name}                 simple placeholder
 *   {name|arg}             placeholder with a single argument (e.g. date format)
 *   {input:Label}          prompts the user for a value at expansion time
 *   {choice:a,b,c}         offers a fixed set of choices
 *   {{ and }}              literal braces
 *
 * Parsing is separate from resolution so the editor can validate templates and
 * surface required inputs/choices without a runtime context.
 */

export type TemplateNode =
  | { readonly kind: 'literal'; readonly text: string }
  | {
      readonly kind: 'placeholder';
      readonly name: string;
      readonly arg?: string;
      /** Raw source for diagnostics / round-tripping. */
      readonly raw: string;
    };

export class TemplateError extends Error {}

export function parseTemplate(template: string): TemplateNode[] {
  const nodes: TemplateNode[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf.length > 0) {
      nodes.push({ kind: 'literal', text: buf });
      buf = '';
    }
  };

  while (i < template.length) {
    const ch = template[i]!;
    const next = template[i + 1];

    if (ch === '{' && next === '{') {
      buf += '{';
      i += 2;
      continue;
    }
    if (ch === '}' && next === '}') {
      buf += '}';
      i += 2;
      continue;
    }
    if (ch === '{') {
      const end = template.indexOf('}', i + 1);
      if (end === -1) throw new TemplateError(`Unclosed placeholder at position ${i}`);
      const inner = template.slice(i + 1, end).trim();
      if (inner.length === 0) throw new TemplateError(`Empty placeholder at position ${i}`);
      flush();

      // Split on the FIRST ':' (input/choice prefix) or '|' (argument).
      let name = inner;
      let arg: string | undefined;
      const colon = inner.indexOf(':');
      const pipe = inner.indexOf('|');
      const sep = colon !== -1 && (pipe === -1 || colon < pipe) ? colon : pipe;
      if (sep !== -1) {
        name = inner.slice(0, sep).trim();
        arg = inner.slice(sep + 1).trim();
      }
      nodes.push(
        arg !== undefined
          ? { kind: 'placeholder', name: name.toLowerCase(), arg, raw: inner }
          : { kind: 'placeholder', name: name.toLowerCase(), raw: inner },
      );
      i = end + 1;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return nodes;
}

/** Collect the user-facing inputs a template requires before expansion. */
export interface RequiredInput {
  readonly key: string;
  readonly label: string;
  readonly kind: 'text' | 'choice';
  readonly choices?: ReadonlyArray<string>;
}

export function collectRequiredInputs(nodes: ReadonlyArray<TemplateNode>): RequiredInput[] {
  const inputs: RequiredInput[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== 'placeholder') continue;
    if (node.name === 'input' && node.arg) {
      const key = `input:${node.arg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      inputs.push({ key, label: node.arg, kind: 'text' });
    } else if (node.name === 'choice' && node.arg) {
      const key = `choice:${node.arg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const choices = node.arg.split(',').map((c) => c.trim()).filter(Boolean);
      inputs.push({ key, label: node.arg, kind: 'choice', choices });
    }
  }
  return inputs;
}
