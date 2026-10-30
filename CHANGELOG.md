# Changelog

## Unreleased

### Added

- App shell: Expo SDK 58, Expo Router, TypeScript strict, package
  `com.famashines.ai`, scheme `famashines-ai`, `minSdkVersion` 29.
- Keycloak login with the code flow and PKCE; refresh token in secure
  storage, access token in memory, silent refresh, sign out.
- Biometric lock after 5 minutes in the background, with a retry button.
- English, German and Urdu with right to left for Urdu; language and theme
  overrides in Settings.
- Light and dark themes with WCAG AA contrast tests.
- Screens: Login, Lock, Chat (input off until M1-11), Tasks, Settings.
- Key-value cache on `expo-sqlite` for the offline cache.
- CI: verify, Expo checks, Android export, gitleaks.
