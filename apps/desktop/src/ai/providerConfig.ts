/**
 * AI provider configuration for the desktop app.
 *
 * Pure factory that turns persisted settings into an active `AiProvider`, plus a
 * small `ProviderInfo` describing it for the UI (label, local-vs-remote,
 * whether anything is configured at all). Keeping this here — rather than in
 * @orbit/ai-runtime — lets it read Orbit's settings keys while staying
 * unit-testable (the factory takes an injected fetch).
 *
 * What is actually reachable today: the **Mock** provider (offline, clearly
 * synthetic) and **None**. The real **Ollama** adapter is constructed faithfully
 * but cannot be reached from the renderer yet (the Tauri CSP blocks direct
 * localhost HTTP and there is no native AI bridge command), so the Settings UI
 * does not offer it until that bridge lands. See docs/architecture/AI_RUNTIME.md.
 */
import {
  MockProvider,
  OllamaProvider,
  type AiProvider,
  type FetchLike,
} from '@orbit/ai-runtime';

export type ConfiguredProviderId = 'none' | 'mock' | 'ollama';

export interface AiSettings {
  readonly provider: ConfiguredProviderId;
  readonly ollamaEndpoint: string;
  readonly ollamaModel: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'none',
  ollamaEndpoint: 'http://127.0.0.1:11434',
  ollamaModel: 'llama3.1',
};

export const AI_SETTING_KEYS = {
  provider: 'ai.provider',
  endpoint: 'ai.ollama.endpoint',
  model: 'ai.ollama.model',
  recent: 'ai.recent',
} as const;

function isProviderId(value: unknown): value is ConfiguredProviderId {
  return value === 'none' || value === 'mock' || value === 'ollama';
}

/** Build typed AI settings from raw (possibly null) setting strings. */
export function parseAiSettings(values: {
  provider?: string | null;
  endpoint?: string | null;
  model?: string | null;
}): AiSettings {
  return {
    provider: isProviderId(values.provider) ? values.provider : DEFAULT_AI_SETTINGS.provider,
    ollamaEndpoint: values.endpoint?.trim() || DEFAULT_AI_SETTINGS.ollamaEndpoint,
    ollamaModel: values.model?.trim() || DEFAULT_AI_SETTINGS.ollamaModel,
  };
}

export interface ProviderInfo {
  /** The active provider, or null when none is configured. */
  readonly provider: AiProvider | null;
  /** Short human label, e.g. "Mock (offline demo)". */
  readonly label: string;
  /** Whether processing stays on-device. */
  readonly local: boolean;
  /** False for the "none" provider — the UI shows a configure prompt. */
  readonly configured: boolean;
}

/** A deterministic, obviously-synthetic reply so Mock is never mistaken for real. */
function mockReply(): string {
  return '[Mock AI] No real model is connected. This placeholder text confirms the Quick AI surface works end-to-end; configure a provider to get real answers.';
}

/** Construct the active provider (and its UI metadata) from settings. */
export function createProvider(settings: AiSettings, fetchImpl?: FetchLike): ProviderInfo {
  switch (settings.provider) {
    case 'mock':
      return {
        provider: new MockProvider({ reply: mockReply }),
        label: 'Mock (offline demo)',
        local: true,
        configured: true,
      };
    case 'ollama':
      return {
        provider: new OllamaProvider({
          baseUrl: settings.ollamaEndpoint,
          defaultModel: settings.ollamaModel,
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        }),
        label: `Local Ollama · ${settings.ollamaModel}`,
        local: true,
        configured: true,
      };
    default:
      return { provider: null, label: 'No AI provider', local: true, configured: false };
  }
}
