import { z } from 'zod';
import { BRANDING } from '@orbit/branding';

/**
 * Deeplink validation. Deeplinks arrive from untrusted sources (web pages,
 * other apps) so they are parsed strictly into a small set of known routes.
 * Anything not matching a known, validated route is rejected — there is NO
 * generic "execute arbitrary command" route.
 */

const safeId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/);
const safeName = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);

export type Deeplink =
  | { readonly kind: 'open' }
  | { readonly kind: 'command'; readonly id: string }
  | { readonly kind: 'quicklink'; readonly id: string }
  | { readonly kind: 'extension'; readonly name: string; readonly command: string }
  | { readonly kind: 'note'; readonly id: string }
  | { readonly kind: 'ai-new' }
  | { readonly kind: 'agent-run'; readonly id: string }
  | { readonly kind: 'project'; readonly id: string };

export class DeeplinkError extends Error {}

/**
 * Parse a deeplink string into a typed, validated route. Returns null for any
 * URL that is not a recognised, well-formed route for this product's scheme.
 */
export function parseDeeplink(raw: string): Deeplink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Scheme must match the product protocol exactly (case-insensitive).
  if (url.protocol.replace(/:$/, '').toLowerCase() !== BRANDING.protocol) return null;

  // host is the route verb; path supplies parameters.
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  switch (host) {
    case 'open':
      return { kind: 'open' };
    case 'ai':
      if (segments[0] === 'new') return { kind: 'ai-new' };
      return null;
    case 'command': {
      const id = safeId.safeParse(segments[0]);
      return id.success ? { kind: 'command', id: id.data } : null;
    }
    case 'quicklink': {
      const id = safeId.safeParse(segments[0]);
      return id.success ? { kind: 'quicklink', id: id.data } : null;
    }
    case 'note': {
      const id = safeId.safeParse(segments[0]);
      return id.success ? { kind: 'note', id: id.data } : null;
    }
    case 'project': {
      const id = safeId.safeParse(segments[0]);
      return id.success ? { kind: 'project', id: id.data } : null;
    }
    case 'agent': {
      // orbit://agent/<id>/run
      const id = safeId.safeParse(segments[0]);
      if (!id.success || segments[1] !== 'run') return null;
      return { kind: 'agent-run', id: id.data };
    }
    case 'extension': {
      // orbit://extension/<name>/<command>
      const name = safeName.safeParse(segments[0]);
      const command = safeName.safeParse(segments[1]);
      if (!name.success || !command.success) return null;
      return { kind: 'extension', name: name.data, command: command.data };
    }
    default:
      return null;
  }
}
