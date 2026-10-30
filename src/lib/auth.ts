import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';

import { config } from '@/lib/config';

export const refreshTokenKey = 'auth.refreshToken';
export const refreshEarlyMs = 30_000;

export class IssuerUnreachableError extends Error {}

let discovery: AuthSession.DiscoveryDocument | null = null;
let access: { token: string; expiresAt: number } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<boolean> | null = null;
let onEnded = () => {};

export function onSessionEnded(handler: () => void): void {
  onEnded = handler;
}

async function discover(): Promise<AuthSession.DiscoveryDocument> {
  if (!discovery) {
    try {
      discovery = await AuthSession.fetchDiscoveryAsync(config.oidcIssuer);
    } catch (cause) {
      throw new IssuerUnreachableError(`Cannot read ${config.oidcIssuer}`, { cause });
    }
  }
  return discovery;
}

async function keep(tokens: AuthSession.TokenResponse): Promise<void> {
  if (tokens.refreshToken) await SecureStore.setItemAsync(refreshTokenKey, tokens.refreshToken);
  access = { token: tokens.accessToken, expiresAt: Date.now() + (tokens.expiresIn ?? 300) * 1000 };
  clearTimeout(timer);
  timer = setTimeout(() => void refresh().catch(() => {}), Math.max(access.expiresAt - refreshEarlyMs - Date.now(), 0));
}

async function clear(): Promise<void> {
  clearTimeout(timer);
  access = null;
  await SecureStore.deleteItemAsync(refreshTokenKey);
}

export async function signIn(): Promise<boolean> {
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
  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId: config.oidcClientId,
      redirectUri: config.redirectUri,
      code: result.params.code ?? '',
      extraParams: { code_verifier: request.codeVerifier },
    },
    doc,
  );
  await keep(tokens);
  return true;
}

async function runRefresh(): Promise<boolean> {
  const refreshToken = await SecureStore.getItemAsync(refreshTokenKey);
  if (!refreshToken) return false;
  const doc = await discover();
  try {
    await keep(await AuthSession.refreshAsync({ clientId: config.oidcClientId, refreshToken }, doc));
    return true;
  } catch (error) {
    if (error instanceof AuthSession.TokenError && error.code === 'invalid_grant') {
      await clear();
      onEnded();
      return false;
    }
    throw error;
  }
}

export function refresh(): Promise<boolean> {
  inflight ??= runRefresh().finally(() => {
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
  const refreshToken = await SecureStore.getItemAsync(refreshTokenKey);
  await clear();
  if (refreshToken && discovery?.revocationEndpoint) {
    await AuthSession.revokeAsync({ clientId: config.oidcClientId, token: refreshToken }, discovery).catch(() => {});
  }
}
