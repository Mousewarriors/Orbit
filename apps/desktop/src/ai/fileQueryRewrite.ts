import type { AiProvider } from '@orbit/ai-runtime';

const MAX_QUERY_LEN = 120;
const MAX_SUGGESTIONS = 3;

function cleanSuggestion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const q = value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:!?'"]+|[\s,.;:!?'"]+$/g, '');
  if (q.length < 2 || q.length > MAX_QUERY_LEN) return null;
  // Suggestions must be search terms only. Paths, URLs and shell-ish snippets
  // are ignored; indexed file paths still come exclusively from fileSearch().
  if (/^[a-z]:[\\/]/i.test(q) || /^[/\\]{1,2}/.test(q) || /^[a-z][a-z0-9+.-]*:\/\//i.test(q)) {
    return null;
  }
  if (/[;&|<>`$]/.test(q)) return null;
  return q;
}

function extractCandidates(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    if (Array.isArray(rec['queries'])) return rec['queries'];
    if (Array.isArray(rec['searches'])) return rec['searches'];
  }
  return [];
}

export function parseFileQuerySuggestions(content: string, original: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  const originalNorm = original.trim().toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>([originalNorm]);
  for (const candidate of extractCandidates(parsed)) {
    const cleaned = cleanSuggestion(candidate);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

export async function rewriteFileQueryWithAi(
  query: string,
  provider: AiProvider,
  signal?: AbortSignal,
): Promise<string[]> {
  const original = query.trim();
  if (original.length < 3 || original.length > MAX_QUERY_LEN) return [];

  const response = await provider.complete(
    {
      temperature: 0,
      maxTokens: 160,
      json: true,
      messages: [
        {
          role: 'system',
          content:
            'Rewrite remembered file descriptions into concise local file-search terms. Return only JSON like {"queries":["term one","term two"]}. Do not return paths, commands, URLs, explanations, or actions.',
        },
        {
          role: 'user',
          content: original,
        },
      ],
    },
    signal,
  );
  return parseFileQuerySuggestions(response.content, original);
}
