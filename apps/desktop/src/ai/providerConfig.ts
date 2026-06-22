/**
 * AI provider configuration for the desktop app.
 *
 * Pure factory that turns persisted settings into an active `AiProvider`, plus a
 * small `ProviderInfo` describing it for the UI (label, local-vs-remote,
 * whether anything is configured at all). Keeping this here — rather than in
 * @orbit/ai-runtime — lets it read Orbit's settings keys while staying
 * unit-testable (the factory takes an injected fetch).
 *
 * Two underlying engines are wired to real servers via the native HTTP bridge:
 * `ollama` (local *and* hosted Ollama Cloud) and `openai-compat` (OpenAI,
 * Anthropic's OpenAI-compatible endpoint, or any custom OpenAI-style server).
 * The UI never asks the user to hand-craft a URL: it offers named **presets**
 * (see `PROVIDER_PRESETS`) that auto-fill the endpoint + model and point the key
 * field at the right OS-secure-storage secret. The `mock` provider stays as a
 * clearly-synthetic offline placeholder.
 */
import {
  AnthropicProvider,
  MockProvider,
  OllamaProvider,
  OpenAiCompatProvider,
  OpenAiResponsesProvider,
  type AiProvider,
  type FetchLike,
  type OAuthProviderId,
} from '@orbit/ai-runtime';

export type ConfiguredProviderId =
  | 'none'
  | 'mock'
  | 'ollama'
  | 'openai-compat'
  | 'openai-responses'
  | 'anthropic';

export interface AiSettings {
  readonly provider: ConfiguredProviderId;
  readonly ollamaEndpoint: string;
  readonly ollamaModel: string;
  /** Bearer token for hosted Ollama (Ollama Cloud); resolved from secure storage. */
  readonly ollamaApiKey?: string;
  /** Cloud base URL — OpenAI-compatible /v1, Anthropic, or a Responses endpoint. */
  readonly cloudBaseUrl?: string;
  readonly cloudModel?: string;
  /** API key for the active cloud engine; resolved from OS secure storage. */
  readonly cloudApiKey?: string;
  /** OAuth subscription access token (Claude/Codex); resolved + refreshed by the caller. */
  readonly oauthToken?: string;
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
  /** The chosen preset id (UI convenience; engine is still in `provider`). */
  preset: 'ai.preset',
  endpoint: 'ai.ollama.endpoint',
  model: 'ai.ollama.model',
  cloudBase: 'ai.cloud.base',
  cloudModel: 'ai.cloud.model',
  recent: 'ai.recent',
  /** Confidence gate (0..1) for resolving a project name to an indexed folder. */
  folderConfidence: 'ai.folder_confidence',
} as const;

/**
 * Parse the stored folder-confidence setting (a 0..1 decimal string) into a
 * number, or undefined when unset/invalid so callers use the library default.
 */
export function parseFolderConfidence(raw: string | null | undefined): number | undefined {
  if (raw == null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

/** Secret names under which provider credentials live in OS secure storage. */
export const CLOUD_API_KEY_SECRET = 'ai.cloud.apikey';
export const OLLAMA_API_KEY_SECRET = 'ai.ollama.apikey';
export const ANTHROPIC_API_KEY_SECRET = 'ai.anthropic.apikey';

/** True when an endpoint is a loopback host (processing stays on-device). */
export function isLoopbackEndpoint(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Presets — the named choices the Settings dropdown offers. Each maps to one of
// the two real engines and carries everything the UI needs to "instantly link":
// the endpoint to fill in, a curated model list, and which secret holds the key.
// ---------------------------------------------------------------------------

export type ProviderPresetId =
  | 'none'
  | 'mock'
  | 'ollama-local'
  | 'ollama-cloud'
  | 'openai'
  | 'anthropic'
  | 'claude-subscription'
  | 'codex-subscription'
  | 'custom';

export interface PresetKeyInfo {
  /** Secret name in OS secure storage. */
  readonly secret: string;
  /** Human label for the key field, e.g. "OpenAI API key". */
  readonly label: string;
  /** Where to create the key. */
  readonly url: string;
  /** Short guidance shown under the field. */
  readonly hint: string;
}

export interface ProviderPreset {
  readonly id: ProviderPresetId;
  readonly label: string;
  readonly engine: ConfiguredProviderId;
  readonly local: boolean;
  /** Auto-filled endpoint (undefined for none/mock). */
  readonly baseUrl?: string;
  /** Curated model choices for the dropdown (may be empty → free text). */
  readonly models: readonly string[];
  readonly defaultModel?: string;
  /** Whether the user may edit the endpoint (true only for local / custom). */
  readonly editableEndpoint: boolean;
  /** Credential metadata, when the preset needs an API key. */
  readonly key?: PresetKeyInfo;
  /** OAuth provider id, when the preset signs in with a subscription instead. */
  readonly oauth?: OAuthProviderId;
  /** One-line description shown beneath the dropdown. */
  readonly blurb: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'none',
    label: 'None',
    engine: 'none',
    local: true,
    models: [],
    editableEndpoint: false,
    blurb: 'AI features are off until you pick a provider.',
  },
  {
    id: 'ollama-local',
    label: 'Ollama (Local)',
    engine: 'ollama',
    local: true,
    baseUrl: 'http://127.0.0.1:11434',
    models: [],
    defaultModel: 'llama3.1',
    editableEndpoint: true,
    blurb: 'Runs models on this machine via a local Ollama server — fully private, no key needed.',
  },
  {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    engine: 'ollama',
    local: false,
    baseUrl: 'https://ollama.com',
    models: ['gpt-oss:120b', 'gpt-oss:20b', 'deepseek-v3.1:671b', 'qwen3-coder:480b'],
    defaultModel: 'gpt-oss:120b',
    editableEndpoint: false,
    key: {
      secret: OLLAMA_API_KEY_SECRET,
      label: 'Ollama Cloud API key',
      url: 'https://ollama.com/settings/keys',
      hint: 'Create a key at ollama.com → Settings → Keys. Stored in OS secure storage.',
    },
    blurb: 'Hosted Ollama models — same API as local, with your Ollama Cloud key.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    engine: 'openai-compat',
    local: false,
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini', 'o3-mini'],
    defaultModel: 'gpt-4o-mini',
    editableEndpoint: false,
    key: {
      secret: CLOUD_API_KEY_SECRET,
      label: 'OpenAI API key',
      url: 'https://platform.openai.com/api-keys',
      hint: 'A platform API key (sk-…). This is billed per-token and is separate from a ChatGPT/Codex subscription.',
    },
    blurb: 'OpenAI Chat Completions with a platform API key.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude) — API key',
    engine: 'anthropic',
    local: false,
    baseUrl: 'https://api.anthropic.com',
    models: [
      'claude-sonnet-4-5',
      'claude-opus-4-1',
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
    ],
    defaultModel: 'claude-sonnet-4-5',
    editableEndpoint: false,
    key: {
      secret: ANTHROPIC_API_KEY_SECRET,
      label: 'Anthropic API key',
      url: 'https://console.anthropic.com/settings/keys',
      hint: 'A console API key (sk-ant-…) used against the native Messages API. Billed per-token; separate from a Claude.ai subscription.',
    },
    blurb: 'Claude models via Anthropic’s Messages API, with a console API key.',
  },
  {
    id: 'claude-subscription',
    label: 'Claude (Pro/Max subscription)',
    engine: 'anthropic',
    local: false,
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-sonnet-latest'],
    defaultModel: 'claude-sonnet-4-5',
    editableEndpoint: false,
    oauth: 'anthropic-claude',
    blurb: 'Use a Claude Pro/Max plan via browser sign-in (experimental). Sign in below.',
  },
  {
    id: 'codex-subscription',
    label: 'ChatGPT / Codex (subscription)',
    engine: 'openai-responses',
    local: false,
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5-codex', 'gpt-5', 'gpt-4o', 'o4-mini'],
    defaultModel: 'gpt-5-codex',
    editableEndpoint: true,
    oauth: 'openai-codex',
    blurb: 'Use a ChatGPT/Codex plan via browser sign-in (experimental). Sign in below.',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    engine: 'openai-compat',
    local: false,
    baseUrl: 'https://api.openai.com/v1',
    models: [],
    editableEndpoint: true,
    key: {
      secret: CLOUD_API_KEY_SECRET,
      label: 'API key (optional)',
      url: 'https://platform.openai.com/api-keys',
      hint: 'Any OpenAI-compatible /v1 server (OpenRouter, LM Studio, vLLM…). Key optional for local servers.',
    },
    blurb: 'Point Orbit at any OpenAI-compatible /v1 endpoint.',
  },
  {
    id: 'mock',
    label: 'Mock (offline demo)',
    engine: 'mock',
    local: true,
    models: [],
    editableEndpoint: false,
    blurb: 'A clearly-synthetic placeholder that proves the AI surfaces work end-to-end. No real answers.',
  },
];

export function presetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/**
 * Best-effort mapping of persisted engine + endpoint back to a preset id, used
 * when no explicit `ai.preset` is stored (e.g. upgraded installs). Falls back to
 * the most specific match.
 */
export function resolvePresetId(engine: string, endpoint: string): ProviderPresetId {
  switch (engine) {
    case 'mock':
      return 'mock';
    case 'ollama':
      return isLoopbackEndpoint(endpoint) ? 'ollama-local' : 'ollama-cloud';
    case 'anthropic':
      return 'anthropic';
    case 'openai-responses':
      return 'codex-subscription';
    case 'openai-compat': {
      let host = '';
      try {
        host = new URL(endpoint).hostname;
      } catch {
        /* keep empty */
      }
      if (host === 'api.openai.com') return 'openai';
      return 'custom';
    }
    default:
      return 'none';
  }
}

function isProviderId(value: unknown): value is ConfiguredProviderId {
  return (
    value === 'none' ||
    value === 'mock' ||
    value === 'ollama' ||
    value === 'openai-compat' ||
    value === 'openai-responses' ||
    value === 'anthropic'
  );
}

/** Build typed AI settings from raw (possibly null) setting strings. */
export function parseAiSettings(values: {
  provider?: string | null;
  endpoint?: string | null;
  model?: string | null;
  ollamaApiKey?: string | null;
  cloudBase?: string | null;
  cloudModel?: string | null;
  cloudApiKey?: string | null;
  oauthToken?: string | null;
}): AiSettings {
  return {
    provider: isProviderId(values.provider) ? values.provider : DEFAULT_AI_SETTINGS.provider,
    ollamaEndpoint: values.endpoint?.trim() || DEFAULT_AI_SETTINGS.ollamaEndpoint,
    ollamaModel: values.model?.trim() || DEFAULT_AI_SETTINGS.ollamaModel,
    cloudBaseUrl: values.cloudBase?.trim() || DEFAULT_CLOUD_BASE,
    cloudModel: values.cloudModel?.trim() || DEFAULT_CLOUD_MODEL,
    ...(values.ollamaApiKey ? { ollamaApiKey: values.ollamaApiKey } : {}),
    ...(values.cloudApiKey ? { cloudApiKey: values.cloudApiKey } : {}),
    ...(values.oauthToken ? { oauthToken: values.oauthToken } : {}),
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
    case 'ollama': {
      const local = isLoopbackEndpoint(settings.ollamaEndpoint);
      return {
        provider: new OllamaProvider({
          baseUrl: settings.ollamaEndpoint,
          defaultModel: settings.ollamaModel,
          ...(settings.ollamaApiKey ? { apiKey: settings.ollamaApiKey } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        }),
        label: `${local ? 'Local Ollama' : 'Ollama Cloud'} · ${settings.ollamaModel}`,
        local,
        configured: true,
      };
    }
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
    case 'anthropic': {
      const model = settings.cloudModel ?? 'claude-3-5-sonnet-latest';
      const viaOAuth = !!settings.oauthToken;
      return {
        provider: new AnthropicProvider({
          ...(settings.cloudBaseUrl ? { baseUrl: settings.cloudBaseUrl } : {}),
          defaultModel: model,
          ...(settings.oauthToken ? { oauthToken: settings.oauthToken } : {}),
          ...(settings.cloudApiKey ? { apiKey: settings.cloudApiKey } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        }),
        label: `${viaOAuth ? 'Claude (subscription)' : 'Claude'} · ${model}`,
        local: false,
        configured: true,
      };
    }
    case 'openai-responses': {
      const model = settings.cloudModel ?? 'gpt-4o-mini';
      const viaOAuth = !!settings.oauthToken;
      return {
        provider: new OpenAiResponsesProvider({
          ...(settings.cloudBaseUrl ? { baseUrl: settings.cloudBaseUrl } : {}),
          defaultModel: model,
          ...(settings.oauthToken ? { oauthToken: settings.oauthToken } : {}),
          ...(settings.cloudApiKey ? { apiKey: settings.cloudApiKey } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        }),
        label: `${viaOAuth ? 'ChatGPT/Codex (subscription)' : 'OpenAI'} · ${model}`,
        local: false,
        configured: true,
      };
    }
    default:
      return { provider: null, label: 'No AI provider', local: true, configured: false };
  }
}
