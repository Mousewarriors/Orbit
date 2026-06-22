/**
 * OAuth 2.0 (Authorization Code + PKCE) primitives for "sign in with your
 * subscription" — using a ChatGPT/Codex or Claude account instead of a
 * per-token API key.
 *
 * This module is deliberately **pure and provider-agnostic**: PKCE generation,
 * the authorize-URL builder, token-request bodies, and the token lifecycle
 * (parse / expiry / serialise) — all unit-testable with no network and no Tauri.
 * The browser round-trip (loopback redirect listener, opening the browser, the
 * token POST and secure storage) lives in the renderer orchestrator
 * (`apps/desktop/src/ai/oauthFlow.ts`) over an injected bridge, and the loopback
 * server itself lives in Rust (`src-tauri/src/oauth.rs`).
 *
 * Honesty note: the per-provider values in `OAUTH_PROVIDERS` mirror the public,
 * first-party desktop clients (OpenAI Codex CLI, Anthropic Claude Code). They
 * are **experimental** — the endpoints/client-ids can change and using a
 * subscription login from a third-party app may be subject to provider terms.
 * The generic machinery here is correct regardless; only the config may need
 * updating. Using the resulting token for inference (the responses / messages
 * APIs differ from Chat Completions) is a separate adapter, intentionally not in
 * this module.
 */

/**
 * Minimal crypto surface this module needs (Web Crypto); injectable for tests.
 * Typed with core types only (the package's TS lib is ES2022, no DOM) — the real
 * `globalThis.crypto` satisfies this structurally at the call sites.
 */
export interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
}

function defaultCrypto(): CryptoLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c?.subtle) throw new Error('Web Crypto is unavailable in this environment');
  return c;
}

/** RFC 4648 base64url (no padding) of raw bytes. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomUrlToken(byteLength: number, crypto: CryptoLike): string {
  const a = new Uint8Array(byteLength);
  crypto.getRandomValues(a);
  return base64UrlEncode(a);
}

/** An opaque anti-CSRF `state` value. */
export function randomState(crypto: CryptoLike = defaultCrypto()): string {
  return randomUrlToken(32, crypto);
}

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: 'S256';
}

/** Generate a PKCE verifier + S256 challenge (RFC 7636). */
export async function generatePkce(crypto: CryptoLike = defaultCrypto()): Promise<Pkce> {
  const verifier = randomUrlToken(32, crypto);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)), method: 'S256' };
}

export type OAuthProviderId = 'openai-codex' | 'anthropic-claude';

export interface OAuthProviderConfig {
  readonly id: OAuthProviderId;
  readonly label: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly scope: string;
  /** Redirect URI registered for the client — must match exactly. */
  readonly redirectUri: string;
  /** Loopback port to bind (the redirect host:port). */
  readonly redirectPort: number;
  /** Path component of the redirect URI (what the loopback server matches). */
  readonly redirectPath: string;
  /** Extra authorize-request query params some clients require. */
  readonly extraAuthParams?: Readonly<Record<string, string>>;
  readonly usePkce: boolean;
  /**
   * Encoding for the token-exchange request body. Standard OAuth servers use
   * `form` (application/x-www-form-urlencoded); Anthropic's token endpoint
   * requires `json`.
   */
  readonly tokenBodyFormat: 'form' | 'json';
  /** Whether to echo `state` in the token-exchange body (Anthropic requires it). */
  readonly sendStateInToken?: boolean;
  /** OS secure-storage key under which the token set is persisted. */
  readonly secretName: string;
  /** Short, honest description of status/risk shown in the UI. */
  readonly note: string;
}

/**
 * Provider registry. Values mirror the public first-party desktop clients and
 * are **experimental** (see the module note). Kept as data so a correction is a
 * one-line change.
 */
export const OAUTH_PROVIDERS: Readonly<Record<OAuthProviderId, OAuthProviderConfig>> = {
  'openai-codex': {
    id: 'openai-codex',
    label: 'ChatGPT / Codex',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    scope: 'openid profile email offline_access',
    redirectUri: 'http://localhost:1455/auth/callback',
    redirectPort: 1455,
    redirectPath: '/auth/callback',
    extraAuthParams: { id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true' },
    usePkce: true,
    tokenBodyFormat: 'form',
    secretName: 'ai.oauth.openai-codex',
    note: 'Experimental — signs in with a ChatGPT account via the public Codex CLI client. Requires a paid ChatGPT plan; subject to OpenAI’s terms.',
  },
  'anthropic-claude': {
    id: 'anthropic-claude',
    label: 'Claude (Pro/Max)',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    scope: 'org:create_api_key user:profile user:inference',
    redirectUri: 'http://localhost:54545/callback',
    redirectPort: 54545,
    redirectPath: '/callback',
    usePkce: true,
    tokenBodyFormat: 'json',
    sendStateInToken: true,
    secretName: 'ai.oauth.anthropic-claude',
    note: 'Experimental — signs in with a Claude account via the public Claude Code client. Requires a paid Claude plan; subject to Anthropic’s terms.',
  },
};

export function oauthProvider(id: string): OAuthProviderConfig | undefined {
  return (OAUTH_PROVIDERS as Record<string, OAuthProviderConfig>)[id];
}

export interface AuthorizeUrlOptions {
  readonly state: string;
  readonly challenge?: string;
  /** Override the registered redirect (e.g. an ephemeral loopback port). */
  readonly redirectUri?: string;
}

/** Build the provider authorize URL the browser is sent to. */
export function buildAuthorizeUrl(cfg: OAuthProviderConfig, opts: AuthorizeUrlOptions): string {
  const u = new URL(cfg.authorizeUrl);
  const p = u.searchParams;
  p.set('response_type', 'code');
  p.set('client_id', cfg.clientId);
  p.set('redirect_uri', opts.redirectUri ?? cfg.redirectUri);
  if (cfg.scope) p.set('scope', cfg.scope);
  p.set('state', opts.state);
  if (cfg.usePkce && opts.challenge) {
    p.set('code_challenge', opts.challenge);
    p.set('code_challenge_method', 'S256');
  }
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) p.set(k, v);
  return u.toString();
}

/** Content-Type header for this provider's token-exchange request. */
export function tokenContentType(cfg: OAuthProviderConfig): string {
  return cfg.tokenBodyFormat === 'json'
    ? 'application/json'
    : 'application/x-www-form-urlencoded';
}

/** Encode token-request params as form or JSON per the provider config. */
function encodeTokenBody(cfg: OAuthProviderConfig, params: Record<string, string>): string {
  if (cfg.tokenBodyFormat === 'json') return JSON.stringify(params);
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) f.set(k, v);
  return f.toString();
}

/** Request body for the `authorization_code` → token exchange. */
export function authCodeTokenBody(
  cfg: OAuthProviderConfig,
  args: { code: string; verifier?: string; redirectUri?: string; state?: string },
): string {
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code: args.code,
    client_id: cfg.clientId,
    redirect_uri: args.redirectUri ?? cfg.redirectUri,
  };
  if (cfg.usePkce && args.verifier) params['code_verifier'] = args.verifier;
  if (cfg.sendStateInToken && args.state) params['state'] = args.state;
  return encodeTokenBody(cfg, params);
}

/** Request body for a `refresh_token` grant. */
export function refreshTokenBody(cfg: OAuthProviderConfig, refreshToken: string): string {
  const params: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  };
  if (cfg.scope) params['scope'] = cfg.scope;
  return encodeTokenBody(cfg, params);
}

export interface OAuthTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType: string;
  /** Absolute expiry (epoch ms), when the provider returned `expires_in`. */
  readonly expiresAt?: number;
  readonly idToken?: string;
  readonly scope?: string;
  /** When this set was obtained (epoch ms). */
  readonly obtainedAt: number;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Parse a provider token JSON response into the canonical token set. */
export function parseTokenResponse(json: unknown, now: number): OAuthTokens {
  const r = asRecord(json);
  const accessToken = str(r['access_token']);
  if (!accessToken) {
    const err = str(r['error_description']) ?? str(r['error']) ?? 'no access_token in response';
    throw new Error(`OAuth token exchange failed: ${err}`);
  }
  const expiresIn = num(r['expires_in']);
  const refreshToken = str(r['refresh_token']);
  const idToken = str(r['id_token']);
  const scope = str(r['scope']);
  return {
    accessToken,
    tokenType: str(r['token_type']) ?? 'Bearer',
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresIn !== undefined ? { expiresAt: now + expiresIn * 1000 } : {}),
    ...(idToken ? { idToken } : {}),
    ...(scope ? { scope } : {}),
    obtainedAt: now,
  };
}

/** True when the access token is at/within `skewMs` of expiry. */
export function isExpired(tokens: OAuthTokens, now: number, skewMs = 60_000): boolean {
  return tokens.expiresAt !== undefined && now >= tokens.expiresAt - skewMs;
}

export function serializeTokens(tokens: OAuthTokens): string {
  return JSON.stringify(tokens);
}

/** Parse a stored token set, returning null if it's missing/corrupt. */
export function parseStoredTokens(raw: string | null | undefined): OAuthTokens | null {
  if (!raw) return null;
  try {
    const r = asRecord(JSON.parse(raw));
    const accessToken = str(r['accessToken']);
    if (!accessToken) return null;
    return {
      accessToken,
      tokenType: str(r['tokenType']) ?? 'Bearer',
      obtainedAt: num(r['obtainedAt']) ?? 0,
      ...(str(r['refreshToken']) ? { refreshToken: str(r['refreshToken'])! } : {}),
      ...(num(r['expiresAt']) !== undefined ? { expiresAt: num(r['expiresAt'])! } : {}),
      ...(str(r['idToken']) ? { idToken: str(r['idToken'])! } : {}),
      ...(str(r['scope']) ? { scope: str(r['scope'])! } : {}),
    };
  } catch {
    return null;
  }
}
