import type {
  CommandMode,
  CommandSpec,
  ExtensionManifest,
  Permission,
  PreferenceSpec,
  PreferenceType,
} from "./manifest.js";

/**
 * Manifest validation, mirroring the rules the host enforces. Returns a
 * structured list of human-readable problems; an empty list means valid. The
 * CLI's `validate`/`dev` commands render these.
 */

/** A single validation problem with a JSON-path-ish location. */
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

/** The outcome of validating a candidate manifest. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
  /** Present only when `valid` is true. */
  readonly manifest: ExtensionManifest | undefined;
}

const VALID_PERMISSIONS: readonly Permission[] = ["open-url", "copy", "open-path"];
const VALID_MODES: readonly CommandMode[] = ["no-view", "list", "detail"];
const VALID_PREF_TYPES: readonly PreferenceType[] = ["string", "boolean", "number", "password"];

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  { required = true, pattern }: { required?: boolean; pattern?: RegExp } = {},
): value is string {
  if (value === undefined) {
    if (required) issues.push({ path, message: "is required" });
    return false;
  }
  if (typeof value !== "string" || value.length === 0) {
    issues.push({ path, message: "must be a non-empty string" });
    return false;
  }
  if (pattern && !pattern.test(value)) {
    issues.push({ path, message: `must match ${pattern.toString()}` });
    return false;
  }
  return true;
}

function validatePreference(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  checkString(value["name"], `${path}.name`, issues, { pattern: NAME_RE });
  checkString(value["title"], `${path}.title`, issues);
  const type = value["type"];
  if (!VALID_PREF_TYPES.includes(type as PreferenceType)) {
    issues.push({
      path: `${path}.type`,
      message: `must be one of: ${VALID_PREF_TYPES.join(", ")}`,
    });
  }
  if (value["description"] !== undefined && typeof value["description"] !== "string") {
    issues.push({ path: `${path}.description`, message: "must be a string" });
  }
  if (value["required"] !== undefined && typeof value["required"] !== "boolean") {
    issues.push({ path: `${path}.required`, message: "must be a boolean" });
  }
}

function validateCommand(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  checkString(value["name"], `${path}.name`, issues, { pattern: NAME_RE });
  checkString(value["title"], `${path}.title`, issues);
  const mode = value["mode"];
  if (!VALID_MODES.includes(mode as CommandMode)) {
    issues.push({ path: `${path}.mode`, message: `must be one of: ${VALID_MODES.join(", ")}` });
  }
  const perms = value["permissions"];
  if (perms !== undefined) {
    if (!Array.isArray(perms)) {
      issues.push({ path: `${path}.permissions`, message: "must be an array" });
    } else {
      perms.forEach((perm, index) => {
        if (!VALID_PERMISSIONS.includes(perm as Permission)) {
          issues.push({
            path: `${path}.permissions[${String(index)}]`,
            message: `must be one of: ${VALID_PERMISSIONS.join(", ")}`,
          });
        }
      });
    }
  }
}

/** Validates an unknown value as an {@link ExtensionManifest}. */
export function validateManifest(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [{ path: "$", message: "manifest must be a JSON object" }],
      manifest: undefined,
    };
  }

  checkString(input["name"], "name", issues, { pattern: NAME_RE });
  checkString(input["title"], "title", issues);
  checkString(input["description"], "description", issues);
  checkString(input["version"], "version", issues, { pattern: SEMVER_RE });
  checkString(input["main"], "main", issues);

  const commands = input["commands"];
  if (!Array.isArray(commands) || commands.length === 0) {
    issues.push({ path: "commands", message: "must be a non-empty array" });
  } else {
    const seen = new Set<string>();
    commands.forEach((command, index) => {
      const path = `commands[${String(index)}]`;
      validateCommand(command, path, issues);
      if (isRecord(command) && typeof command["name"] === "string") {
        if (seen.has(command["name"])) {
          issues.push({ path: `${path}.name`, message: `duplicate command name "${command["name"]}"` });
        }
        seen.add(command["name"]);
      }
    });
  }

  const preferences = input["preferences"];
  if (preferences !== undefined) {
    if (!Array.isArray(preferences)) {
      issues.push({ path: "preferences", message: "must be an array" });
    } else {
      preferences.forEach((pref, index) => {
        validatePreference(pref, `preferences[${String(index)}]`, issues);
      });
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues, manifest: undefined };
  }

  // Safe to assert: all checks above passed.
  return { valid: true, issues: [], manifest: input as unknown as ExtensionManifest };
}

/** Returns the declared command names in manifest order. */
export function listCommandNames(manifest: ExtensionManifest): readonly string[] {
  return manifest.commands.map((command: CommandSpec) => command.name);
}

/** Returns the declared preference names in manifest order. */
export function listPreferenceNames(manifest: ExtensionManifest): readonly string[] {
  return (manifest.preferences ?? []).map((pref: PreferenceSpec) => pref.name);
}
