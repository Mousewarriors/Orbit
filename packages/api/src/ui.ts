import type { Effect, WireAction, WireListItem } from "./protocol.js";

/**
 * Declarative UI builders. Every builder is a pure function returning the
 * normalized wire shape; nothing here performs I/O. The runtime serializes the
 * result of a handler into the protocol response.
 *
 * The model is intentionally close to Raycast's, but honest about what v1
 * supports: there is no live view stack (`pushView`/`popView`) and no `showHUD`
 * — see EXTENSION_SDK.md for the deferred surface and the mappings used.
 */

/** Spec for a single action in an action panel. */
export interface ActionSpec {
  readonly title: string;
  readonly effect: Effect;
  readonly shortcut?: string | undefined;
}

/**
 * Builds a single {@link WireAction}. Because v1 actions can only carry a
 * brokered effect, an action is always paired with one of
 * {@link Action.CopyToClipboard}/{@link Action.OpenInBrowser}/{@link Action.OpenPath}.
 */
export const Action = {
  /** Generic action carrying an arbitrary brokered effect. */
  create(spec: ActionSpec): WireAction {
    return { title: spec.title, effect: spec.effect, shortcut: spec.shortcut ?? undefined };
  },
  /** Copies `content` to the clipboard when triggered. */
  CopyToClipboard(content: string, title = "Copy to Clipboard", shortcut?: string): WireAction {
    return { title, effect: { kind: "copy", value: content }, shortcut: shortcut ?? undefined };
  },
  /** Opens `url` in the default browser when triggered. */
  OpenInBrowser(url: string, title = "Open in Browser", shortcut?: string): WireAction {
    return { title, effect: { kind: "open-url", value: url }, shortcut: shortcut ?? undefined };
  },
  /** Reveals/opens `path` in the OS file manager when triggered. */
  OpenPath(path: string, title = "Open Path", shortcut?: string): WireAction {
    return { title, effect: { kind: "open-path", value: path }, shortcut: shortcut ?? undefined };
  },
} as const;

/**
 * Collects an ordered set of actions into a panel. In v1 the host renders
 * these in the action menu of the focused item; the first action is the
 * primary (Enter) action.
 */
export function ActionPanel(...actions: readonly WireAction[]): readonly WireAction[] {
  return actions;
}

/** Props for {@link List.Item}. */
export interface ListItemProps {
  readonly id?: string | undefined;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly icon?: string | undefined;
  /** Markdown shown in the detail pane when this row is focused. */
  readonly detail?: string | undefined;
  readonly actions?: readonly WireAction[] | undefined;
  readonly section?: string | undefined;
}

/** Props for {@link List.Section}. */
export interface ListSectionProps {
  readonly title: string;
  readonly items: readonly WireListItem[];
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Builds list rows. `List(...)` flattens any mix of items and sections into the
 * flat `WireListItem[]` the protocol expects, stamping `section` labels onto
 * the rows of each section so the host can group them.
 */
export interface ListBuilder {
  (...children: readonly (WireListItem | readonly WireListItem[])[]): readonly WireListItem[];
  Item(props: ListItemProps): WireListItem;
  Section(props: ListSectionProps): readonly WireListItem[];
}

function buildItem(props: ListItemProps): WireListItem {
  return {
    id: props.id ?? (slug(props.title) || "item"),
    title: props.title,
    subtitle: props.subtitle ?? undefined,
    icon: props.icon ?? undefined,
    detail: props.detail ?? undefined,
    actions: props.actions ?? undefined,
    section: props.section ?? undefined,
  };
}

function buildSection(props: ListSectionProps): readonly WireListItem[] {
  return props.items.map((item) =>
    item.section === undefined ? { ...item, section: props.title } : item,
  );
}

function flatten(
  ...children: readonly (WireListItem | readonly WireListItem[])[]
): readonly WireListItem[] {
  const out: WireListItem[] = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      out.push(...(child as readonly WireListItem[]));
    } else {
      out.push(child as WireListItem);
    }
  }
  return out;
}

/** The List builder (callable, with `.Item` and `.Section`). */
export const List: ListBuilder = Object.assign(flatten, {
  Item: buildItem,
  Section: buildSection,
});

/** Props for {@link Detail}. */
export interface DetailProps {
  readonly markdown: string;
  readonly actions?: readonly WireAction[] | undefined;
  /** Title for the single synthesized row. Defaults to "Detail". */
  readonly title?: string | undefined;
}

/**
 * Builds a markdown detail view. In v1 there is no dedicated detail render
 * channel, so a Detail is delivered as a single list item whose `detail`
 * carries the markdown. The host shows the markdown in the detail pane; the
 * synthesized row keeps the result valid even on hosts that always render a
 * list. This mapping is documented and lossless for read-only detail screens.
 */
export function Detail(props: DetailProps): readonly WireListItem[] {
  return [
    {
      id: "detail",
      title: props.title ?? "Detail",
      subtitle: undefined,
      icon: undefined,
      detail: props.markdown,
      actions: props.actions ?? undefined,
      section: undefined,
    },
  ];
}
