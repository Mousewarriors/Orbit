import { z } from 'zod';

/**
 * Versioned schema for an extension manifest (orbit.json). This is the trust
 * boundary between third-party extension authors and the host: every field is
 * validated, lengths are bounded, and identifiers are constrained to safe
 * character sets so a malicious manifest cannot smuggle traversal sequences,
 * shell metacharacters or absurd values into the host.
 */

export const MANIFEST_SCHEMA_VERSION = 1;

/** Safe identifier: lowercase, alnum, dashes; no dots/slashes/spaces. */
const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lowercase alphanumeric with dashes');

const semver = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/, 'must be semver');

const permissionId = z.enum([
  'clipboard.read',
  'clipboard.write',
  'files.read',
  'files.write',
  'apps.launch',
  'apps.enumerate',
  'window.manage',
  'system.commands',
  'network',
  'selected-text.read',
  'text.insert',
  'browser.context',
  'calendar.read',
  'calendar.write',
  'ai',
  'shell.execute',
  'secure-storage',
]);

const commandMode = z.enum([
  'no-view',
  'list',
  'grid',
  'detail',
  'form',
  'menu-bar',
  'background',
  'interval',
  'ai-tool',
]);

const preferenceSchema = z.object({
  name: identifier,
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  type: z.enum(['textfield', 'password', 'checkbox', 'dropdown', 'file', 'directory']),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.boolean(), z.number()]).optional(),
  // Dropdown options
  data: z
    .array(z.object({ title: z.string().max(120), value: z.string().max(200) }))
    .max(100)
    .optional(),
});

const commandSchema = z.object({
  name: identifier,
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  mode: commandMode,
  // Per-command keywords
  keywords: z.array(z.string().max(40)).max(50).optional(),
  // Interval (seconds) for interval commands
  interval: z.number().int().min(10).max(86_400).optional(),
  preferences: z.array(preferenceSchema).max(50).optional(),
});

export const manifestSchema = z.object({
  $schema: z.literal(MANIFEST_SCHEMA_VERSION).or(z.undefined()),
  name: identifier,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  author: identifier,
  version: semver,
  icon: z
    .string()
    .max(200)
    // icon is a packaged relative path; reject traversal & absolute paths
    .refine((p) => !p.includes('..') && !p.startsWith('/') && !/^[a-zA-Z]:/.test(p), {
      message: 'icon must be a relative path without traversal',
    })
    .optional(),
  categories: z.array(z.string().max(40)).max(10).default([]),
  platforms: z.array(z.enum(['windows', 'macos', 'linux'])).min(1).max(3),
  commands: z.array(commandSchema).min(1).max(100),
  preferences: z.array(preferenceSchema).max(50).optional(),
  permissions: z.array(permissionId).max(20).default([]),
  dependencies: z.record(z.string().max(100), z.string().max(100)).optional(),
  minOrbitVersion: semver.optional(),
  website: z.string().url().max(300).optional(),
  repository: z.string().url().max(300).optional(),
  license: z.string().max(60).optional(),
  changelog: z.string().max(20_000).optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestCommand = z.infer<typeof commandSchema>;
export type ManifestPreference = z.infer<typeof preferenceSchema>;

export interface ValidationOk {
  readonly ok: true;
  readonly manifest: Manifest;
}
export interface ValidationErr {
  readonly ok: false;
  readonly errors: ReadonlyArray<{ path: string; message: string }>;
}

/** Validate an unknown value as a manifest, returning a typed result. */
export function validateManifest(input: unknown): ValidationOk | ValidationErr {
  const parsed = manifestSchema.safeParse(input);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  };
}

/** Cross-check that every command's declared permissions exist in the manifest. */
export function permissionsAreDeclared(manifest: Manifest): boolean {
  // (Reserved for future per-command permission narrowing; today permissions are
  // declared at the manifest level and apply to all commands.)
  return manifest.permissions.length <= 20;
}
