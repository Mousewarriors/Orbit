/**
 * Parse + hard-validate a model's mission plan.
 *
 * The model is asked for JSON of the shape `{ steps: [{ tool, args, rationale }],
 * summary }`. We reject anything that doesn't reference a real registry tool id,
 * validate every step's arguments against that tool's schema, drop invalid
 * steps, clamp the rationale/summary and cap the step count. The result is a
 * `MissionPlan` the same executor runs for deterministic plans — the model can
 * only ever point at existing safe tools with valid arguments.
 */
import { MAX_MISSION_STEPS, MAX_RATIONALE_LEN, type MissionPlan, type MissionStep } from './types.js';
import { toValidStep, type ToolLookup } from './plan.js';

/** Extract the first JSON object from a model response (tolerating fences). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Validate one raw step object against the registry. A step must carry a string
 * `tool` (id) and an object `args`; everything else is dropped.
 */
export function validateRawStep(raw: unknown, registry: ToolLookup): MissionStep | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const toolId = typeof obj['tool'] === 'string' ? obj['tool'] : null;
  if (!toolId) return null;
  const args = asRecord(obj['args']) ?? {};
  const rationale = typeof obj['rationale'] === 'string' ? obj['rationale'] : undefined;
  return toValidStep(toolId, args, registry, rationale);
}

/**
 * Parse a model response into a validated MissionPlan, or null when nothing
 * usable survives. Invalid steps are dropped, not fatal — but a plan with zero
 * valid steps returns null (the caller shows an honest "couldn't plan" state).
 */
export function parseMissionPlan(
  text: string,
  goal: string,
  registry: ToolLookup,
): MissionPlan | null {
  const parsed = asRecord(extractJson(text));
  if (!parsed) return null;
  const rawSteps = Array.isArray(parsed['steps']) ? parsed['steps'] : [];
  const steps: MissionStep[] = [];
  for (const raw of rawSteps) {
    if (steps.length >= MAX_MISSION_STEPS) break;
    const step = validateRawStep(raw, registry);
    if (step) steps.push(step);
  }
  if (steps.length === 0) return null;
  const summaryRaw = typeof parsed['summary'] === 'string' ? parsed['summary'].trim() : '';
  const summary = summaryRaw.slice(0, MAX_RATIONALE_LEN);
  return { goal, steps, source: 'ai', ...(summary ? { summary } : {}) };
}
