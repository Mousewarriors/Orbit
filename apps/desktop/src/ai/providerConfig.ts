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
  OpenAiCompatProvider,
  type AiProvider,
  type FetchLike,
} from '@orbit/ai-runtime';

export type ConfiguredProviderId = 'none' | 'mock' | 'ollama' | 'openai-compat';

export interface AiSettings {
  readonly provider: ConfiguredProviderId;
  readonly ollamaEndpoint: string;
  readonly ollamaModel: string;
  /** OpenAI-compatible base URL (incl. version path), e.g. https://api.openai.com/v1 */
  readonly cloudBaseUrl?: string;
  readonly cloudModel?: string;
  /** Resolved from OS secure storage by the caller; never persisted in settings. */
  readonly cloudApiKey?: string;
}

const DEFAULT_CLOUD_BASE = 'https://api.openai.com/v1';
const DEFAULT_CLOUD_MODEL = 'gpt-4o-mini';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'none',
  ollamaEndpoint: 'http://127.0.0.1:11434',
  ollamaModel: 'llama3.1',
  cloudBaseUrl: DEFAULT_CLOUD_BASE,
  cloudModel: DEFAULT_CLOUD_MODEL,
};

export const AI_SETTING_KEYS = {
  provider: 'ai.provider',
  endpoint: 'ai.ollama.endpoint',
  model: 'ai.ollama.model',
  cloudBase: 'ai.cloud.base',
  cloudModel: 'ai.cloud.model',
  recent: 'ai.recent',
} as const;

/** Secret name under which the cloud API key lives in OS secure storage. */
export const CLOUD_API_KEY_SECRET = 'ai.cloud.apikey';

function isProviderId(value: unknown): value is ConfiguredProviderId {
  return value === 'none' || value === 'mock' || value === 'ollama' || value === 'openai-compat';
}

/** Build typed AI settings from raw (possibly null) setting strings. */
export function parseAiSettings(values: {
  provider?: string | null;
  endpoint?: string | null;
  model?: string | null;
  cloudBase?: string | null;
  cloudModel?: string | null;
  cloudApiKey?: string | null;
}): AiSettings {
  return {
    provider: isProviderId(values.provider) ? values.provider : DEFAULT_AI_SETTINGS.provider,
    ollamaEndpoint: values.endpoint?.trim() || DEFAULT_AI_SETTINGS.ollamaEndpoint,
    ollamaModel: values.model?.trim() || DEFAULT_AI_SETTINGS.ollamaModel,
    cloudBaseUrl: values.cloudBase?.trim() || DEFAULT_CLOUD_BASE,
    cloudModel: values.cloudModel?.trim() || DEFAULT_CLOUD_MODEL,
    ...(values.cloudApiKey ? { cloudApiKey: values.cloudApiKey } : {}),
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
    case 'openai-compat': {
      const baseUrl = settings.cloudBaseUrl ?? DEFAULT_AI_SETTINGS.cloudBaseUrl!;
      const model = settings.cloudModel ?? DEFAULT_AI_SETTINGS.cloudModel!;
      const provider = new OpenAiCompatProvider({
        baseUrl,
        defaultModel: model,
        ...(settings.cloudApiKey ? { apiKey: settings.cloudApiKey } : {}),
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      });
      return {
        provider,
        label: `${provider.local ? 'Local' : 'Cloud'} · ${model}`,
        local: provider.local,
        configured: true,
      };
    }
    default:
      return { provider: null, label: 'No AI provider', local: true, configured: false };
  }
}
