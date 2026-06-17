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
    expect(s).toEqual({ provider: 'ollama', ollamaEndpoint: 'http://host:1', ollamaModel: 'qwen' });
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
});
