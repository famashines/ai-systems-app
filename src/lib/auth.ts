import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';

import { config } from '@/lib/config';

export const refreshTokenKey = 'auth.refreshToken';
export const refreshEarlyMs = 30_000;

export class IssuerUnreachableError extends Error {}
export class IssuerInvalidError extends Error {}

let discovery: AuthSession.DiscoveryDocument | null = null;
let access: { token: string; expiresAt: number } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<boolean> | null = null;
let work: Promise<unknown> = Promise.resolve();
let generation = 0;
let closing = false;
let orphan: string | null = null;
let onEnded = () => {};

export function onSessionEnded(handler: () => void): void {
  onEnded = handler;
}

function track<T>(promise: Promise<T>): Promise<T> {
  work = Promise.allSettled([work, promise]).then(() => undefined);
  return promise;
}

function secure(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  return protocol === 'https:' || (__DEV__ && ['localhost', '127.0.0.1', '10.0.2.2'].includes(hostname));
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
      doc = await AuthSession.fetchDiscoveryAsync(config.oidcIssuer);
    } catch (cause) {
      throw new IssuerUnreachableError(`Cannot read ${config.oidcIssuer}`, { cause });
    }
    checkDiscovery(doc, config.oidcIssuer);
    discovery = doc;
  }
  return discovery;
}

async function keep(tokens: AuthSession.TokenResponse, started: number): Promise<boolean> {
  if (!tokens.accessToken) throw new Error('The token response has no access token');
  if (started !== generation) {
    orphan = tokens.refreshToken ?? orphan;
    return false;
  }
  if (tokens.refreshToken) await SecureStore.setItemAsync(refreshTokenKey, tokens.refreshToken);
  access = { token: tokens.accessToken, expiresAt: Date.now() + (tokens.expiresIn ?? 300) * 1000 };
  clearTimeout(timer);
  timer = setTimeout(() => void refresh().catch(() => {}), Math.max(access.expiresAt - refreshEarlyMs - Date.now(), 0));
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
  const exchange = AuthSession.exchangeCodeAsync(
    {
      clientId: config.oidcClientId,
      redirectUri: config.redirectUri,
      code: result.params.code ?? '',
      extraParams: { code_verifier: request.codeVerifier },
    },
    doc,
  );
  return track(exchange.then((tokens) => keep(tokens, started)));
}

async function runRefresh(): Promise<boolean> {
  const started = generation;
  const refreshToken = await SecureStore.getItemAsync(refreshTokenKey);
  if (!refreshToken) return false;
  const doc = await discover();
  try {
    return await keep(await AuthSession.refreshAsync({ clientId: config.oidcClientId, refreshToken }, doc), started);
  } catch (error) {
    if (!(error instanceof AuthSession.TokenError)) throw error;
    if (started === generation) {
      await clear();
      onEnded();
    }
    return false;
  }
}

export function refresh(): Promise<boolean> {
  if (closing) return Promise.resolve(false);
  inflight ??= track(runRefresh()).finally(() => {
    inflight = null;
  });
  return inflight;
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
  generation += 1;
  clearTimeout(timer);
  access = null;
  try {
    await work;
    const newest = orphan ?? (await SecureStore.getItemAsync(refreshTokenKey));
    orphan = null;
    await clear();
    if (!newest) return;
    const doc = discovery ?? (await discover().catch(() => null));
    if (doc?.revocationEndpoint) {
      await AuthSession.revokeAsync({ clientId: config.oidcClientId, token: newest }, doc).catch(() => {});
    }
  } finally {
    closing = false;
  }
}
