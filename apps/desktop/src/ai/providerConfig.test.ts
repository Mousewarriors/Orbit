import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_SETTINGS,
  createProvider,
  parseAiSettings,
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
});
