# Orbit Extension SDK (`@orbit/api`) and the `orbit` CLI

This document describes the Orbit Extension SDK and the `orbit` extension CLI:
the public API surface, what the v1 extension protocol supports vs. what is
deferred, and a "write your first extension" walkthrough.

> **Repository note (read this first).** This SDK + CLI were built as a
> **self-contained workspace under `packages/`** (`@orbit/api`, `@orbit/cli`),
> with their own `package.json` (npm workspaces), `tsconfig.base.json`,
> `vitest.config.ts`, and `eslint.config.js`. The repository this currently
> lives in does **not** contain the Orbit Tauri/Rust host, the
> `extension-sdk` one-shot package, `crates/orbit-extensions`, or example
> extensions that the task brief referenced — none of those paths exist here.
> Everything below is therefore implemented against the **protocol contract
> itself** (documented in `packages/api/src/protocol.ts`), which is fully
> self-describing and is exercised end-to-end by spawning real `node` processes
> in the tests. When the actual host is present, the SDK is designed to drop in:
> an extension `index.mjs` imports `@orbit/api` and calls `await ext.run()`,
> exactly as it would import `@orbit/extension-sdk` today.

---

## 1. The v1 protocol (the contract everything compiles to)

The host launches an extension with `node <main>`, then performs a strict
**one-shot** exchange:

1. Host writes **one** JSON request to the child's **stdin**:

   ```json
   {
     "v": 1,
     "type": "invoke",
     "command": "search",
     "query": "user text",
     "storage": { "key": "value" },
     "preferences": { "name": "Ada" }
   }
   ```

2. Extension writes **one** JSON response to its **stdout** and exits:

   ```json
   {
     "v": 1,
     "type": "result",
     "items": [ /* WireListItem[] */ ],
     "effects": [ /* Effect[] */ ],
     "storageWrites": [ /* StorageWrite[] */ ],
     "toast": { "style": "success", "title": "...", "message": "..." }
   }
   ```

   or, on failure:

   ```json
   { "v": 1, "type": "error", "message": "what went wrong" }
   ```

**Hard rules enforced by this design:**

- **stdout is the protocol channel.** An extension must never `console.log`.
  All diagnostics go to **stderr** via the SDK logger. The tests assert that a
  run produces *exactly one* JSON line on stdout.
- **Effects are limited to three brokered kinds**: `open-url`, `copy`,
  `open-path`. The host validates each effect against the manifest's declared
  `permissions` before performing it. The SDK exposes no other effect kind.
- **Storage is namespaced**: reads come from the immutable `storage` snapshot
  in the request; writes are returned in `storageWrites` and applied by the
  host *after* the handler returns.
- **One process per invocation.** There is no persistent state between
  invocations and no mid-handler round-trips to the host.

The authoritative TypeScript types live in
[`packages/api/src/protocol.ts`](../../packages/api/src/protocol.ts).

---

## 2. API surface (`@orbit/api`)

### Registration & runtime

| Export | Purpose |
| --- | --- |
| `defineExtension({ commands, logLevel? })` | Register command handlers. Returns an `Extension`. |
| `Extension.run(io?)` | Read one request from stdin, run it, write one response to stdout. The entry point for `index.mjs`. |
| `Extension.invoke(request, logger?)` | Run a parsed request and return the response object (used in tests). |
| `useContext()` | Returns the active `CommandContext`; throws if called outside a handler. |

A handler receives a `CommandContext`:

```ts
interface CommandContext {
  command: string;
  query: string;
  storage: LocalStorage;       // namespaced get/set/remove
  preferences: Preferences;    // typed getString/getBoolean/getNumber
  log: Logger;                 // structured stderr logger
  effects: EffectSink;         // copy/openUrl/openPath/showToast
}
```

A handler returns the rows to render (via `List`/`Detail`), or nothing for a
no-view command. Throwing produces a protocol `error` response.

### UI builders

| Export | Maps to |
| --- | --- |
| `List(...items \| sections)` | Flattens into `WireListItem[]`, stamping section labels. |
| `List.Item({ title, subtitle?, icon?, detail?, actions?, section? })` | One `WireListItem`. |
| `List.Section({ title, items })` | Tags items with a section heading. |
| `Detail({ markdown, actions?, title? })` | A single markdown-carrying row (see §3). |
| `ActionPanel(...actions)` | Ordered action list; first action is primary. |
| `Action.CopyToClipboard / OpenInBrowser / OpenPath / create` | One `WireAction` carrying a brokered effect. |

### Effects, toast, preferences, storage, logging

| Export | Notes |
| --- | --- |
| `showToast(style, title, message?)` | Buffers a toast (the protocol carries one `toast`; last call wins, a warning is logged on overwrite). |
| `copyToClipboard(text)` | Buffers a `copy` effect. |
| `openUrl(url)` | Buffers an `open-url` effect. |
| `openPath(path)` | Buffers an `open-path` effect. |
| `getPreferences()` / `ctx.preferences` | `getString`, `getBoolean`, `getNumber`, `get`, `all`. |
| `getLocalStorage()` / `ctx.storage` | `get`, `getOr`, `set`, `remove`, `keys`, `getPending`. |
| `createLogger(opts?)` / `ctx.log` | JSON lines to **stderr**; `debug/info/warn/error`, `child(fields)`. |

The module-level helpers (`showToast`, `copyToClipboard`, …) resolve the active
invocation via an `AsyncLocalStorage`-bound context, so they only work *inside*
a running handler and **throw** otherwise — they never silently no-op.

### Manifest & validation

`validateManifest(input)` returns `{ valid, issues, manifest }`, mirroring the
host's manifest rules (kebab-case names, semver version, non-empty commands,
valid command `mode`, brokered-only `permissions`, typed preferences). The
`orbit` CLI's `validate`/`dev`/`package` all use this single source of truth.
Types: `ExtensionManifest`, `CommandSpec`, `PreferenceSpec`, `Permission`.

---

## 3. Supported vs. deferred (the honesty bar)

The v1 one-shot model cannot faithfully express everything a stateful launcher
SDK (e.g. Raycast) can. Rather than ship functions that silently do nothing,
the SDK either maps to the closest supported primitive **and documents it**, or
throws with a clear reason.

| Capability | Status | Behaviour |
| --- | --- | --- |
| List / List.Item / List.Section | **Supported** | Native `items`. |
| Detail (markdown) | **Supported (mapped)** | Delivered as a single list item whose `detail` carries the markdown. Lossless for read-only detail screens; documented in `ui.ts`. |
| ActionPanel + Action | **Supported** | Actions carry one brokered effect each. |
| `copyToClipboard` / `openUrl` / `openPath` | **Supported** | The three brokered effect kinds. |
| `showToast` | **Supported** | Single `toast`; last call wins (warned). |
| Preferences (read) | **Supported** | From `ctx.preferences`. |
| Local storage | **Supported** | Read snapshot + buffered `storageWrites`. |
| Structured logging | **Supported** | JSON lines to stderr. |
| `showHUD(text)` | **`@experimental` (mapped)** | v1 has no HUD channel, so it maps to a **success toast** with the same text and logs a warning. The window-dismiss behaviour is **not** reproduced. Prefer `showToast` directly. |
| `pushView()` / `popView()` | **Not supported** | Live navigation needs a stateful multi-message session; v1 is request→response. These **throw** with guidance: model each view as its own command, or return a `List`/`Detail`. |
| Writing prefs / re-reading own writes mid-handler | **Not supported** | Writes are applied by the host *after* the handler; the in-handler snapshot does not mutate. Use `storage.getPending()` to read what you buffered. |

---

## 4. The `orbit` CLI

```
orbit extension <command> [options]

  create <name> --template <t>   Scaffold a working extension
  validate [dir]                 Validate manifest.json against the schema
  build [dir]                    Validate + node --check the entry
  dev [dir]                      Watch, re-validate, report errors on change
  package [dir] [--out <zip>]    Validate then produce a distributable .zip
  logs [dir] [--limit <n>]       Print the extension's structured logs

Templates: no-view, list, detail, preferences, storage
```

- **`create`** emits a complete extension (valid `manifest.json` + `index.mjs`
  importing `@orbit/api` + `package.json` + `README.md`) that runs with no
  manual repair. Pick the template with `--template`; `--cwd` controls where the
  folder is created; `--force` overwrites.
- **`validate`** parses the manifest, runs `validateManifest`, reports each
  issue with a JSON-path-ish location, and checks that the declared entry
  exists.
- **`build`** validates, then runs `node --check` on the entry to catch syntax
  errors. There is no compile step for `.mjs` extensions.
- **`dev`** does a validate+build pass, then watches the manifest and JS/MJS
  sources, re-running the pass (debounced) on every change with readable output.
- **`package`** validates, then zips the extension (minus `node_modules`/`.git`)
  into a distributable `.zip` using a **dependency-free, built-in ZIP writer**
  (`node:zlib` only — see `packages/cli/src/zip.ts`). Output defaults to
  `<name>-<version>.zip`.
- **`logs`** pretty-prints the extension's structured NDJSON logs from
  `<dir>/.orbit/logs.ndjson` (where the host tees the extension's stderr).

The CLI prefers Node built-ins (`node:fs`, `node:child_process`, `node:zlib`)
and has exactly one runtime dependency: `@orbit/api` (for the shared manifest
schema).

### A note on `@orbit/api` resolution

A scaffolded extension imports the bare specifier `@orbit/api`. For it to run,
that package must be resolvable from the extension directory:

- **Inside this workspace**, npm hoisting resolves it automatically.
- **Elsewhere**, run `npm install` in the extension folder (the generated
  `package.json` lists `@orbit/api` as a dependency), or let the host provide
  the SDK on the module path. The e2e test reproduces `npm install` by
  symlinking the built package into the temp extension's `node_modules`.

---

## 5. Write your first extension

```bash
# From the packages/ workspace (so @orbit/api resolves via hoisting):
node cli/dist/bin/orbit.js extension create hello --template list --cwd /tmp
# (or, once linked on PATH: `orbit extension create hello --template list`)
```

This produces `/tmp/hello/`:

```
hello/
  manifest.json     # name, title, version, main, commands[], permissions
  index.mjs         # imports @orbit/api, calls await ext.run()
  package.json      # depends on @orbit/api
  README.md
```

`index.mjs` (list template, abridged):

```js
import { Action, defineExtension, List } from "@orbit/api";

const FRUITS = ["Apple", "Banana", "Cherry", "Date", "Elderberry"];

const extension = defineExtension({
  commands: {
    search: (ctx) => {
      const q = ctx.query.trim().toLowerCase();
      return List(
        ...FRUITS.filter((f) => f.toLowerCase().includes(q)).map((fruit) =>
          List.Item({
            id: fruit.toLowerCase(),
            title: fruit,
            actions: [
              Action.CopyToClipboard(fruit, "Copy name", "cmd+c"),
              Action.OpenInBrowser(`https://en.wikipedia.org/wiki/${fruit}`),
            ],
          }),
        ),
      );
    },
  },
});

await extension.run();
```

Validate, then drive it through the real protocol:

```bash
orbit extension validate /tmp/hello

echo '{"v":1,"type":"invoke","command":"search","query":"err","storage":{},"preferences":{}}' \
  | node /tmp/hello/index.mjs
# => {"v":1,"type":"result","items":[{"id":"cherry",...},{"id":"elderberry",...}],...}
```

Package it for distribution:

```bash
orbit extension package /tmp/hello --out /tmp/hello.zip
```

### Templates at a glance

- **`no-view`** — performs an action (`openUrl`) and shows a toast; returns no rows.
- **`list`** — filters a list by the query and attaches per-item actions.
- **`detail`** — returns a markdown `Detail` view with a copy action.
- **`preferences`** — reads `ctx.preferences` (string + boolean) declared in the manifest.
- **`storage`** — reads/increments a counter via namespaced `LocalStorage`.

---

## 6. Building, testing, and the quality gate

From `packages/`:

```bash
npm install        # installs devDeps + links the workspace packages
npm run build      # tsc --build (emits api/dist and cli/dist)
npm run typecheck  # strict TS, includes test files
npm run lint       # eslint, --max-warnings 0
npm test           # vitest: SDK unit tests + CLI end-to-end lifecycle
```

Strict-TS conventions followed throughout: optional properties typed
`T | undefined` (not `prop?:`) under `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `import type` for type-only imports
(`verbatimModuleSyntax`), `.js` extensions on relative ESM imports, and no
`eval`. The `build`/lint/typecheck configs were authored to pass without
weakening any rule.
```
