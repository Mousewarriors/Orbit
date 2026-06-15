import type { CommandMode, Permission } from "@orbit/api";

/**
 * Built-in extension templates. Each template emits a *working* extension:
 * a valid manifest.json plus an `index.mjs` that imports `@orbit/api` and can
 * be spawned by the host with no manual repair.
 */

/** The set of template ids `orbit extension create --template <t>` accepts. */
export type TemplateId = "no-view" | "list" | "detail" | "preferences" | "storage";

/** All known template ids, in display order. */
export const TEMPLATE_IDS: readonly TemplateId[] = [
  "no-view",
  "list",
  "detail",
  "preferences",
  "storage",
];

/** One file the template wants written, relative to the extension root. */
export interface TemplateFile {
  readonly path: string;
  readonly contents: string;
}

/** A fully-rendered template ready to write to disk. */
export interface RenderedTemplate {
  readonly files: readonly TemplateFile[];
}

/** Inputs needed to render any template. */
export interface TemplateContext {
  /** kebab-case extension name (validated by the caller). */
  readonly name: string;
  /** Human-readable title. */
  readonly title: string;
  /** Version string injected into the manifest. */
  readonly sdkVersion: string;
}

interface ManifestCommand {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly mode: CommandMode;
  readonly permissions?: readonly Permission[];
}

interface ManifestPreference {
  readonly name: string;
  readonly type: "string" | "boolean" | "number" | "password";
  readonly title: string;
  readonly description: string;
  readonly required: boolean;
  readonly default?: string | number | boolean;
}

function manifestJson(input: {
  name: string;
  title: string;
  description: string;
  commands: readonly ManifestCommand[];
  preferences?: readonly ManifestPreference[];
}): string {
  const manifest: Record<string, unknown> = {
    name: input.name,
    title: input.title,
    description: input.description,
    version: "0.1.0",
    icon: "icon.png",
    main: "index.mjs",
    commands: input.commands,
  };
  if (input.preferences && input.preferences.length > 0) {
    manifest["preferences"] = input.preferences;
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function packageJson(name: string, sdkVersion: string): string {
  const pkg = {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    main: "index.mjs",
    dependencies: {
      "@orbit/api": `^${sdkVersion}`,
    },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function readme(title: string, body: string): string {
  return `# ${title}\n\n${body}\n\nBuilt with the Orbit Extension SDK (\`@orbit/api\`).\nRun \`orbit extension dev\` to validate while you edit, and\n\`orbit extension package\` to produce a distributable artifact.\n`;
}

const NO_VIEW_ENTRY = `import { defineExtension, openUrl, showToast } from "@orbit/api";

/**
 * A "no-view" command performs an action and shows a toast instead of
 * returning a list. Here we open the Orbit docs and confirm with a toast.
 */
const extension = defineExtension({
  commands: {
    "open-docs": (ctx) => {
      ctx.log.info("open-docs invoked", { query: ctx.query });
      openUrl("https://orbit.example/docs");
      showToast("success", "Opening docs", "Heading to the Orbit documentation");
    },
  },
});

await extension.run();
`;

const LIST_ENTRY = `import { Action, defineExtension, List } from "@orbit/api";

/**
 * A "list" command returns rows. Each row can carry actions that compile down
 * to brokered effects (copy / open-url / open-path). The query filters the rows.
 */
const FRUITS = ["Apple", "Banana", "Cherry", "Date", "Elderberry"];

const extension = defineExtension({
  commands: {
    search: (ctx) => {
      const q = ctx.query.trim().toLowerCase();
      const matches = FRUITS.filter((f) => f.toLowerCase().includes(q));
      return List(
        ...matches.map((fruit) =>
          List.Item({
            id: fruit.toLowerCase(),
            title: fruit,
            subtitle: \`\${fruit.length} letters\`,
            actions: [
              Action.CopyToClipboard(fruit, "Copy name", "cmd+c"),
              Action.OpenInBrowser(\`https://en.wikipedia.org/wiki/\${fruit}\`),
            ],
          }),
        ),
      );
    },
  },
});

await extension.run();
`;

const DETAIL_ENTRY = `import { Action, defineExtension, Detail } from "@orbit/api";

/**
 * A "detail" command returns a markdown detail view. In protocol v1 this is a
 * single row whose detail carries the markdown (see EXTENSION_SDK.md).
 */
const extension = defineExtension({
  commands: {
    about: (ctx) => {
      const md = [
        "# About this extension",
        "",
        \`You searched for: **\${ctx.query || "(nothing yet)"}**\`,
        "",
        "- Markdown is rendered in the detail pane.",
        "- Actions below copy or open links.",
      ].join("\\n");
      return Detail({
        markdown: md,
        actions: [Action.CopyToClipboard(md, "Copy markdown")],
      });
    },
  },
});

await extension.run();
`;

const PREFERENCES_ENTRY = `import { defineExtension, List } from "@orbit/api";

/**
 * Reads user-configured preferences from ctx.preferences. The host resolves
 * defaults + overrides from the manifest's "preferences" block.
 */
const extension = defineExtension({
  commands: {
    greet: (ctx) => {
      const who = ctx.preferences.getString("name", "world");
      const excited = ctx.preferences.getBoolean("excited", false);
      const greeting = \`Hello, \${who}\${excited ? "!" : "."}\`;
      ctx.log.info("greet", { who, excited });
      return List(List.Item({ id: "greeting", title: greeting }));
    },
  },
});

await extension.run();
`;

const STORAGE_ENTRY = `import { defineExtension, List, showToast } from "@orbit/api";

/**
 * Demonstrates namespaced local storage: reads the previous count from the
 * snapshot, increments it, and buffers the write (applied by the host after
 * the handler returns).
 */
const extension = defineExtension({
  commands: {
    count: (ctx) => {
      const previous = ctx.storage.getOr("count", 0);
      const next = (typeof previous === "number" ? previous : 0) + 1;
      ctx.storage.set("count", next);
      showToast("info", "Counted", \`This command has run \${next} time(s)\`);
      return List(
        List.Item({ id: "count", title: \`Run count: \${next}\` }),
      );
    },
  },
});

await extension.run();
`;

function commonFiles(ctx: TemplateContext, entry: string): TemplateFile[] {
  return [
    { path: "index.mjs", contents: entry },
    { path: "package.json", contents: packageJson(ctx.name, ctx.sdkVersion) },
    { path: ".gitignore", contents: "node_modules/\n*.log\n" },
  ];
}

/** Renders the template `id` for the given context. */
export function renderTemplate(id: TemplateId, ctx: TemplateContext): RenderedTemplate {
  switch (id) {
    case "no-view":
      return {
        files: [
          {
            path: "manifest.json",
            contents: manifestJson({
              name: ctx.name,
              title: ctx.title,
              description: "Opens the Orbit docs (no-view command).",
              commands: [
                {
                  name: "open-docs",
                  title: "Open Docs",
                  description: "Open the Orbit documentation",
                  mode: "no-view",
                  permissions: ["open-url"],
                },
              ],
            }),
          },
          ...commonFiles(ctx, NO_VIEW_ENTRY),
          { path: "README.md", contents: readme(ctx.title, "A no-view command extension.") },
        ],
      };
    case "list":
      return {
        files: [
          {
            path: "manifest.json",
            contents: manifestJson({
              name: ctx.name,
              title: ctx.title,
              description: "Searches a fruit list (list command).",
              commands: [
                {
                  name: "search",
                  title: "Search Fruit",
                  description: "Search a list of fruit",
                  mode: "list",
                  permissions: ["copy", "open-url"],
                },
              ],
            }),
          },
          ...commonFiles(ctx, LIST_ENTRY),
          { path: "README.md", contents: readme(ctx.title, "A list command extension.") },
        ],
      };
    case "detail":
      return {
        files: [
          {
            path: "manifest.json",
            contents: manifestJson({
              name: ctx.name,
              title: ctx.title,
              description: "Shows a markdown detail view (detail command).",
              commands: [
                {
                  name: "about",
                  title: "About",
                  description: "Show a markdown detail view",
                  mode: "detail",
                  permissions: ["copy"],
                },
              ],
            }),
          },
          ...commonFiles(ctx, DETAIL_ENTRY),
          { path: "README.md", contents: readme(ctx.title, "A detail command extension.") },
        ],
      };
    case "preferences":
      return {
        files: [
          {
            path: "manifest.json",
            contents: manifestJson({
              name: ctx.name,
              title: ctx.title,
              description: "Greets you using preferences (preferences demo).",
              commands: [
                {
                  name: "greet",
                  title: "Greet",
                  description: "Greet using configured preferences",
                  mode: "list",
                },
              ],
              preferences: [
                {
                  name: "name",
                  type: "string",
                  title: "Your name",
                  description: "Who to greet",
                  required: false,
                  default: "world",
                },
                {
                  name: "excited",
                  type: "boolean",
                  title: "Excited?",
                  description: "Add an exclamation mark",
                  required: false,
                  default: false,
                },
              ],
            }),
          },
          ...commonFiles(ctx, PREFERENCES_ENTRY),
          { path: "README.md", contents: readme(ctx.title, "A preferences-driven extension.") },
        ],
      };
    case "storage":
      return {
        files: [
          {
            path: "manifest.json",
            contents: manifestJson({
              name: ctx.name,
              title: ctx.title,
              description: "Counts invocations using local storage (storage demo).",
              commands: [
                {
                  name: "count",
                  title: "Count",
                  description: "Increment a stored counter",
                  mode: "list",
                },
              ],
            }),
          },
          ...commonFiles(ctx, STORAGE_ENTRY),
          { path: "README.md", contents: readme(ctx.title, "A local-storage extension.") },
        ],
      };
    default: {
      // Exhaustiveness guard.
      const never: never = id;
      throw new Error(`Unknown template: ${String(never)}`);
    }
  }
}
