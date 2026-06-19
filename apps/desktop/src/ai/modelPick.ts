/**
 * Pick a sensible default model from a provider's available list.
 *
 * Two needs: (1) a valid, *pulled* model id (the configured default like
 * "llama3.1" may resolve to a tag the user hasn't pulled), and (2) when tool-use
 * is on, a model whose family actually supports function-calling (the original
 * llama3, gemma, phi etc. do not — Ollama rejects tool requests for them).
 */

/** Families known to support tool-calling in Ollama / OpenAI-compatible servers. */
const TOOL_FAMILIES =
  /(llama-?3\.[1-9]|llama-?3\.\d|qwen2\.5|qwen3|qwen2_5|mistral-nemo|mistral-small|mixtral|firefunction|command-?r|hermes|gpt-oss|granite3|deepseek-r1|deepseek-v3|cogito|smollm2|llama4|gpt-4|gpt-3\.5)/i;

export function isLikelyToolModel(id: string): boolean {
  return TOOL_FAMILIES.test(id);
}

/** The first tool-capable model in the list, or null. */
export function pickToolModel(models: readonly { id: string }[]): string | null {
  return models.find((m) => isLikelyToolModel(m.id))?.id ?? null;
}

/**
 * Choose a default model id. When `preferTools`, prefer a tool-capable one and
 * only fall back to the first model if none qualifies. Returns null for an empty
 * list (the caller then lets the provider use its own default).
 */
export function pickDefaultModel(
  models: readonly { id: string }[],
  preferTools: boolean,
): string | null {
  if (preferTools) {
    const tool = pickToolModel(models);
    if (tool) return tool;
  }
  return models[0]?.id ?? null;
}
