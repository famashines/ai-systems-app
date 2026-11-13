import { readConfig } from '@/lib/config';

it('uses the defaults for empty or missing values', () => {
  expect(readConfig({ EXPO_PUBLIC_OIDC_ISSUER: '', EXPO_PUBLIC_API_URL: undefined })).toMatchObject({
    oidcIssuer: 'https://auth.famashines.com/realms/ai-systems',
    apiUrl: 'https://ai.famashines.com',
  });
});

it('accepts a local http stack in a development build', () => {
  expect(readConfig({ EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8080/' })).toMatchObject({ apiUrl: 'http://10.0.2.2:8080' });
});

it.each(['http://ai.example.test', 'ftp://ai.famashines.com', 'not a url'])('refuses %s', (value) => {
  expect(() => readConfig({ EXPO_PUBLIC_API_URL: value })).toThrow();
});
