# Changelog

## Unreleased

### Changed (app name)

- The in-app text uses the name `ai.famashines` (app name, lock screen
  title and unlock prompt) in English, German and Urdu.

### Added (first Google Play release)

- The app name is `ai.famashines`, version 1.0.0.
- The EAS project `@m-yahya/ai-systems`.
- The app icon, the adaptive icon (with a monochrome layer), the splash
  icon for light and dark, and the 512 px Play icon.
- `npm run aab`, `npm run submit:play` (internal track, with an optional
  draft status) and `npm run release:android`, and
  `scripts/bump-version.js`, which also writes the version to `app.json`.
- PRIVACY.md and docs/release.md.

### Added (M2-08)

- Contracts v0.3.0. The task status `blocked` has a label.
- Chat on one conversation for each device: `POST` and `GET
  /api/conversations/:id/messages`, the `conversation:<id>` topic, older
  pages until an empty page, and a "New task" switch for `newTask: true`.
- Live agent text from the `delta` frames of `task:<taskId>`, by
  `(taskId, callId)`, with a restart when `attempt` grows. The final agent
  reply replaces the live text.
- The cost of each agent reply in USD (4 decimals under 0.01 USD).
- Budget tab: the month view from `GET /api/budget` (404 is "no cap set")
  with live `budget` notices, and a form for the monthly cap and the soft
  cap (`POST /api/budget`).
- The live client changes its topics while it runs (`subscribe` and
  `unsubscribe`) and handles `unsubscribed`.

### Fixed (M2-08 review)

- A topic change sends `unsubscribe` before `subscribe`. A refused
  `subscribe` (`validation_failed`) is forgotten and sent again later.
- A reply while the task runs (a refusal) no longer hides the live text;
  only the reply of a `completed` or `failed` task does.
- A first-page reload with no common message starts the paging again.
- A quick sign-out and sign-in no longer leaves the budget on "Loading".
- The cap input refuses a separator with exactly three digits and shows
  the read amount before Save.
- The hint of "New task" says that a message to a running task is
  refused in this version.

### Changed (M2-08)

- The chat posts to the conversation route, not to `POST /api/tasks`.
- The tests that sent the `resync` reason `server_restart` send `too_old`.

### Fixed

- A late token answer can no longer store a refresh token after an
  `invalid_grant` ended the session. The end of a session now starts a
  new session generation before it deletes the tokens.
- Two token answers in the same moment write to secure storage one at a
  time. The first is kept; the second is revoked. The end of a session
  uses the same queue, so a valid rotated token is kept when a late
  `invalid_grant` for the old token comes. A write that does not end in
  15 s releases the queue.
- After any OAuth error on refresh, the login screen shows "Your session
  ended. Sign in again." in English, German and Urdu. The live connection
  no longer removes this message when it signs out.
- A token refresh with no answer no longer blocks refresh for ever. After
  60 s, or at a foreground event when it is older than 15 s, the app
  sends one new refresh with the same token. A late answer is revoked
  when a newer token is stored.
- The WebSocket closes and reconnects when `subscribed` does not come in
  15 s after the socket opens.
- A burst of `resync` or bad notices reads the snapshot one time.

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
