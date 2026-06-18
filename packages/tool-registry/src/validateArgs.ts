/**
 * Validate tool-call arguments against a `ToolInputSchema`.
 *
 * Used at the choke-point before *any* tool runs (native or MCP), so a planner
 * or model can never pass a missing/ill-typed/unknown argument into a tool.
 * Returns a cleaned argument object containing only declared properties.
 */
import type { ToolInputSchema, ToolPropertySchema } from './types.js';

export interface ArgValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** Only declared, correctly-typed properties survive. */
  readonly cleaned: Readonly<Record<string, unknown>>;
}

function typeOk(value: unknown, type: ToolPropertySchema['type']): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
}

export function validateArgs(
  schema: ToolInputSchema,
  args: Readonly<Record<string, unknown>>,
): ArgValidation {
  const errors: string[] = [];
  const cleaned: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const value = args[key];
    if (value === undefined) continue;
    if (!typeOk(value, prop.type)) {
      errors.push(`"${key}" must be ${prop.type}`);
      continue;
    }
    if (prop.enum && !prop.enum.includes(value as string | number)) {
      errors.push(`"${key}" must be one of: ${prop.enum.join(', ')}`);
      continue;
    }
    cleaned[key] = value;
  }
  for (const key of schema.required ?? []) {
    if (cleaned[key] === undefined) errors.push(`"${key}" is required`);
  }
  return { ok: errors.length === 0, errors, cleaned };
}
