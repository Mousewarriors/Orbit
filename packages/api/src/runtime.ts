import { AsyncLocalStorage } from "node:async_hooks";

import type { CommandContext, CommandHandler } from "./context.js";
import { createEffectSink } from "./effects.js";
import type { Logger, LogLevel } from "./logging.js";
import { createLogger } from "./logging.js";
import { createPreferences } from "./preferences.js";
import type { ErrorResponse, InvokeRequest, ResultResponse } from "./protocol.js";
import { isInvokeRequest, PROTOCOL_VERSION } from "./protocol.js";
import { createStorage } from "./storage.js";

/** Holds the active context so the module-level helpers can resolve it. */
const activeContext = new AsyncLocalStorage<CommandContext>();

/**
 * Returns the {@link CommandContext} for the currently executing handler.
 * Throws if called outside a handler (e.g. at import time), which keeps the
 * module-level helpers honest — they never silently no-op.
 */
export function useContext(): CommandContext {
  const ctx = activeContext.getStore();
  if (ctx === undefined) {
    throw new Error(
      "Orbit SDK helper called outside a command handler. " +
        "showToast/copyToClipboard/openUrl/openPath/getPreferences must run inside run().",
    );
  }
  return ctx;
}

/** A registered command: a handler plus its metadata. */
export interface CommandRegistration {
  readonly name: string;
  readonly title: string | undefined;
  readonly handler: CommandHandler;
}

/** Options for {@link defineExtension}. */
export interface DefineExtensionOptions {
  /** Map of command name → handler (or full registration). */
  readonly commands: Readonly<Record<string, CommandHandler | Omit<CommandRegistration, "name">>>;
  /** Minimum log level for the per-invocation logger. Defaults to `info`. */
  readonly logLevel?: LogLevel | undefined;
}

/** The object returned by {@link defineExtension}. */
export interface Extension {
  /** The registered commands keyed by name. */
  readonly commands: ReadonlyMap<string, CommandRegistration>;
  /**
   * Runs a single invocation against an already-parsed request and returns the
   * protocol response. Used by tests and by {@link run}.
   */
  invoke(request: InvokeRequest, logger?: Logger): Promise<ResultResponse | ErrorResponse>;
  /**
   * Reads ONE request from `input`, runs it, writes ONE response to `output`,
   * then resolves. This is the entry point an extension's `index.mjs` calls.
   */
  run(io?: RunIo): Promise<void>;
}

/** Injectable streams for {@link Extension.run} (defaults to process std streams). */
export interface RunIo {
  readonly input?: NodeJS.ReadableStream | undefined;
  readonly output?: NodeJS.WritableStream | undefined;
  readonly error?: NodeJS.WritableStream | undefined;
}

function normalizeCommand(
  name: string,
  value: CommandHandler | Omit<CommandRegistration, "name">,
): CommandRegistration {
  if (typeof value === "function") {
    return { name, title: undefined, handler: value };
  }
  return { name, title: value.title ?? undefined, handler: value.handler };
}

async function readOnce(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Defines an extension from a set of command handlers. The returned object can
 * be `run()` from an `index.mjs`, or `invoke()`d directly in a test.
 */
export function defineExtension(options: DefineExtensionOptions): Extension {
  const commands = new Map<string, CommandRegistration>();
  for (const [name, value] of Object.entries(options.commands)) {
    commands.set(name, normalizeCommand(name, value));
  }
  const logLevel: LogLevel = options.logLevel ?? "info";

  async function invoke(
    request: InvokeRequest,
    logger?: Logger,
  ): Promise<ResultResponse | ErrorResponse> {
    const log = (logger ?? createLogger({ minLevel: logLevel })).child({
      command: request.command,
    });
    const registration = commands.get(request.command);
    if (registration === undefined) {
      const known = [...commands.keys()].join(", ");
      const message = `Unknown command "${request.command}". Known commands: ${known || "(none)"}`;
      log.error("unknown-command", { command: request.command });
      return { v: PROTOCOL_VERSION, type: "error", message };
    }

    const storage = createStorage(request.storage);
    const preferences = createPreferences(request.preferences);
    const effects = createEffectSink();
    const ctx: CommandContext = {
      command: request.command,
      query: request.query,
      storage,
      preferences,
      log,
      effects,
    };

    try {
      const items = await activeContext.run(ctx, () =>
        Promise.resolve(registration.handler(ctx)),
      );
      if (effects.toastWasOverwritten()) {
        log.warn("toast-overwritten", {
          note: "showToast was called more than once; only the last toast is sent.",
        });
      }
      const response: ResultResponse = {
        v: PROTOCOL_VERSION,
        type: "result",
        items: items ?? [],
        effects: effects.collectEffects(),
        storageWrites: storage.collect(),
        toast: effects.collectToast(),
      };
      return response;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("handler-threw", { message });
      return { v: PROTOCOL_VERSION, type: "error", message };
    }
  }

  async function run(io: RunIo = {}): Promise<void> {
    const input = io.input ?? process.stdin;
    const output = io.output ?? process.stdout;
    const errorStream = io.error ?? process.stderr;
    const log = createLogger({
      minLevel: logLevel,
      write: (line) => {
        errorStream.write(`${line}\n`);
      },
    });

    let response: ResultResponse | ErrorResponse;
    try {
      const raw = await readOnce(input);
      const parsed: unknown = raw.trim() === "" ? {} : JSON.parse(raw);
      if (!isInvokeRequest(parsed)) {
        response = {
          v: PROTOCOL_VERSION,
          type: "error",
          message: "Malformed or non-v1 invoke request on stdin.",
        };
      } else {
        response = await invoke(parsed, log);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      response = { v: PROTOCOL_VERSION, type: "error", message };
    }

    await new Promise<void>((resolve, reject) => {
      output.write(`${JSON.stringify(response)}\n`, (writeErr) => {
        if (writeErr) reject(writeErr);
        else resolve();
      });
    });
  }

  return { commands, invoke, run };
}
