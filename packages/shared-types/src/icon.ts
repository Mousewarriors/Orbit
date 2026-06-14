/** How a result/command icon is rendered. */
export type IconSource =
  /** A named icon from the built-in Lucide-based icon set. */
  | { readonly kind: 'builtin'; readonly name: string; readonly tint?: string }
  /** An absolute file path to an image (e.g. an extracted app icon). */
  | { readonly kind: 'file'; readonly path: string }
  /** A remote URL (used sparingly; subject to CSP). */
  | { readonly kind: 'url'; readonly url: string }
  /** A single emoji glyph. */
  | { readonly kind: 'emoji'; readonly glyph: string }
  /** A coloured letter avatar fallback. */
  | { readonly kind: 'letter'; readonly text: string; readonly tint?: string };
