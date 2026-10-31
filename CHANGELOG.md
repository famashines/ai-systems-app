# Changelog

## Unreleased

### Added

- App shell: Expo SDK 58, Expo Router, TypeScript strict, package
  `com.famashines.ai`, scheme `com.famashines.ai`, `minSdkVersion` 29.
- Keycloak login with the code flow and PKCE, redirect
  `com.famashines.ai:/oauth2redirect`; refresh token in secure storage,
  access token in memory, silent refresh, sign out that is safe during a
  refresh; discovery issuer and https check.
- Biometric lock after 5 minutes in the background, with retry and sign
  out; warning in Settings when the device has no screen lock.
- English, German and Urdu with right to left for Urdu; language and theme
  overrides in Settings.
- Light and dark themes with WCAG AA contrast tests.
- Screens: Login, Lock, Chat (input off until M1-11), Tasks, Settings.
- Key-value cache on `expo-sqlite` for the offline cache.
- CI: verify, npm audit with an allow-list, Expo checks, Android export,
  gitleaks; PR title check.
