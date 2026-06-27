import { describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@orbit/ai-runtime';
import type { FetchLike } from '@orbit/ai-runtime';
import { createProvider } from './providerConfig.js';
import { parseFileQuerySuggestions, rewriteFileQueryWithAi } from './fileQueryRewrite.js';

describe('parseFileQuerySuggestions', () => {
  it('accepts bounded query arrays and drops duplicates of the original query', () => {
    expect(
      parseFileQuerySuggestions(
        JSON.stringify({
          queries: [
            'convention attendant positions map',
            'Convention Attendant Positions Map',
            'attendant map',
          ],
        }),
        'convention attendant positions map',
      ),
    ).toEqual(['attendant map']);
  });

  it('rejects paths, URLs, shell-ish text and malformed JSON', () => {
    expect(
      parseFileQuerySuggestions(
        JSON.stringify({
          queries: [
            'C:\\Users\\Simon\\secret.pdf',
            'https://example.test/file',
            'accounts; rm -rf',
            '\\\\server\\share\\file',
            'KHT accounts instructions',
          ],
        }),
        'accounts instructions',
      ),
    ).toEqual(['KHT accounts instructions']);
    expect(parseFileQuerySuggestions('not-json', 'anything')).toEqual([]);
  });
});

describe('rewriteFileQueryWithAi', () => {
  it('asks the provider for JSON search terms and parses the safe suggestions', async () => {
    const provider = new MockProvider({
      reply: JSON.stringify({ queries: ['KHT congregation accounts instructions'] }),
    });
    const spy = vi.spyOn(provider, 'complete');

    await expect(
      rewriteFileQueryWithAi('where are the kht account rules', provider),
    ).resolves.toEqual(['KHT congregation accounts instructions']);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ json: true, temperature: 0 }),
      undefined,
    );
  });

  it('uses Ollama Cloud for safe remembered-file rewrites without trusting paths or actions', async () => {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push({ url, init });
      expect(url).toBe('https://ollama.com/api/chat');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer ollama-key' });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            content: JSON.stringify({
              queries: [
                'C:\\Users\\Simon\\Secrets\\accounts.pdf',
                'open paint && delete stuff',
                'KHT congregation accounts instructions',
              ],
            }),
          },
          done: true,
        }),
        text: async () => '',
      };
    };
    const info = createProvider(
      {
        provider: 'ollama',
        ollamaEndpoint: 'https://ollama.com',
        ollamaModel: 'gpt-oss:120b',
        ollamaApiKey: 'ollama-key',
      },
      fetchImpl,
    );

    await expect(
      rewriteFileQueryWithAi('where are the kht money rules', info.provider!),
    ).resolves.toEqual(['KHT congregation accounts instructions']);
    expect(seen).toHaveLength(1);
  });
});
