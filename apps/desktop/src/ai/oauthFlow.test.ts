import { describe, expect, it, vi } from 'vitest';
import { OAUTH_PROVIDERS, serializeTokens, type CryptoLike, type OAuthTokens } from '@orbit/ai-runtime';
import {
  getValidAccessToken,
  refreshTokens,
  signIn,
  signOut,
  type OAuthBridge,
  type OAuthCallback,
} from './oauthFlow.js';

function fakeCrypto(): CryptoLike {
  let n = 1;
  return {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const v = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < v.length; i++) v[i] = (n = (n * 31 + 7) & 0xff);
      return array;
    },
    subtle: {
      digest: async (_a: string, data: Uint8Array) => {
        const out = new Uint8Array(32);
        for (let i = 0; i < 32; i++) out[i] = (data[i % data.length] ?? 0) ^ i;
        return out.buffer;
      },
    },
  };
}

interface Harness {
  bridge: OAuthBridge;
  secrets: Map<string, string>;
  posted: string[];
}

function harness(opts: {
  callbackState?: 'match' | 'wrong';
  callbackError?: string;
  tokenJson?: unknown;
  tokenStatus?: number;
  now?: number;
} = {}): Harness {
  const secrets = new Map<string, string>();
  const posted: string[] = [];
  let handler: ((ev: OAuthCallback) => void) | null = null;
  let requestId = '';

  const bridge: OAuthBridge = {
    async listen(id, port) {
      requestId = id;
      return port;
    },
    async cancel() {},
    async onCallback(h) {
      handler = h;
      return () => {
        handler = null;
      };
    },
    async openUrl(url) {
      const u = new URL(url);
      const realState = u.searchParams.get('state') ?? '';
      const state = opts.callbackState === 'wrong' ? 'tampered' : realState;
      queueMicrotask(() =>
        handler?.({
          requestId,
          state,
          ...(opts.callbackError ? { error: opts.callbackError } : { code: 'authcode-xyz' }),
        }),
      );
    },
    async post(_url, body, _contentType) {
      posted.push(body);
      return {
        status: opts.tokenStatus ?? 200,
        body: JSON.stringify(
          opts.tokenJson ?? {
            access_token: 'ACCESS-1',
            refresh_token: 'REFRESH-1',
            expires_in: 3600,
            token_type: 'Bearer',
          },
        ),
      };
    },
    async secretSet(k, v) {
      secrets.set(k, v);
    },
    async secretGet(k) {
      return secrets.get(k) ?? null;
    },
    async secretDelete(k) {
      secrets.delete(k);
    },
    now: () => opts.now ?? 1_000_000,
    randomId: () => 'req-1',
    crypto: fakeCrypto(),
  };
  return { bridge, secrets, posted };
}

const CODEX = OAUTH_PROVIDERS['openai-codex'];

describe('signIn', () => {
  it('completes the flow and stores the token set', async () => {
    const h = harness();
    const tokens = await signIn(CODEX, h.bridge);
    expect(tokens.accessToken).toBe('ACCESS-1');
    expect(tokens.refreshToken).toBe('REFRESH-1');
    expect(tokens.expiresAt).toBe(1_000_000 + 3600 * 1000);
    // stored under the provider secret name
    expect(h.secrets.get(CODEX.secretName)).toBe(serializeTokens(tokens));
    // exchanged the authorization code with PKCE verifier
    const body = new URLSearchParams(h.posted[0]!);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('authcode-xyz');
    expect(body.get('code_verifier')).toBeTruthy();
  });

  it('rejects on a state mismatch (CSRF guard) and stores nothing', async () => {
    const h = harness({ callbackState: 'wrong' });
    await expect(signIn(CODEX, h.bridge)).rejects.toThrow(/state mismatch/i);
    expect(h.secrets.size).toBe(0);
  });

  it('rejects when the provider returns an error', async () => {
    const h = harness({ callbackError: 'access_denied' });
    await expect(signIn(CODEX, h.bridge)).rejects.toThrow(/access_denied/);
  });

  it('rejects when the token endpoint is non-2xx', async () => {
    const h = harness({ tokenStatus: 400, tokenJson: { error: 'invalid_grant' } });
    await expect(signIn(CODEX, h.bridge)).rejects.toThrow(/Token exchange failed/);
  });

  it('times out when no redirect arrives', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.bridge.openUrl = async () => {}; // never fire the callback
      const p = signIn(CODEX, h.bridge, 5_000);
      const assertion = expect(p).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(5_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('token reuse + refresh', () => {
  it('returns the stored token while it is still valid', async () => {
    const h = harness();
    const valid: OAuthTokens = {
      accessToken: 'STILL-GOOD',
      tokenType: 'Bearer',
      expiresAt: 2_000_000,
      obtainedAt: 0,
    };
    h.secrets.set(CODEX.secretName, serializeTokens(valid));
    expect(await getValidAccessToken(CODEX, h.bridge)).toBe('STILL-GOOD');
    expect(h.posted).toHaveLength(0); // no refresh needed
  });

  it('refreshes an expired token and persists the new set', async () => {
    const h = harness({
      tokenJson: { access_token: 'ACCESS-2', expires_in: 3600, token_type: 'Bearer' },
    });
    const expired: OAuthTokens = {
      accessToken: 'OLD',
      refreshToken: 'REFRESH-KEEP',
      tokenType: 'Bearer',
      expiresAt: 10,
      obtainedAt: 0,
    };
    h.secrets.set(CODEX.secretName, serializeTokens(expired));
    const tok = await getValidAccessToken(CODEX, h.bridge);
    expect(tok).toBe('ACCESS-2');
    const body = new URLSearchParams(h.posted[0]!);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('REFRESH-KEEP');
    // provider omitted a new refresh token → previous one is preserved
    const stored = JSON.parse(h.secrets.get(CODEX.secretName)!);
    expect(stored.refreshToken).toBe('REFRESH-KEEP');
  });

  it('returns null when not signed in', async () => {
    const h = harness();
    expect(await getValidAccessToken(CODEX, h.bridge)).toBeNull();
  });

  it('refreshTokens returns null without a refresh token', async () => {
    const h = harness();
    const noRefresh: OAuthTokens = { accessToken: 'a', tokenType: 'Bearer', obtainedAt: 0 };
    expect(await refreshTokens(CODEX, noRefresh, h.bridge)).toBeNull();
  });

  it('signOut clears the stored token', async () => {
    const h = harness();
    h.secrets.set(CODEX.secretName, 'x');
    await signOut(CODEX, h.bridge);
    expect(h.secrets.has(CODEX.secretName)).toBe(false);
  });
});
