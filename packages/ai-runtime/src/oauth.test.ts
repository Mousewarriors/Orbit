import { describe, expect, it } from 'vitest';
import {
  OAUTH_PROVIDERS,
  authCodeTokenBody,
  base64UrlEncode,
  buildAuthorizeUrl,
  generatePkce,
  isExpired,
  oauthProvider,
  parseStoredTokens,
  parseTokenResponse,
  randomState,
  refreshTokenBody,
  serializeTokens,
  tokenContentType,
  type CryptoLike,
  type OAuthTokens,
} from './oauth.js';

/** Deterministic crypto stub: counts up so verifier/challenge are predictable. */
function fakeCrypto(seed = 7): CryptoLike {
  let n = seed;
  return {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < view.length; i++) view[i] = (n = (n * 31 + 17) & 0xff);
      return array;
    },
    subtle: {
      // Not real SHA-256 — just deterministic 32 bytes so the challenge is stable.
      digest: async (_alg: string, data: Uint8Array) => {
        const out = new Uint8Array(32);
        for (let i = 0; i < 32; i++) out[i] = (data[i % data.length] ?? 0) ^ (i * 7);
        return out.buffer;
      },
    },
  };
}

describe('pkce + state', () => {
  it('base64url has no +, / or padding', () => {
    expect(base64UrlEncode(new Uint8Array([251, 255, 191, 0]))).not.toMatch(/[+/=]/);
  });

  it('generates a verifier and an S256 challenge', async () => {
    const pkce = await generatePkce(fakeCrypto());
    expect(pkce.method).toBe('S256');
    expect(pkce.verifier.length).toBeGreaterThan(20);
    expect(pkce.challenge.length).toBeGreaterThan(20);
    expect(pkce.verifier).not.toBe(pkce.challenge);
    expect(pkce.challenge).not.toMatch(/[+/=]/);
  });

  it('state is url-safe and reasonably long', () => {
    expect(randomState(fakeCrypto())).not.toMatch(/[+/=]/);
    expect(randomState(fakeCrypto()).length).toBeGreaterThan(20);
  });
});

describe('authorize url', () => {
  it('includes the required params + PKCE challenge', () => {
    const cfg = OAUTH_PROVIDERS['openai-codex'];
    const url = new URL(buildAuthorizeUrl(cfg, { state: 'st8', challenge: 'chal' }));
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(cfg.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);
    expect(url.searchParams.get('state')).toBe('st8');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true');
  });

  it('omits the challenge when none is given', () => {
    const url = new URL(buildAuthorizeUrl(OAUTH_PROVIDERS['anthropic-claude'], { state: 's' }));
    expect(url.searchParams.has('code_challenge')).toBe(false);
  });
});

describe('token request bodies', () => {
  it('authorization_code carries code + verifier', () => {
    const body = new URLSearchParams(
      authCodeTokenBody(OAUTH_PROVIDERS['openai-codex'], { code: 'abc', verifier: 'v123' }),
    );
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('abc');
    expect(body.get('code_verifier')).toBe('v123');
    expect(body.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
  });

  it('OpenAI refresh_token grant is form-encoded', () => {
    const body = new URLSearchParams(refreshTokenBody(OAUTH_PROVIDERS['openai-codex'], 'rt-9'));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-9');
  });

  it('Anthropic uses a JSON body with state echoed back', () => {
    const cfg = OAUTH_PROVIDERS['anthropic-claude'];
    expect(tokenContentType(cfg)).toBe('application/json');
    const json = JSON.parse(authCodeTokenBody(cfg, { code: 'c', verifier: 'v', state: 'st' }));
    expect(json).toMatchObject({
      grant_type: 'authorization_code',
      code: 'c',
      code_verifier: 'v',
      state: 'st',
      client_id: cfg.clientId,
    });
    const refresh = JSON.parse(refreshTokenBody(cfg, 'rt'));
    expect(refresh).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt' });
  });

  it('OpenAI uses a form body (no state echoed)', () => {
    const cfg = OAUTH_PROVIDERS['openai-codex'];
    expect(tokenContentType(cfg)).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(authCodeTokenBody(cfg, { code: 'c', verifier: 'v', state: 'st' }));
    expect(body.get('state')).toBeNull(); // openai doesn't echo state in the token body
    expect(body.get('code_verifier')).toBe('v');
  });
});

describe('token lifecycle', () => {
  it('parses a token response into absolute expiry', () => {
    const t = parseTokenResponse(
      { access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'Bearer', id_token: 'id' },
      1_000_000,
    );
    expect(t.accessToken).toBe('at');
    expect(t.refreshToken).toBe('rt');
    expect(t.expiresAt).toBe(1_000_000 + 3600 * 1000);
    expect(t.idToken).toBe('id');
  });

  it('surfaces an OAuth error response', () => {
    expect(() => parseTokenResponse({ error: 'invalid_grant' }, 0)).toThrow(/invalid_grant/);
  });

  it('isExpired respects the skew window', () => {
    const t: OAuthTokens = { accessToken: 'a', tokenType: 'Bearer', expiresAt: 10_000, obtainedAt: 0 };
    expect(isExpired(t, 8_000, 60_000)).toBe(true); // within skew
    expect(isExpired(t, 8_000, 1_000)).toBe(false);
    expect(isExpired({ accessToken: 'a', tokenType: 'Bearer', obtainedAt: 0 }, 9e9)).toBe(false);
  });

  it('round-trips through serialise/parseStored', () => {
    const t = parseTokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 60 }, 5);
    const back = parseStoredTokens(serializeTokens(t));
    expect(back).toEqual(t);
    expect(parseStoredTokens(null)).toBeNull();
    expect(parseStoredTokens('not json')).toBeNull();
    expect(parseStoredTokens('{"tokenType":"Bearer"}')).toBeNull(); // no access token
  });
});

describe('provider registry', () => {
  it('every provider has loopback redirect config and a secret name', () => {
    for (const cfg of Object.values(OAUTH_PROVIDERS)) {
      expect(oauthProvider(cfg.id)).toBe(cfg);
      expect(cfg.redirectUri).toContain(`:${cfg.redirectPort}${cfg.redirectPath}`);
      expect(cfg.secretName).toMatch(/^ai\.oauth\./);
      expect(cfg.usePkce).toBe(true);
    }
    expect(oauthProvider('nope')).toBeUndefined();
  });
});
