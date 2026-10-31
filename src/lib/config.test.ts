import { readConfig } from '@/lib/config';

it('uses the defaults for empty or missing values', () => {
  expect(readConfig({ EXPO_PUBLIC_OIDC_ISSUER: '', EXPO_PUBLIC_API_URL: undefined })).toMatchObject({
    oidcIssuer: 'https://auth.famashines.com/realms/ai-systems',
    apiUrl: 'https://ai.famashines.com',
    wsUrl: 'wss://ai.famashines.com/ws',
  });
});

it('accepts a local http stack in a development build', () => {
  expect(readConfig({ EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8080/' })).toMatchObject({ apiUrl: 'http://10.0.2.2:8080', wsUrl: 'ws://10.0.2.2:8080/ws' });
});

it('takes a separate WebSocket URL when one is set', () => {
  expect(readConfig({ EXPO_PUBLIC_WS_URL: 'ws://10.0.2.2:8081/ws' }).wsUrl).toBe('ws://10.0.2.2:8081/ws');
  expect(() => readConfig({ EXPO_PUBLIC_WS_URL: 'ws://ai.example.test/ws' })).toThrow();
  expect(() => readConfig({ EXPO_PUBLIC_WS_URL: 'https://ai.famashines.com/ws' })).toThrow();
});

it.each(['http://ai.example.test', 'ftp://ai.famashines.com', 'not a url'])('refuses %s', (value) => {
  expect(() => readConfig({ EXPO_PUBLIC_API_URL: value })).toThrow();
});
