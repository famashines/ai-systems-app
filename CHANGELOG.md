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
- Live tasks (M1-11): `@famashines/ai-systems-contracts` v0.2.1 and zod
  4.6.7 for every API answer, every WebSocket frame and the
  `EXPO_PUBLIC_*` config.
- WebSocket client: one connection for each session, `hello` with the
  token in the frame, `reauth` on each new token, heartbeat `ping`,
  reconnect with backoff and `lastSeq`, close code rules, `resync`; one
  connect at a time; backoff resets only after a stable session; invalid
  frames are ignored and counted; three refused tokens in one minute sign
  out with a message.
- Tasks list: subscribe, then snapshot; notices by `docId` and `rev`;
  pages with `before` and `beforeId`; loading, empty, error and offline
  states; "Reconnecting" and "Updated" bar.
- Chat: send with an `Idempotency-Key`; "Sending", "Received", "Still
  processing", "Not sent" with a retry on the same key; 401, 429 and
  502/503 rules.
- Offline cache of the newest 200 tasks and `lastSeq`; sign-out removes
  it and keeps the settings.
- Maestro flow `.maestro/live-tasks.yaml` (airplane mode, no duplicate),
  not run yet.

### Changed

- A token refresh answer that comes after the 15 s timeout is kept when
  the session did not change.
- Sign-out revokes each distinct refresh token, and a refresh answer
  that comes after sign-out is revoked. A refresh with the same refresh
  token joins the one that waits.
