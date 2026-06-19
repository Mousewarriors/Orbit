/**
 * Resolve the active AI provider for the renderer: read the persisted settings,
 * pull the cloud API key from OS secure storage (only when a cloud provider is
 * selected), and build a `ProviderInfo` over the native HTTP fetch. Centralised
 * so every AI surface (Quick AI, Chat, Orbit Agent) gets identical, correct
 * provider construction — including the secret handling.
 */
import * as native from '../native.js';
import { createNativeFetch } from './nativeFetch.js';
import {
  AI_SETTING_KEYS,
  CLOUD_API_KEY_SECRET,
  createProvider,
  parseAiSettings,
  type ProviderInfo,
} from './providerConfig.js';

function offlineMock(): ProviderInfo {
  return createProvider({ provider: 'mock', ollamaEndpoint: '', ollamaModel: '' });
}

export async function loadProviderInfo(): Promise<ProviderInfo> {
  if (!native.isTauri()) return offlineMock();
  try {
    const [provider, endpoint, model, cloudBase, cloudModel] = await Promise.all([
      native.getSetting(AI_SETTING_KEYS.provider),
      native.getSetting(AI_SETTING_KEYS.endpoint),
      native.getSetting(AI_SETTING_KEYS.model),
      native.getSetting(AI_SETTING_KEYS.cloudBase),
      native.getSetting(AI_SETTING_KEYS.cloudModel),
    ]);
    let cloudApiKey: string | null = null;
    if (provider === 'openai-compat') {
      cloudApiKey = await native.secretGet(CLOUD_API_KEY_SECRET).catch(() => null);
    }
    return createProvider(
      parseAiSettings({ provider, endpoint, model, cloudBase, cloudModel, cloudApiKey }),
      createNativeFetch(),
    );
  } catch {
    return createProvider({ provider: 'none', ollamaEndpoint: '', ollamaModel: '' });
  }
}
