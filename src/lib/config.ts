export const config = {
  oidcIssuer: process.env.EXPO_PUBLIC_OIDC_ISSUER || 'https://auth.famashines.com/realms/ai-systems',
  oidcClientId: 'ai-systems-app',
  redirectUri: 'com.famashines.ai:/oauth2redirect',
  apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://ai.famashines.com',
};
