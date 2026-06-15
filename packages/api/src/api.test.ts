import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  Action,
  ActionPanel,
  Detail,
  List,
  copyToClipboard,
  createLogger,
  createPreferences,
  createStorage,
  defineExtension,
  openUrl,
  showHUD,
  showToast,
  pushView,
  validateManifest,
} from "./index.js";
import type { InvokeRequest } from "./index.js";

function makeRequest(overrides: Partial<InvokeRequest> = {}): InvokeRequest {
  return {
    v: 1,
    type: "invoke",
    command: "search",
    query: "",
    storage: {},
    preferences: {},
    ...overrides,
  };
}

describe("UI builders", () => {
  it("List.Item normalizes optional props to a stable wire shape", () => {
    const item = List.Item({ title: "Hello World" });
    expect(item).toEqual({
      id: "hello-world",
      title: "Hello World",
      subtitle: undefined,
      icon: undefined,
      detail: undefined,
      actions: undefined,
      section: undefined,
    });
  });

  it("List flattens items and sections, stamping section labels", () => {
    const rows = List(
      List.Item({ id: "a", title: "A" }),
      List.Section({
        title: "Group",
        items: [List.Item({ id: "b", title: "B" })],
      }),
    );
    expect(rows.map((r) => [r.id, r.section])).toEqual([
      ["a", undefined],
      ["b", "Group"],
    ]);
  });

  it("Action builders map to the three brokered effect kinds only", () => {
    expect(Action.CopyToClipboard("x").effect).toEqual({ kind: "copy", value: "x" });
    expect(Action.OpenInBrowser("https://x").effect).toEqual({
      kind: "open-url",
      value: "https://x",
    });
    expect(Action.OpenPath("/tmp").effect).toEqual({ kind: "open-path", value: "/tmp" });
  });

  it("ActionPanel preserves order", () => {
    const panel = ActionPanel(Action.CopyToClipboard("a"), Action.OpenInBrowser("b"));
    expect(panel.map((a) => a.effect.kind)).toEqual(["copy", "open-url"]);
  });

  it("Detail produces a single markdown-carrying row", () => {
    const [row] = Detail({ markdown: "# Hi" });
    expect(row?.detail).toBe("# Hi");
    expect(row?.id).toBe("detail");
  });
});

describe("storage", () => {
  it("reads from the snapshot and buffers writes/deletes", () => {
    const storage = createStorage({ a: 1, b: "two" });
    expect(storage.get<number>("a")).toBe(1);
    expect(storage.getOr("missing", 42)).toBe(42);
    storage.set("c", { nested: true });
    storage.remove("a");
    expect(storage.collect()).toEqual([
      { key: "c", value: { nested: true } },
      { key: "a", value: null },
    ]);
    // Snapshot is not mutated by writes.
    expect(storage.get("c")).toBeUndefined();
    expect(storage.getPending("c")).toEqual({ nested: true });
  });
});

describe("preferences", () => {
  it("coerces typed accessors", () => {
    const prefs = createPreferences({ s: "hello", b: "true", n: "3.5", real: 7 });
    expect(prefs.getString("s")).toBe("hello");
    expect(prefs.getString("missing", "def")).toBe("def");
    expect(prefs.getBoolean("b")).toBe(true);
    expect(prefs.getNumber("n")).toBe(3.5);
    expect(prefs.getNumber("real")).toBe(7);
    expect(prefs.getNumber("missing", -1)).toBe(-1);
  });
});

describe("logging", () => {
  it("writes JSON lines and respects min level", () => {
    const lines: string[] = [];
    const log = createLogger({ minLevel: "info", write: (l) => lines.push(l) });
    log.debug("dropped");
    log.info("kept", { k: 1 });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "{}") as { level: string; msg: string; fields: unknown };
    expect(record.level).toBe("info");
    expect(record.msg).toBe("kept");
    expect(record.fields).toEqual({ k: 1 });
  });

  it("child loggers merge base fields", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (l) => lines.push(l) }).child({ command: "x" });
    log.info("hi");
    const record = JSON.parse(lines[0] ?? "{}") as { fields: Record<string, unknown> };
    expect(record.fields["command"]).toBe("x");
  });
});

describe("defineExtension.invoke", () => {
  it("collects items, effects, toast, and storage writes", async () => {
    const ext = defineExtension({
      commands: {
        search: (ctx) => {
          ctx.storage.set("last", ctx.query);
          copyToClipboard("copied");
          openUrl("https://orbit.test");
          showToast("success", "Done", "all good");
          return List(List.Item({ id: "r", title: "Result" }));
        },
      },
    });
    const res = await ext.invoke(makeRequest({ query: "term" }));
    expect(res.type).toBe("result");
    if (res.type !== "result") return;
    expect(res.items.map((i) => i.id)).toEqual(["r"]);
    expect(res.effects).toEqual([
      { kind: "copy", value: "copied" },
      { kind: "open-url", value: "https://orbit.test" },
    ]);
    expect(res.storageWrites).toEqual([{ key: "last", value: "term" }]);
    expect(res.toast).toEqual({ style: "success", title: "Done", message: "all good" });
  });

  it("returns an error response when the handler throws", async () => {
    const ext = defineExtension({
      commands: {
        boom: () => {
          throw new Error("kaboom");
        },
      },
    });
    const res = await ext.invoke(makeRequest({ command: "boom" }));
    expect(res).toEqual({ v: 1, type: "error", message: "kaboom" });
  });

  it("returns an error for unknown commands", async () => {
    const ext = defineExtension({ commands: { a: () => undefined } });
    const res = await ext.invoke(makeRequest({ command: "nope" }));
    expect(res.type).toBe("error");
    if (res.type === "error") expect(res.message).toContain("Unknown command");
  });

  it("supports no-view (void-returning) commands", async () => {
    const ext = defineExtension({
      commands: {
        ping: () => {
          showToast("info", "pong");
        },
      },
    });
    const res = await ext.invoke(makeRequest({ command: "ping" }));
    expect(res.type).toBe("result");
    if (res.type === "result") {
      expect(res.items).toEqual([]);
      expect(res.toast?.title).toBe("pong");
    }
  });
});

describe("deferred / experimental helpers (honesty bar)", () => {
  it("showHUD maps to a success toast (documented, not silent)", async () => {
    const ext = defineExtension({
      commands: {
        hud: () => {
          showHUD("Saved!");
        },
      },
    });
    const res = await ext.invoke(makeRequest({ command: "hud" }));
    if (res.type === "result") expect(res.toast).toEqual({ style: "success", title: "Saved!", message: undefined });
  });

  it("pushView throws rather than silently no-op", async () => {
    const ext = defineExtension({
      commands: {
        nav: () => {
          pushView();
        },
      },
    });
    const res = await ext.invoke(makeRequest({ command: "nav" }));
    expect(res.type).toBe("error");
    if (res.type === "error") expect(res.message).toContain("not supported");
  });

  it("helpers throw when called outside a handler", () => {
    expect(() => showToast("info", "x")).toThrow(/outside a command handler/);
  });
});

describe("run() — full stdin/stdout protocol round-trip", () => {
  it("reads one request, writes one response, never pollutes stdout", async () => {
    const ext = defineExtension({
      commands: {
        search: (ctx) => {
          ctx.log.info("diagnostic-goes-to-stderr");
          return List(List.Item({ id: "x", title: ctx.query }));
        },
      },
    });
    const input = new PassThrough();
    const output = new PassThrough();
    const errorStream = new PassThrough();

    const outChunks: Buffer[] = [];
    output.on("data", (c: Buffer) => outChunks.push(c));
    const errChunks: Buffer[] = [];
    errorStream.on("data", (c: Buffer) => errChunks.push(c));

    const done = ext.run({ input, output, error: errorStream });
    input.end(JSON.stringify(makeRequest({ query: "hi there" })));
    await done;

    const stdout = Buffer.concat(outChunks).toString("utf8").trim();
    const parsed = JSON.parse(stdout) as { type: string; items: { title: string }[] };
    expect(parsed.type).toBe("result");
    expect(parsed.items[0]?.title).toBe("hi there");

    // stdout contained EXACTLY one JSON line.
    expect(stdout.split("\n")).toHaveLength(1);
    // Diagnostics went to stderr.
    expect(Buffer.concat(errChunks).toString("utf8")).toContain("diagnostic-goes-to-stderr");
  });

  it("emits a protocol error for malformed stdin", async () => {
    const ext = defineExtension({ commands: { a: () => undefined } });
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c: Buffer) => chunks.push(c));
    const done = ext.run({ input, output, error: new PassThrough() });
    input.end("not json {{{");
    await done;
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8").trim()) as { type: string };
    expect(parsed.type).toBe("error");
  });
});

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateManifest({
      name: "my-ext",
      title: "My Extension",
      description: "Does things",
      version: "1.0.0",
      main: "index.mjs",
      commands: [{ name: "search", title: "Search", mode: "list", permissions: ["copy"] }],
    });
    expect(result.valid).toBe(true);
    expect(result.manifest?.commands[0]?.name).toBe("search");
  });

  it("reports issues with paths for a malformed manifest", () => {
    const result = validateManifest({
      name: "Bad Name",
      version: "v1",
      commands: [{ name: "x", mode: "wormhole" }],
    });
    expect(result.valid).toBe(false);
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain("name");
    expect(paths).toContain("title");
    expect(paths).toContain("version");
    expect(paths).toContain("commands[0].title");
    expect(paths).toContain("commands[0].mode");
  });
});
