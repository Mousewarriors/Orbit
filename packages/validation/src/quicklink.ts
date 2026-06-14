import { z } from 'zod';

/**
 * Validation for Quicklink create/update input — the trust boundary for
 * user-authored links. The renderer validates here for friendly errors and the
 * Rust command layer re-checks the same bounds (architecture rule 5).
 *
 * A Quicklink target is one of:
 *   - an `http(s)`/`mailto` URL (may contain `{placeholder}` tokens), or
 *   - a filesystem path (no URL scheme), opened via the OS default handler.
 * Any other scheme (`javascript:`, `file:`, `data:`, `vbscript:`, …) is rejected
 * so a saved link can never smuggle script or a dangerous protocol.
 */

export const QUICKLINK_TITLE_MAX = 200;
export const QUICKLINK_TARGET_MAX = 4000;
export const QUICKLINK_ALIAS_MAX = 50;

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto']);

/** Whether a Quicklink target is allowed (safe scheme, or a scheme-less path). */
export function isValidQuicklinkTarget(target: string): boolean {
  const t = target.trim();
  if (!t) return false;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(t);
  // A single-character "scheme" is a Windows drive letter (C:\…), not a URL.
  if (scheme && scheme[1]!.length > 1) {
    return ALLOWED_SCHEMES.has(scheme[1]!.toLowerCase());
  }
  // No scheme → treated as a local path, opened via the OS default handler.
  return true;
}

export const quicklinkInputSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(QUICKLINK_TITLE_MAX),
  target: z
    .string()
    .trim()
    .min(1, 'target is required')
    .max(QUICKLINK_TARGET_MAX)
    .refine(isValidQuicklinkTarget, 'target must be an http(s)/mailto URL or a file path'),
  alias: z.string().trim().max(QUICKLINK_ALIAS_MAX).optional().or(z.literal('')),
});

export type QuicklinkInput = z.infer<typeof quicklinkInputSchema>;

export interface QuicklinkValidationOk {
  readonly ok: true;
  readonly value: QuicklinkInput;
}
export interface QuicklinkValidationErr {
  readonly ok: false;
  readonly errors: ReadonlyArray<{ path: string; message: string }>;
}

export function validateQuicklinkInput(
  input: unknown,
): QuicklinkValidationOk | QuicklinkValidationErr {
  const parsed = quicklinkInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}
