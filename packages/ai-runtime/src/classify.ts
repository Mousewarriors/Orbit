/**
 * AI-assisted intent classification — the deterministic-first fallback.
 *
 * Only used when the deterministic recogniser cannot resolve a request. The
 * model is constrained to emit *structured* data: a single intent from the
 * known set plus whitelisted slots. We then validate that output hard — any
 * unknown intent, extra field, or wrong-typed slot is dropped — so the model can
 * never introduce an action, argument, path or command Orbit doesn't already
 * understand. The result is an ordinary RecognisedIntent the existing safe
 * pipeline resolves and (where consequential) confirms.
 */
import {
  ALL_AGENT_PREFERENCES,
  ALL_INTENTS,
  intentRequiresConfirmation,
  isIntentName,
  type AgentPreference,
  type IntentSlots,
  type RecognisedIntent,
} from '@orbit/intent';
import type { AiMessage, AiProvider } from './types.js';

/** Confidence assigned to an AI-classified intent (below deterministic hits). */
export const AI_CLASSIFICATION_CONFIDENCE = 0.55;

const MAX_SLOT_LEN = 200;

/** Build the constrained classification prompt for `query`. */
export function buildClassificationPrompt(query: string): AiMessage[] {
  const system = [
    'You translate a user request into a single structured Orbit intent.',
    'Respond with ONLY a JSON object, no prose, no code fences.',
    'Shape: {"intent": <one of the allowed intents or "none">, "slots": { ... }}.',
    `Allowed intents: ${ALL_INTENTS.join(', ')}.`,
    'Allowed slots (include only those that apply): projectQuery, applicationQuery,',
    'fileQuery, noteQuery, agentPreference, includeLatestHandoff, question.',
    `agentPreference must be one of: ${ALL_AGENT_PREFERENCES.join(', ')}.`,
    'If the request is not one of the allowed intents, respond {"intent":"none"}.',
    'Never invent commands, file paths, shell arguments or fields.',
  ].join(' ');
  return [
    { role: 'system', content: system },
    { role: 'user', content: query },
  ];
}

/** Extract the first JSON object from a model response (tolerating fences). */
function extractJson(text: string): unknown {
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

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim().slice(0, MAX_SLOT_LEN);
  return t.length > 0 ? t : undefined;
}

function cleanAgent(value: unknown): AgentPreference | undefined {
  return typeof value === 'string' && (ALL_AGENT_PREFERENCES as readonly string[]).includes(value)
    ? (value as AgentPreference)
    : undefined;
}

/** Build a validated slots object, dropping anything unrecognised. */
function validateSlots(raw: unknown): IntentSlots {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const projectQuery = cleanString(obj['projectQuery']);
  const applicationQuery = cleanString(obj['applicationQuery']);
  const fileQuery = cleanString(obj['fileQuery']);
  const noteQuery = cleanString(obj['noteQuery']);
  const question = cleanString(obj['question']);
  const agentPreference = cleanAgent(obj['agentPreference']);
  return {
    ...(projectQuery ? { projectQuery } : {}),
    ...(applicationQuery ? { applicationQuery } : {}),
    ...(fileQuery ? { fileQuery } : {}),
    ...(noteQuery ? { noteQuery } : {}),
    ...(question ? { question } : {}),
    ...(agentPreference ? { agentPreference } : {}),
    ...(obj['includeLatestHandoff'] === true ? { includeLatestHandoff: true } : {}),
  };
}

/**
 * Parse + hard-validate a model's classification response into a
 * RecognisedIntent, or null when the model declined / produced an unknown
 * intent. The returned intent carries a lower confidence and `matchedRule:
 * 'ai-classifier'` so callers and diagnostics know it wasn't deterministic.
 */
export function parseClassification(text: string): RecognisedIntent | null {
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (!isIntentName(obj['intent'])) return null;
  const intent = obj['intent'];
  return {
    intent,
    slots: validateSlots(obj['slots']),
    confidence: AI_CLASSIFICATION_CONFIDENCE,
    requiresConfirmation: intentRequiresConfirmation(intent),
    matchedRule: 'ai-classifier',
  };
}

/**
 * Classify `query` with a provider when deterministic recognition failed. The
 * model output is validated before it is trusted. Returns null on a decline,
 * an unparseable/invalid response — callers treat null as "no AI suggestion".
 */
export async function classifyWithAi(
  query: string,
  provider: AiProvider,
  signal?: AbortSignal,
): Promise<RecognisedIntent | null> {
  const response = await provider.complete(
    { messages: buildClassificationPrompt(query), temperature: 0, json: true },
    signal,
  );
  return parseClassification(response.content);
}
