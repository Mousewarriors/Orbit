import { describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@orbit/ai-runtime';
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
});
