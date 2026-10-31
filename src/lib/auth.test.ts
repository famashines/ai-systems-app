const issuer = 'https://auth.example.test/realms/ai-systems';
const tokenEndpoint = `${issuer}/protocol/openid-connect/token`;
const revocationEndpoint = `${issuer}/protocol/openid-connect/revoke`;

const mockStore = new Map<string, string>();
let mockWriteGate: Promise<void> = Promise.resolve();

jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    await mockWriteGate;
    mockStore.set(key, value);
  },
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

type Reply = { status: number; body: object; wait?: Promise<void> } | Error;

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
  mockWriteGate = Promise.resolve();
  replies = {};
  calls = [];
  global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: new URLSearchParams(String(init?.body ?? '')) });
    const next = replies[url]?.shift();
    if (!next) throw new TypeError(`Network request failed: ${url}`);
    if (next instanceof Error) throw next;
    await next.wait;
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
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  const leaving = auth.signOut();
  await jest.advanceTimersByTimeAsync(auth.signOutWaitMs + auth.requestTimeoutMs);
  await leaving;
  jest.useRealTimers();
});

it('signs in with the code flow and PKCE, keeps the refresh token in secure storage only', async () => {
  reply(`${issuer}/.well-known/openid-configuration`, discoveryDoc);
  reply(tokenEndpoint, tokens(1));

  expect(await auth.signIn()).toBe(true);

  const authorizeUrl = new URL(jest.mocked(openAuthSessionAsync).mock.calls[0]![0]);
  expect(authorizeUrl.searchParams.get('client_id')).toBe('ai-systems-app');
  expect(authorizeUrl.searchParams.get('redirect_uri')).toBe('com.famashines.ai:/oauth2redirect');
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

const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
const tokenCalls = () => calls.filter((call) => call.url === tokenEndpoint);

it('signs out during an in-flight refresh: no session comes back and the newest token is revoked', async () => {
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  await auth.signIn();
  let open = () => {};
  reply(tokenEndpoint, { ...tokens(2), wait: new Promise<void>((resolve) => (open = resolve)) });
  reply(revocationEndpoint, { status: 200, body: {} });

  const refreshing = auth.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  const leaving = auth.signOut();
  open();
  await Promise.all([refreshing, leaving]);

  expect(mockStore.size).toBe(0);
  expect(await auth.getAccessToken()).toBeNull();
  const revoke = calls.find((call) => call.url === revocationEndpoint)!;
  expect(revoke.body.get('token')).toBe('refresh-2');
});

it('revokes the refresh token after an offline cold start', async () => {
  mockStore.set(auth.refreshTokenKey, 'refresh-0');
  expect(await auth.restore()).toBe(true);
  reply(discoveryUrl, discoveryDoc);
  reply(revocationEndpoint, { status: 200, body: {} });
  await auth.signOut();
  expect(calls.find((call) => call.url === revocationEndpoint)!.body.get('token')).toBe('refresh-0');
  expect(mockStore.size).toBe(0);
});

it.each(['invalid_grant', 'invalid_client', 'unauthorized_client'])('ends the session on the OAuth error %s', async (error) => {
  mockStore.set(auth.refreshTokenKey, 'refresh-0');
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, { status: 400, body: { error } });
  const ended = jest.fn();
  auth.onSessionEnded(ended);
  expect(await auth.restore()).toBe(false);
  expect(ended).toHaveBeenCalledTimes(1);
  expect(mockStore.size).toBe(0);
});

it('keeps the session when the token endpoint fails without an OAuth error', async () => {
  mockStore.set(auth.refreshTokenKey, 'refresh-0');
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, { status: 503, body: { message: 'unavailable' } });
  expect(await auth.restore()).toBe(true);
  expect(mockStore.get(auth.refreshTokenKey)).toBe('refresh-0');
});

it('refuses a discovery document of another issuer', async () => {
  reply(discoveryUrl, { status: 200, body: { ...discoveryDoc.body, issuer: 'https://evil.test/realms/ai-systems' } });
  await expect(auth.signIn()).rejects.toBeInstanceOf(auth.IssuerInvalidError);
  expect(openAuthSessionAsync).not.toHaveBeenCalled();
});

it('refuses a discovery document with an http endpoint', async () => {
  reply(discoveryUrl, { status: 200, body: { ...discoveryDoc.body, token_endpoint: 'http://evil.test/token' } });
  await expect(auth.signIn()).rejects.toBeInstanceOf(auth.IssuerInvalidError);
  expect(openAuthSessionAsync).not.toHaveBeenCalled();
});

it('allows http only for a local issuer in a development build', () => {
  const local = 'http://localhost:8090/realms/ai-systems';
  const doc = { authorizationEndpoint: `${local}/auth`, tokenEndpoint: `${local}/token`, discoveryDocument: { issuer: local, authorization_endpoint: `${local}/auth`, token_endpoint: `${local}/token` } };
  expect(() => auth.checkDiscovery(doc, local)).not.toThrow();
});

it('makes no token call when the redirect carries a wrong state', async () => {
  reply(discoveryUrl, discoveryDoc);
  jest.mocked(openAuthSessionAsync).mockImplementation(async (url) => {
    const params = new URL(url).searchParams;
    return { type: 'success', url: `${params.get('redirect_uri')}?code=the-code&state=forged` };
  });
  await expect(auth.signIn()).rejects.toThrow();
  expect(tokenCalls()).toEqual([]);
  expect(mockStore.size).toBe(0);
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

it('signs out at once when the token endpoint never answers', async () => {
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  await auth.signIn();
  reply(tokenEndpoint, { ...tokens(2), wait: new Promise<void>(() => {}) });
  reply(revocationEndpoint, { status: 200, body: {} });
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });

  const refreshing = auth.refresh().catch((error: unknown) => error);
  await settle();
  const leaving = auth.signOut();
  await settle();
  expect(mockStore.size).toBe(0);
  await jest.advanceTimersByTimeAsync(auth.signOutWaitMs);
  await leaving;
  expect(calls.find((call) => call.url === revocationEndpoint)!.body.get('token')).toBe('refresh-1');

  await jest.advanceTimersByTimeAsync(auth.requestTimeoutMs);
  expect(await refreshing).toBeInstanceOf(auth.TimeoutError);
  expect(mockStore.size).toBe(0);
});

it('removes a refresh token that is written after sign-out started, and revokes it', async () => {
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  await auth.signIn();
  let release = () => {};
  mockWriteGate = new Promise<void>((resolve) => (release = resolve));
  reply(tokenEndpoint, tokens(2));
  reply(revocationEndpoint, { status: 200, body: {} });

  const refreshing = auth.refresh();
  while (tokenCalls().length < 2) await settle();
  await settle();
  const leaving = auth.signOut();
  await settle();
  release();
  await Promise.all([refreshing, leaving]);

  expect(mockStore.size).toBe(0);
  expect(await auth.getAccessToken()).toBeNull();
  expect(calls.find((call) => call.url === revocationEndpoint)!.body.get('token')).toBe('refresh-2');
});

it('keeps a late refresh answer when the session did not change', async () => {
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  await auth.signIn();
  let open = () => {};
  reply(tokenEndpoint, { ...tokens(2), wait: new Promise<void>((resolve) => (open = resolve)) });
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });

  const refreshing = auth.refresh().catch((error: unknown) => error);
  const joined = auth.refresh().catch((error: unknown) => error);
  await settle();
  await jest.advanceTimersByTimeAsync(auth.requestTimeoutMs);
  expect(await refreshing).toBeInstanceOf(auth.TimeoutError);
  expect(await joined).toBeInstanceOf(auth.TimeoutError);
  expect(tokenCalls()).toHaveLength(2);

  open();
  while (mockStore.get(auth.refreshTokenKey) !== 'refresh-2') await settle();
  expect(await auth.getAccessToken()).toBe('access-2');
  expect(tokenCalls()).toHaveLength(2);
});

const revoked = () => calls.filter((call) => call.url === revocationEndpoint).map((call) => call.body.get('token'));

it('joins a refresh that waits, and gives it up after lateAnswerMs: a new refresh succeeds and the late answer is revoked', async () => {
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  await auth.signIn();
  let open = () => {};
  reply(tokenEndpoint, { ...tokens(2), wait: new Promise<void>((resolve) => (open = resolve)) }, tokens(3));
  reply(revocationEndpoint, { status: 200, body: {} });
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  void auth.refresh().catch(() => {});
  await settle();
  await jest.advanceTimersByTimeAsync(auth.lateAnswerMs - 1);
  void auth.refresh().catch(() => {});
  await settle();
  expect(tokenCalls()).toHaveLength(2);

  await jest.advanceTimersByTimeAsync(1);
  expect(await auth.refresh()).toBe(true);
  expect(tokenCalls()).toHaveLength(3);
  expect(tokenCalls().at(-1)!.body.get('refresh_token')).toBe('refresh-1');
  expect(mockStore.get(auth.refreshTokenKey)).toBe('refresh-3');
  expect(await auth.getAccessToken()).toBe('access-3');

  open();
  while (revoked().length < 1) await settle();
  expect(revoked()).toEqual(['refresh-2']);
  expect(mockStore.get(auth.refreshTokenKey)).toBe('refresh-3');
  expect(await auth.getAccessToken()).toBe('access-3');
});

it('keeps the late answer when no newer token is stored', async () => {
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  await auth.signIn();
  let open = () => {};
  reply(tokenEndpoint, { ...tokens(2), wait: new Promise<void>((resolve) => (open = resolve)) }, { status: 503, body: {} });
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  void auth.refresh().catch(() => {});
  await settle();
  await jest.advanceTimersByTimeAsync(auth.lateAnswerMs);
  await auth.refresh().catch(() => {});
  open();
  while (mockStore.get(auth.refreshTokenKey) !== 'refresh-2') await settle();
  expect(await auth.getAccessToken()).toBe('access-2');
  expect(revoked()).toEqual([]);
});

it('gives up a refresh older than 15 s when the app comes to the foreground, not a younger one', async () => {
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  await auth.signIn();
  reply(tokenEndpoint, { ...tokens(2), wait: new Promise<void>(() => {}) }, tokens(3));
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  void auth.refresh().catch(() => {});
  await settle();
  await jest.advanceTimersByTimeAsync(auth.requestTimeoutMs - 1);
  auth.resumeRefresh();
  void auth.refresh().catch(() => {});
  await settle();
  expect(tokenCalls()).toHaveLength(2);
  await jest.advanceTimersByTimeAsync(1);
  auth.resumeRefresh();
  expect(await auth.refresh()).toBe(true);
  expect(tokenCalls()).toHaveLength(3);
  expect(mockStore.get(auth.refreshTokenKey)).toBe('refresh-3');
});

it('does not end the session on a late invalid_grant of a request that a newer refresh replaced', async () => {
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  await auth.signIn();
  let open = () => {};
  reply(tokenEndpoint, { status: 400, body: { error: 'invalid_grant' }, wait: new Promise<void>((resolve) => (open = resolve)) }, tokens(3));
  const ended = jest.fn();
  auth.onSessionEnded(ended);
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  void auth.refresh().catch(() => {});
  await settle();
  await jest.advanceTimersByTimeAsync(auth.lateAnswerMs);
  expect(await auth.refresh()).toBe(true);
  open();
  for (let i = 0; i < 10; i += 1) await settle();
  expect(ended).not.toHaveBeenCalled();
  expect(mockStore.get(auth.refreshTokenKey)).toBe('refresh-3');
});

it('revokes a late refresh token of an ended session at once, and each token of the next session', async () => {
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  await auth.signIn();
  let open = () => {};
  reply(tokenEndpoint, { ...tokens(2), wait: new Promise<void>((resolve) => (open = resolve)) });
  reply(revocationEndpoint, { status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} });
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  void auth.refresh().catch(() => {});
  await settle();
  const leaving = auth.signOut();
  await jest.advanceTimersByTimeAsync(auth.signOutWaitMs);
  await leaving;
  expect(revoked()).toEqual(['refresh-1']);

  open();
  while (revoked().length < 2) await settle();
  expect(revoked()).toEqual(['refresh-1', 'refresh-2']);
  expect(mockStore.size).toBe(0);

  jest.useRealTimers();
  reply(tokenEndpoint, tokens(3));
  await auth.signIn();
  expect(mockStore.get(auth.refreshTokenKey)).toBe('refresh-3');
  await auth.signOut();
  expect(revoked()).toEqual(['refresh-1', 'refresh-2', 'refresh-3']);
});

it('revokes every distinct token at sign-out', async () => {
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, tokens(1));
  await auth.signIn();
  let release = () => {};
  mockWriteGate = new Promise<void>((resolve) => (release = resolve));
  reply(tokenEndpoint, tokens(2));
  reply(revocationEndpoint, { status: 200, body: {} }, { status: 200, body: {} });
  const refreshing = auth.refresh();
  while (tokenCalls().length < 2) await settle();
  await settle();
  const leaving = auth.signOut();
  await settle();
  release();
  await Promise.all([refreshing, leaving]);
  expect(calls.filter((call) => call.url === revocationEndpoint).map((call) => call.body.get('token')).sort()).toEqual(['refresh-1', 'refresh-2']);
});

it('gives each new access token to the live connection', async () => {
  const seen: string[] = [];
  auth.onAccessToken((token) => seen.push(token));
  reply(discoveryUrl, discoveryDoc);
  reply(tokenEndpoint, tokens(1), tokens(2));
  await auth.signIn();
  await auth.refresh();
  expect(seen).toEqual(['access-1', 'access-2']);
});
