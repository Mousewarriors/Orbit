/**
 * @orbit/ai-runtime — provider-agnostic AI completion foundation.
 *
 * Contracts + adapters (mock for offline/tests, Ollama for local models) and a
 * hard-validated AI intent classifier that acts only as the fallback after
 * deterministic recognition. Model selection (Auto mode) is the Model
 * Intelligence Gateway's job and is NOT implemented here.
 */
export * from './types.js';
export * from './mock.js';
export * from './ollama.js';
export * from './classify.js';
