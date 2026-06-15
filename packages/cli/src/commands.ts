import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { ExtensionManifest, ValidationIssue } from "@orbit/api";
import { listCommandNames, validateManifest } from "@orbit/api";

import type { TemplateId } from "./templates.js";
import { renderTemplate, TEMPLATE_IDS } from "./templates.js";
import { isValidName, spawnCapture, toTitle } from "./util.js";
import { createZip } from "./zip.js";
import type { ZipEntry } from "./zip.js";

/** A structured outcome from a CLI subcommand (renders to console + exit code). */
export interface CommandResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
  /** Machine-readable payload for tests/programmatic callers. */
  readonly data?: Record<string, unknown> | undefined;
}

function ok(lines: readonly string[], data?: Record<string, unknown>): CommandResult {
  return { ok: true, lines, data };
}

function fail(lines: readonly string[], data?: Record<string, unknown>): CommandResult {
  return { ok: false, lines, data };
}

/** Files the host needs at minimum; used by validate + package. */
const REQUIRED_FILES = ["manifest.json"] as const;

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

/** Options for {@link createExtension}. */
export interface CreateOptions {
  readonly name: string;
  readonly template: string;
  /** Directory the new extension folder is created inside. */
  readonly cwd: string;
  readonly sdkVersion: string;
  /** Overwrite an existing target dir if true. */
  readonly force: boolean;
}

function isTemplateId(value: string): value is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(value);
}

/** Scaffolds a working extension from a template into `cwd/<name>`. */
export async function createExtension(options: CreateOptions): Promise<CommandResult> {
  if (!isValidName(options.name)) {
    return fail([`Invalid extension name "${options.name}" (use kebab-case: a-z 0-9 -).`]);
  }
  if (!isTemplateId(options.template)) {
    return fail([
      `Unknown template "${options.template}".`,
      `Available templates: ${TEMPLATE_IDS.join(", ")}.`,
    ]);
  }

  const target = join(options.cwd, options.name);
  if (existsSync(target) && !options.force) {
    return fail([`Target already exists: ${target}`, "Pass --force to overwrite."]);
  }

  const rendered = renderTemplate(options.template, {
    name: options.name,
    title: toTitle(options.name),
    sdkVersion: options.sdkVersion,
  });

  await mkdir(target, { recursive: true });
  for (const file of rendered.files) {
    const filePath = join(target, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.contents, "utf8");
  }

  return ok(
    [
      `Created ${options.template} extension "${options.name}" at:`,
      `  ${target}`,
      "",
      "Next:",
      `  cd ${options.name}`,
      "  npm install        # resolves @orbit/api",
      "  orbit extension validate",
      "  orbit extension dev",
    ],
    { target, files: rendered.files.map((f) => f.path) },
  );
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

/** Reads + validates the manifest at `dir/manifest.json`. */
export async function validateExtension(dir: string): Promise<CommandResult> {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return fail([`No manifest.json found in ${dir}.`]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail([`manifest.json is not valid JSON: ${message}`]);
  }

  const result = validateManifest(parsed);
  if (!result.valid) {
    return fail(
      [
        `manifest.json is invalid (${result.issues.length} issue(s)):`,
        ...result.issues.map((issue: ValidationIssue) => `  - ${issue.path}: ${issue.message}`),
      ],
      { issues: result.issues },
    );
  }

  const manifest = result.manifest as ExtensionManifest;
  const entryPath = join(dir, manifest.main);
  const lines: string[] = [`manifest.json is valid.`, `  commands: ${listCommandNames(manifest).join(", ")}`];
  let entryOk = true;
  if (!existsSync(entryPath)) {
    entryOk = false;
    lines.push(`  WARNING: entry "${manifest.main}" does not exist at ${entryPath}.`);
  } else {
    lines.push(`  entry: ${manifest.main}`);
  }

  return {
    ok: entryOk,
    lines,
    data: { manifest, commands: listCommandNames(manifest), entryExists: entryOk },
  };
}

// ---------------------------------------------------------------------------
// build (typecheck/sanity)
// ---------------------------------------------------------------------------

/**
 * "build" sanity-checks an extension: validates the manifest and confirms the
 * entry module loads (imports resolve) by spawning `node --check`. There is no
 * compile step for `.mjs` extensions, so this is a load/syntax gate.
 */
export async function buildExtension(dir: string, nodeBin = process.execPath): Promise<CommandResult> {
  const validated = await validateExtension(dir);
  if (!validated.ok) return validated;
  const manifest = validated.data?.["manifest"] as ExtensionManifest | undefined;
  if (manifest === undefined) return fail(["Could not read manifest after validation."]);

  const entry = join(dir, manifest.main);
  const result = await spawnCapture(nodeBin, ["--check", entry]);
  if (result.code !== 0) {
    return fail([`Entry failed syntax check (node --check):`, result.stderr.trim()]);
  }
  return ok([`Build OK: manifest valid and ${manifest.main} passes node --check.`], {
    entry,
  });
}

// ---------------------------------------------------------------------------
// package
// ---------------------------------------------------------------------------

/** Options for {@link packageExtension}. */
export interface PackageOptions {
  readonly dir: string;
  /** Output .zip path. Defaults to `<dir>/<name>-<version>.zip`. */
  readonly out?: string | undefined;
}

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

/** Validates then zips an extension into a distributable artifact. */
export async function packageExtension(options: PackageOptions): Promise<CommandResult> {
  const validated = await validateExtension(options.dir);
  if (!validated.ok) {
    return fail(["Refusing to package an invalid extension.", ...validated.lines]);
  }
  const manifest = validated.data?.["manifest"] as ExtensionManifest;
  const outPath =
    options.out ?? join(options.dir, `${manifest.name}-${manifest.version}.zip`);

  const files = await collectFiles(options.dir);
  const entries: ZipEntry[] = [];
  for (const file of files) {
    if (resolve(file) === resolve(outPath)) continue; // never include the artifact itself
    const rel = relative(options.dir, file).split(sep).join("/");
    entries.push({ path: rel, data: await readFile(file) });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));

  const zip = createZip(entries);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, zip);

  return ok(
    [
      `Packaged "${manifest.name}" v${manifest.version}:`,
      `  ${outPath}`,
      `  ${entries.length} file(s), ${zip.length} bytes`,
    ],
    { out: outPath, files: entries.map((e) => e.path), bytes: zip.length },
  );
}

// ---------------------------------------------------------------------------
// logs
// ---------------------------------------------------------------------------

/**
 * Surfaces extension logs. Extensions log structured JSON lines to stderr (see
 * the SDK logger). The host tees an extension's stderr to a log file; `logs`
 * reads + pretty-prints it. We read `<dir>/.orbit/logs.ndjson` if present.
 */
export async function readLogs(dir: string, limit = 50): Promise<CommandResult> {
  const logPath = join(dir, ".orbit", "logs.ndjson");
  if (!existsSync(logPath)) {
    return ok([
      `No logs found at ${logPath}.`,
      "Logs appear here once the host runs this extension (it tees stderr to this file).",
    ]);
  }
  const raw = await readFile(logPath, "utf8");
  const allLines = raw.split("\n").filter((l) => l.trim() !== "");
  const tail = allLines.slice(-limit);
  const lines = tail.map((line) => {
    try {
      const record = JSON.parse(line) as {
        ts?: string;
        level?: string;
        msg?: string;
        fields?: unknown;
      };
      const fields = record.fields ? ` ${JSON.stringify(record.fields)}` : "";
      return `[${record.ts ?? "?"}] ${(record.level ?? "info").toUpperCase()} ${record.msg ?? ""}${fields}`;
    } catch {
      return line;
    }
  });
  return ok(lines.length > 0 ? lines : ["(log file is empty)"], { count: tail.length });
}

// ---------------------------------------------------------------------------
// dev (watch + validate)
// ---------------------------------------------------------------------------

/**
 * Performs ONE validate+build pass and returns readable results. The watch loop
 * lives in the dispatcher (it re-invokes this on file changes). Splitting it out
 * keeps the per-pass logic testable without timers.
 */
export async function devPass(dir: string): Promise<CommandResult> {
  const validated = await validateExtension(dir);
  if (!validated.ok) return validated;
  const built = await buildExtension(dir);
  if (!built.ok) return built;
  return ok([...validated.lines, ...built.lines]);
}

/** Returns the source files `dev` should watch for changes. */
export async function watchTargets(dir: string): Promise<readonly string[]> {
  const targets: string[] = [];
  for (const required of REQUIRED_FILES) {
    const p = join(dir, required);
    if (existsSync(p)) targets.push(p);
  }
  const files = await collectFiles(dir);
  for (const file of files) {
    if (file.endsWith(".mjs") || file.endsWith(".js")) targets.push(file);
  }
  // De-dupe while keeping order.
  return [...new Set(targets)];
}

/** True if `dir` looks like an extension (has the required files). */
export async function looksLikeExtension(dir: string): Promise<boolean> {
  try {
    const s = await stat(join(dir, "manifest.json"));
    return s.isFile();
  } catch {
    return false;
  }
}
