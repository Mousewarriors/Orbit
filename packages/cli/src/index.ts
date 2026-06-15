import { watch } from "node:fs";
import { resolve } from "node:path";

import {
  buildExtension,
  createExtension,
  devPass,
  packageExtension,
  readLogs,
  validateExtension,
  watchTargets,
} from "./commands.js";
import type { CommandResult } from "./commands.js";
import { TEMPLATE_IDS } from "./templates.js";
import { boolOption, parseArgs, stringOption } from "./util.js";

/**
 * `orbit` CLI dispatcher. Exposes `runCli(argv)` which returns an exit code so
 * tests can drive it without spawning a process. The thin `bin/orbit.ts` wraps
 * this and wires `process.argv`.
 *
 * @see docs/architecture/EXTENSION_SDK.md
 */

/** The SDK version stamped into scaffolded extensions' package.json. */
const SDK_VERSION = "0.1.0";

const USAGE = `orbit — Orbit extension toolkit

Usage:
  orbit extension <command> [options]

Commands:
  create <name> --template <t>   Scaffold a working extension (templates below)
  validate [dir]                 Validate manifest.json against the schema
  build [dir]                    Validate + syntax-check the entry (node --check)
  dev [dir]                      Watch, re-validate, and report errors on change
  package [dir] [--out <zip>]    Validate then produce a distributable .zip
  logs [dir] [--limit <n>]       Print the extension's structured logs

Templates: ${TEMPLATE_IDS.join(", ")}

Examples:
  orbit extension create my-tool --template list
  orbit extension validate ./my-tool
  orbit extension package ./my-tool --out dist/my-tool.zip
`;

/** A sink for CLI output (defaults to console; injectable for tests). */
export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const consoleIo: CliIo = {
  // Write directly to the streams (not console.log) so the CLI's stdout stays a
  // clean channel and we don't trip the no-console lint rule.
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
};

function emit(result: CommandResult, io: CliIo): number {
  const sink = result.ok ? io.out : io.err;
  for (const line of result.lines) sink(line);
  return result.ok ? 0 : 1;
}

async function runDevWatch(dir: string, io: CliIo): Promise<number> {
  const first = await devPass(dir);
  emit(first, io);
  io.out("");
  io.out(`Watching ${dir} for changes (Ctrl+C to stop)...`);

  const targets = await watchTargets(dir);
  let running = false;
  let pending = false;

  const trigger = (): void => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    void devPass(dir)
      .then((result) => {
        io.out("");
        io.out(`[${new Date().toISOString()}] change detected — re-validating`);
        emit(result, io);
      })
      .finally(() => {
        running = false;
        if (pending) {
          pending = false;
          trigger();
        }
      });
  };

  for (const target of targets) {
    // fs.watch is debounced naturally by the running/pending guard above.
    watch(target, { persistent: true }, () => {
      trigger();
    });
  }
  // The watch keeps the event loop alive; this promise intentionally never
  // resolves until the process is interrupted.
  return new Promise<number>(() => {
    /* run until SIGINT */
  });
}

/** Runs the `orbit extension <sub>` family. */
async function runExtension(argv: readonly string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = argv;
  const args = parseArgs(rest);
  const dirArg = args.positionals[sub === "create" ? 1 : 0];

  switch (sub) {
    case "create": {
      const name = args.positionals[0];
      if (name === undefined) {
        io.err("Usage: orbit extension create <name> --template <t>");
        return 1;
      }
      const template = stringOption(args, "template") ?? "list";
      const result = await createExtension({
        name,
        template,
        cwd: stringOption(args, "cwd") ?? process.cwd(),
        sdkVersion: SDK_VERSION,
        force: boolOption(args, "force"),
      });
      return emit(result, io);
    }
    case "validate":
      return emit(await validateExtension(resolve(dirArg ?? ".")), io);
    case "build":
      return emit(await buildExtension(resolve(dirArg ?? ".")), io);
    case "package": {
      const result = await packageExtension({
        dir: resolve(dirArg ?? "."),
        out: stringOption(args, "out"),
      });
      return emit(result, io);
    }
    case "logs": {
      const limit = Number(stringOption(args, "limit") ?? "50");
      return emit(
        await readLogs(resolve(dirArg ?? "."), Number.isFinite(limit) ? limit : 50),
        io,
      );
    }
    case "dev":
      return runDevWatch(resolve(dirArg ?? "."), io);
    default:
      io.err(`Unknown extension command: ${sub ?? "(none)"}`);
      io.err(USAGE);
      return 1;
  }
}

/** Top-level entry. Returns the process exit code. */
export async function runCli(argv: readonly string[], io: CliIo = consoleIo): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    io.out(USAGE);
    return 0;
  }
  if (command === "extension") {
    return runExtension(rest, io);
  }
  io.err(`Unknown command: ${command}`);
  io.err(USAGE);
  return 1;
}

export { SDK_VERSION };
