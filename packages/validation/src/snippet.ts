import { z } from 'zod';

/**
 * Validation for snippet create/update input. This is the trust boundary for
 * user-authored snippets: the renderer validates here for early, friendly
 * errors and the Rust command layer re-checks the same bounds (architecture
 * rule 5 — never trust the renderer alone).
 *
 * A keyword is optional; when present it must be a single "word" with no
 * internal whitespace (it is matched against the live keystroke stream by the
 * expansion watcher, where spaces would break continuity). Content is bounded
 * generously to allow real templates while refusing absurd payloads.
 */

export const SNIPPET_NAME_MAX = 200;
export const SNIPPET_KEYWORD_MAX = 50;
export const SNIPPET_CONTENT_MAX = 100_000;

export const snippetInputSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(SNIPPET_NAME_MAX),
  keyword: z
    .string()
    .trim()
    .max(SNIPPET_KEYWORD_MAX)
    .regex(/^\S+$/, 'keyword must not contain spaces')
    .optional()
    .or(z.literal('')),
  content: z.string().min(1, 'content is required').max(SNIPPET_CONTENT_MAX),
  description: z.string().trim().max(SNIPPET_NAME_MAX).optional().or(z.literal('')),
});

export type SnippetInput = z.infer<typeof snippetInputSchema>;

export interface SnippetValidationOk {
  readonly ok: true;
  readonly value: SnippetInput;
}
export interface SnippetValidationErr {
  readonly ok: false;
  readonly errors: ReadonlyArray<{ path: string; message: string }>;
}

/** Validate snippet input, returning a typed result. */
export function validateSnippetInput(input: unknown): SnippetValidationOk | SnippetValidationErr {
  const parsed = snippetInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  };
}
