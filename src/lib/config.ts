import { z } from 'zod';

const localHosts = ['localhost', '127.0.0.1', '10.0.2.2'];

export function secure(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  return protocol === 'https:' || (__DEV__ && localHosts.includes(hostname));
}

const url = (fallback: string) =>
  z.preprocess(
    (value) => value || undefined,
    z
      .url({ protocol: /^https?$/ })
      .default(fallback)
      .refine(secure, 'Use https')
      .transform((value) => value.replace(/\/+$/, '')),
  );

const socketUrl = z.preprocess(
  (value) => value || undefined,
  z
    .url({ protocol: /^wss?$/ })
    .refine((value) => secure(value.replace(/^ws/, 'http')), 'Use wss')
    .optional(),
);

const Env = z.object({
  EXPO_PUBLIC_OIDC_ISSUER: url('https://auth.famashines.com/realms/ai-systems'),
  EXPO_PUBLIC_API_URL: url('https://ai.famashines.com'),
  EXPO_PUBLIC_WS_URL: socketUrl,
});

export function readConfig(env: Record<string, string | undefined>) {
  const parsed = Env.parse(env);
  return {
    oidcIssuer: parsed.EXPO_PUBLIC_OIDC_ISSUER,
    oidcClientId: 'ai-systems-app',
    redirectUri: 'com.famashines.ai:/oauth2redirect',
    apiUrl: parsed.EXPO_PUBLIC_API_URL,
    wsUrl: parsed.EXPO_PUBLIC_WS_URL ?? `${parsed.EXPO_PUBLIC_API_URL.replace(/^http/, 'ws')}/ws`,
  };
}

export const config = readConfig({
  EXPO_PUBLIC_OIDC_ISSUER: process.env.EXPO_PUBLIC_OIDC_ISSUER,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_WS_URL: process.env.EXPO_PUBLIC_WS_URL,
});
