/**
 * Map discovered MCP tools onto canonical `ToolRecord`s.
 *
 * MCP tool annotations are *hints from the server*, i.e. untrusted. We use them
 * only to *raise* caution, never to lower it: a tool that doesn't clearly mark
 * itself read-only is treated as having side effects and is gated. This keeps
 * the default safe (spec §13.4) — an unknown third-party tool can't slip
 * through as "safe" by simply omitting annotations.
 */
import { approvalScopesFor, deriveRisk, requiresConfirmation } from '../policy.js';
import {
  type ToolInputSchema,
  type ToolPropertySchema,
  type ToolRecord,
  type ToolSideEffect,
} from '../types.js';
import type { McpToolDescriptor } from './protocol.js';

const ALLOWED_PROP_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array']);

/** Coerce an untrusted JSON-schema-ish object into our minimal ToolInputSchema. */
export function sanitizeSchema(raw: Readonly<Record<string, unknown>> | undefined): ToolInputSchema {
  const props: Record<string, ToolPropertySchema> = {};
  const rawProps =
    raw && typeof raw['properties'] === 'object' && raw['properties'] !== null
      ? (raw['properties'] as Record<string, unknown>)
      : {};
  for (const [key, value] of Object.entries(rawProps)) {
    const v = value as Record<string, unknown> | null;
    const type = v && typeof v['type'] === 'string' ? v['type'] : 'string';
    const safeType = ALLOWED_PROP_TYPES.has(type) ? (type as ToolPropertySchema['type']) : 'string';
    const description = v && typeof v['description'] === 'string' ? v['description'] : undefined;
    const enumValues =
      v && Array.isArray(v['enum'])
        ? v['enum'].filter((e): e is string | number => typeof e === 'string' || typeof e === 'number')
        : undefined;
    props[key] = {
      type: safeType,
      ...(description ? { description } : {}),
      ...(enumValues && enumValues.length > 0 ? { enum: enumValues } : {}),
    };
  }
  const required =
    raw && Array.isArray(raw['required'])
      ? raw['required'].filter((r): r is string => typeof r === 'string')
      : undefined;
  return {
    type: 'object',
    properties: props,
    ...(required && required.length > 0 ? { required } : {}),
  };
}

/**
 * Infer side effects from a tool's annotations + name. Conservative: anything
 * not explicitly read-only is assumed to potentially write; "open world" tools
 * add network; destructive tools add deletion.
 */
export function inferSideEffects(
  tool: McpToolDescriptor,
  trustReadOnlyHint = false,
): ToolSideEffect[] {
  const a = tool.annotations ?? {};
  const effects = new Set<ToolSideEffect>();
  // Tokenise on non-alphanumerics so snake_case / kebab-case / paths split too
  // (a word-boundary regex won't split on "_", which is a word character).
  const tokens = new Set(tool.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const has = (...words: string[]) => words.some((w) => tokens.has(w));

  if (a.openWorldHint) effects.add('network');
  if (a.destructiveHint) effects.add('delete-file');

  // Name-based escalation for common dangerous verbs (untrusted hint, raise only).
  if (has('delete', 'remove', 'rm', 'drop', 'destroy')) effects.add('delete-file');
  if (has('deploy', 'release', 'publish')) effects.add('deploy');
  if (has('send', 'email', 'message', 'post', 'notify')) effects.add('send-message');
  if (has('exec', 'run', 'shell', 'command', 'spawn')) effects.add('run-command');
  if (has('push')) effects.add('git-push');
  if (has('pay', 'charge', 'purchase', 'buy', 'spend')) effects.add('spend');
  if (has('write', 'create', 'update', 'edit', 'set', 'save', 'patch')) effects.add('write-file');

  if (effects.size === 0) {
    // A server annotation is untrusted by default and therefore cannot lower
    // risk. Only a caller-owned, explicitly trusted catalogue may opt into
    // accepting readOnlyHint. Everything else is conservatively gated.
    effects.add(trustReadOnlyHint && a.readOnlyHint === true ? 'read' : 'write-file');
  }
  return [...effects];
}

export interface McpToolMapOptions {
  /** Restrict to these tool names (the server's allowlist), if provided. */
  readonly allowlist?: readonly string[];
  readonly projectScope?: readonly string[];
  readonly availability?: ToolRecord['availability'];
  readonly health?: ToolRecord['health'];
  /** Only for caller-owned catalogues; never enable for arbitrary servers. */
  readonly trustReadOnlyHint?: boolean;
}

/** Build a ToolRecord for one MCP tool. */
export function mcpToolToRecord(
  serverId: string,
  tool: McpToolDescriptor,
  options: McpToolMapOptions = {},
): ToolRecord {
  const sideEffects = inferSideEffects(tool, options.trustReadOnlyHint === true);
  const risk = deriveRisk(sideEffects);
  return {
    id: `mcp:${serverId}:${tool.name}`,
    name: tool.name,
    title: tool.annotations?.title ?? tool.name,
    description: tool.description ?? '',
    source: 'mcp',
    serverId,
    inputSchema: sanitizeSchema(tool.inputSchema),
    risk,
    sideEffects,
    requiresConfirmation: requiresConfirmation(sideEffects, risk),
    approvalScopes: approvalScopesFor(risk),
    ...(options.projectScope ? { projectScope: options.projectScope } : {}),
    availability: options.availability ?? 'available',
    health: options.health ?? 'healthy',
  };
}

/** Map a server's tool list, honouring an optional allowlist. */
export function mcpToolsToRecords(
  serverId: string,
  tools: readonly McpToolDescriptor[],
  options: McpToolMapOptions = {},
): ToolRecord[] {
  const allow = options.allowlist ? new Set(options.allowlist) : null;
  return tools.filter((t) => !allow || allow.has(t.name)).map((t) => mcpToolToRecord(serverId, t, options));
}
