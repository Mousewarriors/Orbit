import { spawn } from "node:child_process";

/**
 * Small dependency-free utilities shared by the CLI subcommands. We prefer
 * Node built-ins (node:fs, node:child_process, node:zlib) over third-party deps.
 */

/** A parsed argv: positional args plus `--flag value` / `--bool` options. */
export interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, string | boolean>>;
}

/**
 * Parses argv into positionals and `--option` flags. `--key value` captures the
 * next token as the value; `--key` with no following value (or followed by
 * another `--flag`) is a boolean `true`. `--key=value` is also supported.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        options[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        options[body] = next;
        i += 1;
      } else {
        options[body] = true;
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, options };
}

/** Returns a string option or `undefined` (booleans are coerced to undefined). */
export function stringOption(args: ParsedArgs, key: string): string | undefined {
  const value = args.options[key];
  return typeof value === "string" ? value : undefined;
}

/** Returns a boolean option (presence or explicit truthy string). */
export function boolOption(args: ParsedArgs, key: string): boolean {
  const value = args.options[key];
  if (typeof value === "boolean") return value;
  return value === "true" || value === "";
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** True if `name` is a valid kebab-case extension/command name. */
export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

/** Converts an arbitrary string to a kebab-case title-ish slug. */
export function toKebab(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Title-cases a kebab-case name, e.g. "my-ext" -> "My Ext". */
export function toTitle(name: string): string {
  return name
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Result of running a child process to completion. */
export interface SpawnResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawns a command, writes `input` to stdin (if provided), and resolves with
 * the captured stdout/stderr and exit code. Used to run a generated extension
 * through the one-shot protocol.
 */
export function spawnCapture(
  command: string,
  argv: readonly string[],
  options: { cwd?: string | undefined; input?: string | undefined } = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...argv], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}
