/**
 * Structured logging for Orbit extensions.
 *
 * IMPORTANT: stdout is reserved for the protocol response. Every log line is
 * written to **stderr** as a single JSON object so the host (and `orbit logs`)
 * can parse it. Never use `console.log` in an extension handler.
 */

/** Severity levels, ordered least → most severe. */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** A single structured log record emitted to stderr. */
export interface LogRecord {
  readonly ts: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
}

/** A namespaced, leveled logger that writes JSON lines to stderr. */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** Returns a child logger that merges `fields` into every record. */
  child(fields: Record<string, unknown>): Logger;
}

/** Options controlling logger behaviour. */
export interface LoggerOptions {
  /** Records below this level are dropped. Defaults to `info`. */
  readonly minLevel: LogLevel | undefined;
  /** Sink for the rendered line. Defaults to writing to `process.stderr`. */
  readonly write: ((line: string) => void) | undefined;
  /** Static fields merged into every record (used by `child`). */
  readonly baseFields: Readonly<Record<string, unknown>> | undefined;
}

function defaultWrite(line: string): void {
  // Explicit stderr write — never stdout.
  process.stderr.write(`${line}\n`);
}

class JsonLogger implements Logger {
  readonly #minLevel: LogLevel;
  readonly #write: (line: string) => void;
  readonly #baseFields: Readonly<Record<string, unknown>>;

  constructor(options: LoggerOptions) {
    this.#minLevel = options.minLevel ?? "info";
    this.#write = options.write ?? defaultWrite;
    this.#baseFields = options.baseFields ?? {};
  }

  #emit(level: LogLevel, msg: string, fields: Record<string, unknown> | undefined): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.#minLevel]) return;
    const merged = { ...this.#baseFields, ...(fields ?? {}) };
    const hasFields = Object.keys(merged).length > 0;
    const record: LogRecord = {
      ts: new Date().toISOString(),
      level,
      msg,
      fields: hasFields ? merged : undefined,
    };
    this.#write(JSON.stringify(record));
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.#emit("debug", msg, fields);
  }

  info(msg: string, fields?: Record<string, unknown>): void {
    this.#emit("info", msg, fields);
  }

  warn(msg: string, fields?: Record<string, unknown>): void {
    this.#emit("warn", msg, fields);
  }

  error(msg: string, fields?: Record<string, unknown>): void {
    this.#emit("error", msg, fields);
  }

  child(fields: Record<string, unknown>): Logger {
    return new JsonLogger({
      minLevel: this.#minLevel,
      write: this.#write,
      baseFields: { ...this.#baseFields, ...fields },
    });
  }
}

/** Creates a structured stderr logger. */
export function createLogger(options?: Partial<LoggerOptions>): Logger {
  return new JsonLogger({
    minLevel: options?.minLevel,
    write: options?.write,
    baseFields: options?.baseFields,
  });
}
