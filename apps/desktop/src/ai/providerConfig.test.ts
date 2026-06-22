import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_SETTINGS,
  PROVIDER_PRESETS,
  createProvider,
  parseAiSettings,
  presetById,
  resolvePresetId,
} from './providerConfig.js';

describe('parseAiSettings', () => {
  it('falls back to defaults for missing/invalid values', () => {
    expect(parseAiSettings({})).toEqual(DEFAULT_AI_SETTINGS);
    expect(parseAiSettings({ provider: 'bogus' }).provider).toBe('none');
  });

  it('reads a valid provider and trims endpoint/model', () => {
    const s = parseAiSettings({ provider: 'ollama', endpoint: ' http://host:1 ', model: ' qwen ' });
    expect(s).toMatchObject({ provider: 'ollama', ollamaEndpoint: 'http://host:1', ollamaModel: 'qwen' });
  });

  it('reads the cloud provider + base/model and resolves the api key', () => {
    const s = parseAiSettings({
      provider: 'openai-compat',
      cloudBase: ' https://api.example.com/v1 ',
      cloudModel: ' gpt-4o ',
      cloudApiKey: 'secret',
    });
    expect(s.provider).toBe('openai-compat');
    expect(s.cloudBaseUrl).toBe('https://api.example.com/v1');
    expect(s.cloudModel).toBe('gpt-4o');
    expect(s.cloudApiKey).toBe('secret');
  });
});

describe('createProvider', () => {
  it('returns an unconfigured info for "none"', () => {
    const info = createProvider({ ...DEFAULT_AI_SETTINGS, provider: 'none' });
    expect(info.provider).toBeNull();
    expect(info.configured).toBe(false);
  });

  it('returns a local Mock provider', async () => {
    const info = createProvider({ ...DEFAULT_AI_SETTINGS, provider: 'mock' });
    expect(info.configured).toBe(true);
    expect(info.local).toBe(true);
    expect(info.provider!.id).toBe('mock');
    const res = await info.provider!.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.content).toMatch(/mock ai/i);
  });

  it('constructs an Ollama provider with the configured endpoint/model', () => {
    const info = createProvider({
      provider: 'ollama',
      ollamaEndpoint: 'http://127.0.0.1:11434',
      ollamaModel: 'llama3.1',
    });
    expect(info.provider!.id).toBe('ollama');
    expect(info.local).toBe(true);
    expect(info.label).toContain('llama3.1');
  });

  it('constructs an OpenAI-compatible provider (remote) with the configured model', () => {
    const info = createProvider({
      ...DEFAULT_AI_SETTINGS,
      provider: 'openai-compat',
      cloudBaseUrl: 'https://api.openai.com/v1',
      cloudModel: 'gpt-4o-mini',
      cloudApiKey: 'k',
    });
    expect(info.provider!.id).toBe('openai-compat');
    expect(info.local).toBe(false);
    expect(info.label).toContain('gpt-4o-mini');
  });

  it('builds a native Anthropic provider, labelled for OAuth vs API key', () => {
    const oauth = createProvider({
      ...DEFAULT_AI_SETTINGS,
      provider: 'anthropic',
      cloudBaseUrl: 'https://api.anthropic.com',
      cloudModel: 'claude-sonnet-4-5',
      oauthToken: 'tok',
    });
    expect(oauth.provider!.id).toBe('anthropic');
    expect(oauth.local).toBe(false);
    expect(oauth.label).toMatch(/subscription/i);

    const key = createProvider({
      ...DEFAULT_AI_SETTINGS,
      provider: 'anthropic',
      cloudModel: 'claude-3-5-haiku-latest',
      cloudApiKey: 'sk-ant',
    });
    expect(key.label).toContain('claude-3-5-haiku-latest');
    expect(key.label).not.toMatch(/subscription/i);
  });

  it('builds an OpenAI Responses provider for the Codex subscription', () => {
    const info = createProvider({
      ...DEFAULT_AI_SETTINGS,
      provider: 'openai-responses',
      cloudModel: 'gpt-5-codex',
      oauthToken: 'tok',
    });
    expect(info.provider!.id).toBe('openai-responses');
    expect(info.label).toMatch(/subscription/i);
  });

  it('treats a remote Ollama endpoint (Ollama Cloud) as non-local', () => {
    const info = createProvider({
      provider: 'ollama',
      ollamaEndpoint: 'https://ollama.com',
      ollamaModel: 'gpt-oss:120b',
      ollamaApiKey: 'k',
    });
    expect(info.provider!.id).toBe('ollama');
    expect(info.local).toBe(false);
    expect(info.label).toContain('Ollama Cloud');
  });
});

describe('provider presets', () => {
  it('every preset id resolves and remote presets carry a key OR an oauth provider', () => {
    for (const p of PROVIDER_PRESETS) {
      expect(presetById(p.id)).toBe(p);
      if (!p.local && p.engine !== 'none') {
        expect(Boolean(p.key?.secret) || Boolean(p.oauth), `${p.id} needs a key or oauth`).toBe(true);
      }
    }
  });

  it('infers the preset from a persisted engine + endpoint', () => {
    expect(resolvePresetId('ollama', 'http://127.0.0.1:11434')).toBe('ollama-local');
    expect(resolvePresetId('ollama', 'https://ollama.com')).toBe('ollama-cloud');
    expect(resolvePresetId('openai-compat', 'https://api.openai.com/v1')).toBe('openai');
    expect(resolvePresetId('openai-compat', 'https://my.gateway/v1')).toBe('custom');
    expect(resolvePresetId('anthropic', 'https://api.anthropic.com')).toBe('anthropic');
    expect(resolvePresetId('openai-responses', 'https://api.openai.com/v1')).toBe('codex-subscription');
    expect(resolvePresetId('none', '')).toBe('none');
  });
});
