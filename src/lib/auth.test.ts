const issuer = 'https://auth.example.test/realms/ai-systems';
const tokenEndpoint = `${issuer}/protocol/openid-connect/token`;
const revocationEndpoint = `${issuer}/protocol/openid-connect/revoke`;

const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void mockStore.set(key, value),
  deleteItemAsync: async (key: string) => void mockStore.delete(key),
}));

jest.mock('expo-crypto', () => {
  const crypto = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { BASE64: 'base64', HEX: 'hex' },
    getRandomValues: (array: Uint8Array<ArrayBuffer>) => crypto.getRandomValues(array),
    digestStringAsync: async (_algorithm: string, data: string, options: { encoding: 'base64' | 'hex' }) =>
      crypto.createHash('sha256').update(data).digest(options.encoding),
  };
});

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  maybeCompleteAuthSession: jest.fn(),
  dismissAuthSession: jest.fn(),
}));

type Reply = { status: number; body: object } | Error;

let replies: Record<string, Reply[]> = {};
let calls: { url: string; body: URLSearchParams }[] = [];

function reply(url: string, ...answers: Reply[]) {
  replies[url] = [...(replies[url] ?? []), ...answers];
}

const tokens = (n: number) => ({
  status: 200,
  body: { access_token: `access-${n}`, refresh_token: `refresh-${n}`, token_type: 'Bearer', expires_in: 300 },
});

const discoveryDoc = {
  status: 200,
  body: {
    issuer,
    authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
    token_endpoint: tokenEndpoint,
    revocation_endpoint: revocationEndpoint,
  },
};

let auth: typeof import('@/lib/auth');
let openAuthSessionAsync: typeof import('expo-web-browser').openAuthSessionAsync;

beforeEach(() => {
  jest.resetModules();
  jest.useRealTimers();
  process.env.EXPO_PUBLIC_OIDC_ISSUER = issuer;
  mockStore.clear();
  replies = {};
  calls = [];
  global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: new URLSearchParams(String(init?.body ?? '')) });
    const next = replies[url]?.shift();
    if (!next) throw new TypeError(`Network request failed: ${url}`);
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  openAuthSessionAsync = require('expo-web-browser').openAuthSessionAsync;
  jest.mocked(openAuthSessionAsync).mockImplementation(async (url) => {
    const params = new URL(url).searchParams;
    return { type: 'success', url: `${params.get('redirect_uri')}?code=the-code&state=${params.get('state')}` };
  });
  auth = require('@/lib/auth');
});

afterEach(async () => {
  await auth.signOut();
  jest.useRealTimers();
});

it('signs in with the code flow and PKCE, keeps the refresh token in secure storage only', async () => {
  reply(`${issuer}/.well-known/openid-configuration`, discoveryDoc);
  reply(tokenEndpoint, tokens(1));

  expect(await auth.signIn()).toBe(true);

  const authorizeUrl = new URL(jest.mocked(openAuthSessionAsync).mock.calls[0]![0]);
  expect(authorizeUrl.searchParams.get('client_id')).toBe('ai-systems-app');
  expect(authorizeUrl.searchParams.get('redirect_uri')).toBe('famashines-ai://auth');
  expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorizeUrl.searchParams.get('scope')).toBe('openid offline_access');

  const exchange = calls.find((call) => call.url === tokenEndpoint)!;
  expect(exchange.body.get('grant_type')).toBe('authorization_code');
  expect(exchange.body.get('code')).toBe('the-code');
  expect(exchange.body.get('code_verifier')).toHaveLength(128);

  expect([...mockStore.entries()]).toEqual([[auth.refreshTokenKey, 'refresh-1']]);
  expect(await auth.getAccessToken()).toBe('access-1');
});

it('returns false when the person cancels the browser', async () => {
  reply(`${issuer}/.well-known/openid-configuration`, discoveryDoc);
  jest.mocked(openAuthSessionAsync).mockResolvedValue({ type: 'cancel' } as Awaited<ReturnType<typeof openAuthSessionAsync>>);
  expect(await auth.signIn()).toBe(false);
  expect(mockStore.size).toBe(0);
});

it('gives IssuerUnreachableError when the issuer does not answer', async () => {
  await expect(auth.signIn()).rejects.toBeInstanceOf(auth.IssuerUnreachableError);
});

it('refreshes silently before the access token expires and stores the rotated refresh token', async () => {
  reply(`${issuer}/.well-known/openid-configuration`, discoveryDoc);
  reply(tokenEndpoint, tokens(1), tokens(2));
  await auth.signIn();
  jest.useFakeTimers();
  await auth.refresh();
  expect(calls.filter((call) => call.url === tokenEndpoint)).toHaveLength(2);
  expect(calls.at(-1)!.body.get('grant_type')).toBe('refresh_token');
  expect(calls.at(-1)!.body.get('refresh_token')).toBe('refresh-1');
  expect(mockStore.get(auth.refreshTokenKey)).toBe('refresh-2');

  reply(tokenEndpoint, tokens(3));
  await jest.advanceTimersByTimeAsync(300_000 - auth.refreshEarlyMs);
  expect(calls.filter((call) => call.url === tokenEndpoint)).toHaveLength(3);
  expect(mockStore.get(auth.refreshTokenKey)).toBe('refresh-3');
  expect(await auth.getAccessToken()).toBe('access-3');
});

it('sends one refresh request when two callers need a token at the same time', async () => {
  mockStore.set('auth.refreshToken', 'refresh-0');
  reply(`${issuer}/.well-known/openid-configuration`, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
  expect([a, b]).toEqual(['access-1', 'access-1']);
  expect(calls.filter((call) => call.url === tokenEndpoint)).toHaveLength(1);
});

it('restores a session from the stored refresh token', async () => {
  mockStore.set('auth.refreshToken', 'refresh-0');
  reply(`${issuer}/.well-known/openid-configuration`, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  expect(await auth.restore()).toBe(true);
  expect(await auth.getAccessToken()).toBe('access-1');
});

it('restores no session without a refresh token', async () => {
  expect(await auth.restore()).toBe(false);
  expect(calls).toEqual([]);
});

it('keeps the session while offline and gets a token when the issuer answers again', async () => {
  mockStore.set('auth.refreshToken', 'refresh-0');
  expect(await auth.restore()).toBe(true);
  expect(mockStore.get(auth.refreshTokenKey)).toBe('refresh-0');
  reply(`${issuer}/.well-known/openid-configuration`, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  expect(await auth.getAccessToken()).toBe('access-1');
});

it('ends the session when the server rejects the refresh token', async () => {
  mockStore.set('auth.refreshToken', 'refresh-0');
  reply(`${issuer}/.well-known/openid-configuration`, discoveryDoc);
  reply(tokenEndpoint, { status: 400, body: { error: 'invalid_grant', error_description: 'Session not active' } });
  const ended = jest.fn();
  auth.onSessionEnded(ended);
  expect(await auth.restore()).toBe(false);
  expect(mockStore.size).toBe(0);
  expect(ended).toHaveBeenCalledTimes(1);
  expect(await auth.getAccessToken()).toBeNull();
});

it('signs out: clears both tokens and revokes the refresh token', async () => {
  reply(`${issuer}/.well-known/openid-configuration`, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  reply(revocationEndpoint, { status: 200, body: {} });
  await auth.signIn();
  await auth.signOut();
  expect(mockStore.size).toBe(0);
  const revoke = calls.find((call) => call.url === revocationEndpoint)!;
  expect(revoke.body.get('token')).toBe('refresh-1');
  expect(await auth.getAccessToken()).toBeNull();
});

it('signs out even when the revocation fails', async () => {
  reply(`${issuer}/.well-known/openid-configuration`, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  await auth.signIn();
  await expect(auth.signOut()).resolves.toBeUndefined();
  expect(mockStore.size).toBe(0);
});
