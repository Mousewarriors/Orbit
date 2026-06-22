/**
 * Resolve the active AI provider for the renderer: read the persisted settings,
 * pull the right credential from OS secure storage (the secret depends on the
 * selected preset — Ollama Cloud, OpenAI, Anthropic and custom each have their
 * own), and build a `ProviderInfo` over the native HTTP fetch. Centralised so
 * every AI surface (Quick AI, Chat, Orbit Agent) gets identical, correct
 * provider construction — including the secret handling.
 */
import { OAUTH_PROVIDERS } from '@orbit/ai-runtime';
import * as native from '../native.js';
import { createNativeFetch } from './nativeFetch.js';
import { getValidAccessToken } from './oauthFlow.js';
import {
  AI_SETTING_KEYS,
  createProvider,
  parseAiSettings,
  presetById,
  resolvePresetId,
  type ProviderInfo,
} from './providerConfig.js';

function offlineMock(): ProviderInfo {
  return createProvider({ provider: 'mock', ollamaEndpoint: '', ollamaModel: '' });
}

export async function loadProviderInfo(): Promise<ProviderInfo> {
  if (!native.isTauri()) return offlineMock();
  try {
    const [provider, presetId, endpoint, model, cloudBase, cloudModel] = await Promise.all([
      native.getSetting(AI_SETTING_KEYS.provider),
      native.getSetting(AI_SETTING_KEYS.preset),
      native.getSetting(AI_SETTING_KEYS.endpoint),
      native.getSetting(AI_SETTING_KEYS.model),
      native.getSetting(AI_SETTING_KEYS.cloudBase),
      native.getSetting(AI_SETTING_KEYS.cloudModel),
    ]);

    // The preset tells us which secret to read; fall back to inferring it from
    // the persisted engine + endpoint for installs that predate `ai.preset`.
    const engine = provider ?? 'none';
    const preset =
      presetById(presetId ?? '') ??
      presetById(resolvePresetId(engine, (engine === 'openai-compat' ? cloudBase : endpoint) ?? ''));

    let ollamaApiKey: string | null = null;
    let cloudApiKey: string | null = null;
    let oauthToken: string | null = null;
    if (preset?.oauth) {
      // Subscription sign-in: resolve (and silently refresh) the access token.
      oauthToken = await getValidAccessToken(OAUTH_PROVIDERS[preset.oauth]).catch(() => null);
    } else if (preset?.key) {
      const secret = await native.secretGet(preset.key.secret).catch(() => null);
      if (preset.engine === 'ollama') ollamaApiKey = secret;
      else cloudApiKey = secret;
    }

    return createProvider(
      parseAiSettings({
        provider,
        endpoint,
        model,
        ollamaApiKey,
        cloudBase,
        cloudModel,
        cloudApiKey,
        oauthToken,
      }),
      createNativeFetch(),
    );
  } catch {
    return createProvider({ provider: 'none', ollamaEndpoint: '', ollamaModel: '' });
  }
}
