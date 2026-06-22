/**
 * Subscription sign-in orchestrator.
 *
 * Drives the OAuth Authorization-Code + PKCE flow end-to-end from the renderer
 * using the pure primitives in `@orbit/ai-runtime` (`oauth.ts`):
 *   1. generate PKCE + state,
 *   2. start the Rust loopback callback server (binds before the browser opens),
 *   3. open the provider's authorize page in the system browser,
 *   4. await the redirect (validating `state`), exchange the code for tokens,
 *   5. persist the token set in OS secure storage.
 *
 * Everything that touches the OS is funnelled through an injected `OAuthBridge`
 * so the whole flow is unit-tested with no Tauri and no network. The production
 * bridge (`nativeOAuthBridge`) wires it to the native commands + secure storage.
 */
import {
  authCodeTokenBody,
  buildAuthorizeUrl,
  generatePkce,
  isExpired,
  parseStoredTokens,
  parseTokenResponse,
  randomState,
  refreshTokenBody,
  serializeTokens,
  tokenContentType,
  type CryptoLike,
  type OAuthProviderConfig,
  type OAuthTokens,
} from '@orbit/ai-runtime';
import * as native from '../native.js';

export interface OAuthCallback {
  readonly requestId: string;
  readonly code?: string;
  readonly state?: string;
  readonly error?: string;
}

/** The OS surface the flow needs; injectable so the orchestrator is testable. */
export interface OAuthBridge {
  /** Bind the loopback server (returns the actual bound port). */
  listen(requestId: string, port: number, path: string, timeoutMs: number): Promise<number>;
  cancel(requestId: string): Promise<void>;
  /** Subscribe to redirect callbacks; returns an unsubscribe. */
  onCallback(handler: (ev: OAuthCallback) => void): Promise<() => void>;
  openUrl(url: string): Promise<void>;
  /** POST a body with the given content type, returning the HTTP status + text body. */
  post(url: string, body: string, contentType: string): Promise<{ status: number; body: string }>;
  secretSet(key: string, value: string): Promise<void>;
  secretGet(key: string): Promise<string | null>;
  secretDelete(key: string): Promise<void>;
  now(): number;
  randomId(): string;
  crypto: CryptoLike;
}

const DEFAULT_TIMEOUT_MS = 180_000;

/** The production bridge over Orbit's native commands. */
export function nativeOAuthBridge(): OAuthBridge {
  return {
    listen: (id, port, path, timeoutMs) => native.oauthListen(id, port, path, timeoutMs),
    cancel: (id) => native.oauthCancel(id),
    onCallback: (handler) =>
      native.onOauthCallback((ev) =>
        handler({
          requestId: ev.requestId,
          ...(ev.code ? { code: ev.code } : {}),
          ...(ev.state ? { state: ev.state } : {}),
          ...(ev.error ? { error: ev.error } : {}),
        }),
      ),
    openUrl: (url) => native.openUrl(url),
    post: (url, body, contentType) =>
      native.httpRequest('POST', url, { 'Content-Type': contentType, Accept: 'application/json' }, body),
    secretSet: (key, value) => native.secretSet(key, value),
    secretGet: (key) => native.secretGet(key),
    secretDelete: (key) => native.secretDelete(key),
    now: () => Date.now(),
    randomId: () =>
      `oauth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    crypto: globalThis.crypto as CryptoLike,
  };
}

/** Wait for the matching redirect callback (or time out), then stop listening. */
function awaitCallback(
  bridge: OAuthBridge,
  requestId: string,
  timeoutMs: number,
): { promise: Promise<OAuthCallback>; dispose: () => Promise<void> } {
  let unlisten: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const dispose = async (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (unlisten) unlisten();
    unlisten = null;
    await bridge.cancel(requestId).catch(() => {});
  };

  const promise = new Promise<OAuthCallback>((resolve, reject) => {
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      void dispose().finally(fn);
    };
    timer = setTimeout(
      () => finish(() => reject(new Error('Sign-in timed out — no redirect received.'))),
      timeoutMs,
    );
    void bridge
      .onCallback((ev) => {
        if (ev.requestId !== requestId) return;
        finish(() => {
          if (ev.error) reject(new Error(`Sign-in failed: ${ev.error}`));
          else if (!ev.code) reject(new Error('Sign-in failed: no authorization code returned.'));
          else resolve(ev);
        });
      })
      .then((u) => {
        unlisten = u;
        // Lost the race (already settled before subscription resolved): clean up.
        if (settled) u();
      })
      .catch((e) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))));
  });

  return { promise, dispose };
}

/** Run the full interactive sign-in for `cfg`, persisting tokens on success. */
export async function signIn(
  cfg: OAuthProviderConfig,
  bridge: OAuthBridge = nativeOAuthBridge(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<OAuthTokens> {
  const requestId = bridge.randomId();
  const state = randomState(bridge.crypto);
  const pkce = cfg.usePkce ? await generatePkce(bridge.crypto) : null;

  const waiter = awaitCallback(bridge, requestId, timeoutMs);
  try {
    await bridge.listen(requestId, cfg.redirectPort, cfg.redirectPath, timeoutMs);
    const authUrl = buildAuthorizeUrl(cfg, {
      state,
      ...(pkce ? { challenge: pkce.challenge } : {}),
    });
    await bridge.openUrl(authUrl);

    const cb = await waiter.promise;
    if (cb.state !== state) throw new Error('Sign-in failed: state mismatch (possible CSRF).');

    const body = authCodeTokenBody(cfg, {
      code: cb.code!,
      state,
      ...(pkce ? { verifier: pkce.verifier } : {}),
    });
    const res = await bridge.post(cfg.tokenUrl, body, tokenContentType(cfg));
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Token exchange failed (HTTP ${res.status}): ${res.body.slice(0, 300)}`);
    }
    const tokens = parseTokenResponse(JSON.parse(res.body), bridge.now());
    await bridge.secretSet(cfg.secretName, serializeTokens(tokens));
    return tokens;
  } finally {
    await waiter.dispose();
  }
}

/** Forget a stored token set. */
export async function signOut(
  cfg: OAuthProviderConfig,
  bridge: OAuthBridge = nativeOAuthBridge(),
): Promise<void> {
  await bridge.secretDelete(cfg.secretName);
}

/** Load the stored token set (or null). */
export async function loadTokens(
  cfg: OAuthProviderConfig,
  bridge: OAuthBridge = nativeOAuthBridge(),
): Promise<OAuthTokens | null> {
  return parseStoredTokens(await bridge.secretGet(cfg.secretName).catch(() => null));
}

/**
 * Exchange a refresh token for a fresh set, persisting it. Returns null when no
 * refresh token is available (the caller must re-run interactive sign-in).
 */
export async function refreshTokens(
  cfg: OAuthProviderConfig,
  tokens: OAuthTokens,
  bridge: OAuthBridge = nativeOAuthBridge(),
): Promise<OAuthTokens | null> {
  if (!tokens.refreshToken) return null;
  const res = await bridge.post(
    cfg.tokenUrl,
    refreshTokenBody(cfg, tokens.refreshToken),
    tokenContentType(cfg),
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Token refresh failed (HTTP ${res.status}): ${res.body.slice(0, 300)}`);
  }
  const parsed = parseTokenResponse(JSON.parse(res.body), bridge.now());
  // Some providers omit the refresh token on refresh — keep the previous one.
  const next: OAuthTokens = parsed.refreshToken
    ? parsed
    : { ...parsed, refreshToken: tokens.refreshToken };
  await bridge.secretSet(cfg.secretName, serializeTokens(next));
  return next;
}

/**
 * Return a non-expired access token for `cfg`, refreshing if needed. Null means
 * the user is not signed in (or the session can't be refreshed silently).
 */
export async function getValidAccessToken(
  cfg: OAuthProviderConfig,
  bridge: OAuthBridge = nativeOAuthBridge(),
): Promise<string | null> {
  const tokens = await loadTokens(cfg, bridge);
  if (!tokens) return null;
  if (!isExpired(tokens, bridge.now())) return tokens.accessToken;
  const refreshed = await refreshTokens(cfg, tokens, bridge).catch(() => null);
  return refreshed?.accessToken ?? null;
}
