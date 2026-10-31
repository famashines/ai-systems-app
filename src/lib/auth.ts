import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';

import { config, secure } from '@/lib/config';

export const refreshTokenKey = 'auth.refreshToken';
export const refreshEarlyMs = 30_000;
export const requestTimeoutMs = 15_000;
export const signOutWaitMs = 10_000;
export const lateAnswerMs = 60_000;

export class IssuerUnreachableError extends Error {}
export class IssuerInvalidError extends Error {}
export class TimeoutError extends Error {}

let discovery: AuthSession.DiscoveryDocument | null = null;
let access: { token: string; expiresAt: number } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const waiting = new Map<string, { answer: Promise<boolean>; at: number }>();
let work: Promise<unknown> = Promise.resolve();
let storing: Promise<unknown> = Promise.resolve();
let generation = 0;
let closing = false;
let collecting = false;
let orphans: string[] = [];
let onEnded = () => {};
let onToken = (_token: string) => {};

export function onSessionEnded(handler: () => void): void {
  onEnded = handler;
}

export function onAccessToken(handler: (token: string) => void): void {
  onToken = handler;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new TimeoutError(`No answer in ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(handle));
}

function serial<T>(task: () => Promise<T>): Promise<T> {
  const result = storing.then(task);
  storing = result.catch(() => {});
  return result;
}

function track<T>(promise: Promise<T>): Promise<T> {
  work = Promise.allSettled([work, promise]).then(() => undefined);
  return promise;
}

export function checkDiscovery(doc: AuthSession.DiscoveryDocument, issuer: string): void {
  const endpoints = [doc.authorizationEndpoint, doc.tokenEndpoint, doc.revocationEndpoint, doc.userInfoEndpoint, doc.endSessionEndpoint];
  if (doc.discoveryDocument?.issuer !== issuer) throw new IssuerInvalidError(`Issuer is not ${issuer}`);
  if (!doc.authorizationEndpoint || !doc.tokenEndpoint) throw new IssuerInvalidError('Endpoints are missing');
  if (!endpoints.every((url) => url === undefined || secure(url))) throw new IssuerInvalidError('Endpoints must use https');
}

async function discover(): Promise<AuthSession.DiscoveryDocument> {
  if (!discovery) {
    let doc: AuthSession.DiscoveryDocument;
    try {
      doc = await withTimeout(AuthSession.fetchDiscoveryAsync(config.oidcIssuer), requestTimeoutMs);
    } catch (cause) {
      throw new IssuerUnreachableError(`Cannot read ${config.oidcIssuer}`, { cause });
    }
    checkDiscovery(doc, config.oidcIssuer);
    discovery = doc;
  }
  return discovery;
}

async function revoke(token: string): Promise<void> {
  const doc = discovery ?? (await discover().catch(() => null));
  if (!doc?.revocationEndpoint) return;
  await withTimeout(AuthSession.revokeAsync({ clientId: config.oidcClientId, token }, doc), requestTimeoutMs).catch(() => {});
}

function discard(token: string | undefined): void {
  if (!token) return;
  if (collecting) orphans.push(token);
  else void track(revoke(token));
}

async function replaced(used: string | undefined): Promise<boolean> {
  return used !== undefined && (await SecureStore.getItemAsync(refreshTokenKey)) !== used;
}

function keep(tokens: AuthSession.TokenResponse, started: number, used?: string): Promise<boolean> {
  return serial(() => store(tokens, started, used));
}

async function store(tokens: AuthSession.TokenResponse, started: number, used?: string): Promise<boolean> {
  if (!tokens.accessToken) throw new Error('The token response has no access token');
  if (started !== generation || (await replaced(used))) {
    discard(tokens.refreshToken);
    return false;
  }
  if (tokens.refreshToken) await SecureStore.setItemAsync(refreshTokenKey, tokens.refreshToken);
  if (started !== generation) {
    if (tokens.refreshToken && (await SecureStore.getItemAsync(refreshTokenKey)) === tokens.refreshToken) await SecureStore.deleteItemAsync(refreshTokenKey);
    discard(tokens.refreshToken);
    return false;
  }
  access = { token: tokens.accessToken, expiresAt: Date.now() + (tokens.expiresIn ?? 300) * 1000 };
  clearTimeout(timer);
  timer = setTimeout(() => void refresh().catch(() => {}), Math.max(access.expiresAt - refreshEarlyMs - Date.now(), 0));
  onToken(access.token);
  return true;
}

async function clear(): Promise<void> {
  clearTimeout(timer);
  access = null;
  await SecureStore.deleteItemAsync(refreshTokenKey);
}

export async function signIn(): Promise<boolean> {
  const started = generation;
  const doc = await discover();
  const request = new AuthSession.AuthRequest({
    clientId: config.oidcClientId,
    redirectUri: config.redirectUri,
    scopes: ['openid', 'offline_access'],
    usePKCE: true,
  });
  const result = await request.promptAsync(doc);
  if (result.type === 'error') throw result.error ?? new Error('Authorization failed');
  if (result.type !== 'success' || !request.codeVerifier) return false;
  const exchange = withTimeout(
    AuthSession.exchangeCodeAsync(
      {
        clientId: config.oidcClientId,
        redirectUri: config.redirectUri,
        code: result.params.code ?? '',
        extraParams: { code_verifier: request.codeVerifier },
      },
      doc,
    ),
    requestTimeoutMs,
  );
  return track(exchange.then((tokens) => keep(tokens, started)));
}

async function runRefresh(refreshToken: string, started: number): Promise<boolean> {
  const doc = await discover();
  try {
    const tokens = await AuthSession.refreshAsync({ clientId: config.oidcClientId, refreshToken }, doc);
    return await keep(tokens, started, refreshToken);
  } catch (error) {
    if (!(error instanceof AuthSession.TokenError)) throw error;
    if (started === generation && !(await replaced(refreshToken))) {
      generation += 1;
      await clear();
      onEnded();
    }
    return false;
  }
}

async function startRefresh(): Promise<boolean> {
  const started = generation;
  const refreshToken = await SecureStore.getItemAsync(refreshTokenKey);
  if (!refreshToken) return false;
  const joined = waiting.get(refreshToken);
  if (joined && Date.now() - joined.at < lateAnswerMs) return joined.answer;
  const mine = runRefresh(refreshToken, started);
  waiting.set(refreshToken, { answer: mine, at: Date.now() });
  const done = () => {
    if (waiting.get(refreshToken)?.answer === mine) waiting.delete(refreshToken);
  };
  mine.then(done, done);
  void track(withTimeout(mine, lateAnswerMs)).catch(() => {});
  return mine;
}

export function resumeRefresh(now = Date.now()): void {
  for (const [token, entry] of waiting) if (now - entry.at >= requestTimeoutMs) waiting.delete(token);
}

export function refresh(): Promise<boolean> {
  if (closing) return Promise.resolve(false);
  return withTimeout(startRefresh(), requestTimeoutMs);
}

export async function restore(): Promise<boolean> {
  if (!(await SecureStore.getItemAsync(refreshTokenKey))) return false;
  return refresh().catch(() => true);
}

export async function getAccessToken(): Promise<string | null> {
  if (access && access.expiresAt - refreshEarlyMs > Date.now()) return access.token;
  return (await refresh()) && access ? access.token : null;
}

export async function signOut(): Promise<void> {
  closing = true;
  collecting = true;
  generation += 1;
  clearTimeout(timer);
  access = null;
  try {
    const stored = await SecureStore.getItemAsync(refreshTokenKey);
    await clear();
    await withTimeout(work, signOutWaitMs).catch(() => {});
    const tokens = [...new Set([...orphans, stored].filter((token): token is string => !!token))];
    orphans = [];
    collecting = false;
    await Promise.all(tokens.map(revoke));
  } finally {
    collecting = false;
    closing = false;
  }
}
