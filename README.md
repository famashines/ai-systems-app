# ai-systems-app

The Android app of ai-systems. Expo SDK 58, Expo Router, TypeScript
strict, managed workflow. The build setup is the same as `dev/taseen`
(ADR 0012).

```
src/
├── app/              routes only
│   ├── _layout.tsx   providers, login guard, lock overlay
│   ├── login.tsx
│   └── (tabs)/       chat (index), tasks, settings
├── components/       ui.tsx (Screen, AppText, Button, StateView), lock-screen.tsx, live-bar.tsx
├── i18n/             en.json, de.json, ur.json, t()
├── lib/              auth, lock, cache, config, api (HTTP), live (WebSocket client)
├── state/            settings (language, theme), session (login, lock), live (tasks, chat)
└── theme.ts          colour, spacing, type and radius tokens
```

## Run

Needs Node 22.13.0 (`.nvmrc`), the Android SDK and an emulator or a
device.

```
nvm use
npm ci
cp .env.example .env
npm run android
```

`npm run android` runs `expo run:android`. It makes the `android/`
folder with prebuild (not committed), builds a development build, installs
it and starts Metro.

## Configuration

`.env.example` lists the variables with no values. An empty or missing
variable uses the default.

| Variable | Default | Use |
| -------- | ------- | --- |
| `EXPO_PUBLIC_OIDC_ISSUER` | `https://auth.famashines.com/realms/ai-systems` | Keycloak issuer for the login |
| `EXPO_PUBLIC_API_URL` | `https://ai.famashines.com` | gateway origin for `/api` |
| `EXPO_PUBLIC_WS_URL` | `EXPO_PUBLIC_API_URL` with `wss` and `/ws` | WebSocket URL, only for a local stack that has `/ws` on another port |

The client id is `ai-systems-app`. The redirect URI is
`com.famashines.ai:/oauth2redirect`, a private-use scheme in reverse-domain
form (RFC 8252). The Keycloak client must have the same redirect URI. The
app scheme is `com.famashines.ai`. `EXPO_PUBLIC_*` values go into the
bundle. Do not put a secret in them.

The app accepts a discovery document only when its `issuer` is the
configured issuer and all endpoints use https. A development build also
accepts http on `localhost`, `127.0.0.1` and `10.0.2.2`, for a local test
issuer.

zod checks the `EXPO_PUBLIC_*` values at start (`src/lib/config.ts`). The
API and WebSocket URLs need https and wss, with the same local exception
in a development build.

## Test

| Command | Does |
| ------- | ---- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (no hard-coded UI text, no colour literals) and the no-comments check |
| `npm test` | Jest with `jest-expo` and the coverage gate (70% lines) |
| `npm run contrast` | the WCAG AA contrast test of the theme only |
| `npm run verify` | all of the above |

CI (`.github/workflows/ci.yml`) also runs `npm audit`, `npx expo install
--check`, `expo-doctor`, `expo export --platform android`, and gitleaks on
the git history and on the exported bundle. `pr-title-check.yml` checks
that the PR title is a Conventional Commit.

### Audit allow-list

The audit step fails on each high or critical advisory, except the
advisory ids in `AUDIT_ALLOW` in `ci.yml`:

| Advisory id | Advisory | Reason |
| ----------- | -------- | ------ |
| 1243066 | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), zod < 4.6.6 | It comes through `@expo/cli`, a build tool. zod does not run in the app bundle. Remove the entry when Expo SDK 58 ships a fixed `@expo/cli`. |

## Behaviour

- Login: code flow with PKCE. The refresh token is only in
  `expo-secure-store`. The access token is only in memory and is refreshed
  30 seconds before it expires. An OAuth error from the token endpoint
  ends the session; a network error or a timeout (15 seconds for each
  token, discovery and revoke request) keeps it. Sign out deletes both
  tokens first, then waits at most 10 seconds for a running token request
  and revokes the newest refresh token.
- Lock: the app locks at start with a stored session, and after 5 minutes
  in the background (or when the clock moved back). Unlock is biometrics
  or the device PIN. The lock screen also has Sign out. If the screen-lock
  check fails, the app locks. A device with no screen lock is not locked,
  because it cannot unlock; Settings shows a warning.
- Language: follows the device (English, German or Urdu, else English),
  with an override in Settings. Urdu sets right to left and reloads the
  app once. When you pick the language in Settings, that reload does not
  lock the app (a mark valid for 30 seconds). A reload after a change of
  the device language locks as a normal cold start.
- Theme: follows the device, with an override in Settings.
- Live connection: one WebSocket for each signed-in session (also while
  locked). See "Live tasks" below.

## Live tasks

The app uses the contracts v0.2.0 schemas for each API answer
(`TaskListResultV1`, `ProblemJson`) and each WebSocket frame
(`ClientMessageV1`, `ServerMessageV1`). A frame that does not parse
closes the socket, and the app reconnects with `lastSeq`.

```
app                                  socket-gateway        api-gateway
 | new WebSocket(wsUrl), no token in the URL |                    |
 | hello { v: 1, token, lastSeq? } --------> |                    |
 | <------------- welcome { heartbeatMs }    |                    |
 | subscribe { topics: ["tasks"] } --------> |                    |
 | <------------- subscribed { fromSeq }     |                    |
 | GET /api/tasks?limit=50 (only when a snapshot is necessary) -> |
 | <------------- notice { seq, docId, rev, data, commandId? }    |
```

First load and reconnect:

- The first connect has no `lastSeq`. A reconnect sends `lastSeq` and all
  topics in the first `subscribe`.
- The app reads the snapshot after `subscribed`, never before. It reads
  it when it has no `lastSeq`, after `resync`, and when `fromSeq` is
  higher than `lastSeq + 1`.
- A notice with `seq <= lastSeq` is dropped. A notice with a `rev` that
  is not higher than the stored task is dropped, but its `seq` still
  moves `lastSeq`. A snapshot item replaces a stored task when its `rev`
  is the same or higher.
- More pages: `before` = `createdAt` and `beforeId` = `taskId` of the
  last task in the list (the list order is `createdAt`, then `taskId`,
  newest first).

Connection rules:

| Event | What the app does |
| ----- | ----------------- |
| a new access token (refresh 30 s before expiry) | `reauth { token }` |
| each `heartbeatMs`, and when the app comes to the foreground | `ping`; no `pong` in 10 s closes and reconnects |
| server `ping` | `pong` with the same `t` |
| close `4401` | refresh the token, then reconnect at once; sign out if the refresh is refused; backoff if the refresh has a network error |
| close `1012` | reconnect at once (backoff if it happens again before `welcome`) |
| close `4429`, `1013`, `4400`, `4408`, `1006`, other | reconnect with backoff |
| `resync` | forget `lastSeq`, load the snapshot again |

Backoff: 1 s, 2 s, 4 s ... up to 30 s (`WsLimits`), each multiplied by a
random factor from 0.5 to 1, at least 1 s. `welcome` resets it.

Chat (M1, no conversation topic yet): the app keeps the sent messages in
memory.

| Status | When |
| ------ | ---- |
| Sending | at once after Send; the app makes a lower-case UUID v4 (`expo-crypto`) as `Idempotency-Key` |
| Received | the notice with the same `commandId` came, or the task is in the list |
| Still processing | 10 s after Send with no notice |
| Service not available. Trying again. | 502 or 503: up to 4 attempts with backoff; 429: the same, but it waits `Retry-After` |
| Not sent, with Send again | a network error, or the last attempt failed; Send again uses the same key |
| The server did not accept this message. | another problem answer (400, 409, 413, 422); no retry |

A 401 answer refreshes the token and sends the request one more time.

Offline: the app keeps the task list and `lastSeq` in the sqlite cache
(key `live.tasks`), only after a snapshot. While the socket is not
connected, the Tasks screen shows "Offline, last update hh:mm" and the
chat input and Send are off. Sign-out (also from the lock screen, or when
the session ends) removes `live.tasks` and keeps the settings.

### Maestro

`.maestro/live-tasks.yaml` signs in, sends a task in the chat, sees it in
the list, sets airplane mode, sends a second task through the API from the
host while the phone is offline (two times with the same
`Idempotency-Key`), turns airplane mode off, and checks that each task
shows once.

It needs the local system of M1-05 (`docker compose up` in `kit`: a local
OIDC issuer and the four services), a development build on the emulator
`Pixel_8`, and the Maestro CLI.

```
EXPO_PUBLIC_OIDC_ISSUER=http://10.0.2.2:8090/realms/ai-systems \
EXPO_PUBLIC_API_URL=http://10.0.2.2:8080 npm run android
maestro test .maestro/live-tasks.yaml \
  -e API_URL=http://localhost:8080 \
  -e ISSUER=http://localhost:8090/realms/ai-systems \
  -e TOKEN_CLIENT_ID=<client with direct access grants> \
  -e USERNAME=<test owner> -e PASSWORD=<password>
```

`API_URL` and `ISSUER` are the host view of the same services
(`localhost`); the app sees them as `10.0.2.2`. The token of
`TOKEN_CLIENT_ID` must have the audience `ai-systems-app` and the role
`owner`. React Native sends the WebSocket `Origin` from the URL, for
example `http://10.0.2.2:8080`, so the local socket-gateway must have it
in `ALLOWED_ORIGINS`. The ports above are examples; use the ports of the
M1-05 compose file.

## Known limits

- The Android recents screen can show a thumbnail of the last screen. The
  app does not set `FLAG_SECURE`. Reconsider in M9 hardening.
- Chat messages are in memory only. After a restart the chat is empty;
  the tasks are in the Tasks list. The `conversation:<id>` topic comes in
  M2.
- A token refresh with no answer blocks a new refresh for at most 60
  seconds (`lateAnswerMs`). React Native has no read timeout on fetch.
- `1013` is not in contracts `WsCloseCode` v0.2.0 (M2-02); the app has a
  local constant.
- Contracts v0.2.0 declares `engines.node >=26` for its own build. The
  app does not use `engine-strict`, so `npm ci` on Node 22.13.0 shows an
  engine warning for it. A contracts release with a lower `engines` range
  can remove this.

## What the owner must do later

The app has no EAS project yet, so `app.json` has no `extra.eas` and no
`updates.url`. Before the first EAS build or EAS Update:

1. Create the Expo project `ai-systems` (`npx eas-cli init`). This adds
   `extra.eas.projectId` and `owner` to `app.json`.
2. Add `EXPO_TOKEN` as a secret of this repo for the build workflow.
3. Create the Play Console app `com.famashines.ai` with a service account
   (ADR 0012).

The Keycloak realm `ai-systems` and the client `ai-systems-app` with the
redirect URI `com.famashines.ai:/oauth2redirect` must exist before a real
login works (gitops PR, ADR 0009).
