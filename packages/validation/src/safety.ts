/**
 * Path and shell-argument safety helpers shared by the host and the permission
 * broker. These are defence-in-depth: the native layer enforces the real
 * boundaries, but validating here keeps obviously-malicious input from ever
 * reaching it and gives extensions clear, early errors.
 */

export class SafetyError extends Error {}

/**
 * Returns true if `child` is contained within `root` after normalisation.
 * Used to keep extension file access inside its sandbox and to reject traversal.
 * Works on both POSIX and Windows-style separators.
 */
export function isPathWithin(root: string, child: string): boolean {
  const norm = (p: string) =>
    p
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/\/$/, '');
  const r = norm(root);
  const c = norm(child);

  // Reject any traversal token outright.
  if (c.split('/').includes('..')) return false;

  const rLower = r.toLowerCase();
  const cLower = c.toLowerCase();
  return cLower === rLower || cLower.startsWith(rLower + '/');
}

/** Reject paths containing traversal, NUL bytes, or that are absolute. */
export function isSafeRelativePath(p: string): boolean {
  if (p.length === 0 || p.length > 1024) return false;
  if (p.includes('\0')) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(p)) return false; // Windows drive
  const parts = p.replace(/\\/g, '/').split('/');
  return !parts.includes('..');
}

/** Characters that enable shell injection when arguments are interpolated. */
const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\r\\"']/;

/**
 * Returns true if a string is safe to pass as a single shell *argument* under
 * the assumption that the host NEVER interpolates it into a shell string and
 * instead passes argv directly. This check is an extra guard for the rare cases
 * a shell is unavoidable (user scripts), where we additionally refuse
 * metacharacters rather than rely solely on quoting.
 */
export function isSafeShellArgument(arg: string): boolean {
  if (arg.includes('\0')) return false;
  return !SHELL_METACHARACTERS.test(arg);
}

/**
 * Validate a URL intended to be opened externally. Only http(s) and mailto are
 * permitted by default; javascript:, file:, data: and others are rejected.
 */
export function isSafeExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}
