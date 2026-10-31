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
advisory ids in `AUDIT_ALLOW` in `ci.yml` (a comma list). The list is
empty now: the zod advisory 1243066 (GHSA-mrhx-c7xc-m3w5) went away with
`@expo/cli` 58.1.18, and the app uses zod 4.6.7. Add an id only with a
reason in this section.

## Behaviour

- Login: code flow with PKCE. The refresh token is only in
  `expo-secure-store`. The access token is only in memory and is refreshed
  30 seconds before it expires. Any OAuth error from the token endpoint
  (any `error` in the answer, for example `invalid_grant`) ends the
  session, and the login screen shows "Your session ended"; a network
  error or a timeout (15 seconds for each token, discovery and revoke
  request) keeps it. Token answers and the end of a session use secure
  storage one at a time, each for at most 15 seconds; a late answer for
  an ended session or an older token is revoked, not stored. Sign out deletes both
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

The app uses the contracts v0.2.1 schemas for each API answer
(`TaskListResultV1`, `ProblemJson`) and each WebSocket frame
(`ClientMessageV1`, `ServerMessageV1`). A frame that does not parse (for
example a message type from a later contracts version) does not close the
socket: the app ignores it and counts it. If that frame has the type
`notice`, the app also loads the snapshot again, so no change is lost.

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
  topics in the first `subscribe`. A stored `lastSeq` of 0 counts as no
  `lastSeq`.
- The app reads the snapshot after `subscribed`, never before. It reads
  it when it has no `lastSeq`, after `resync` (before or after
  `subscribed`), and when `fromSeq` is higher than `lastSeq + 1`.
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
| a new access token (refresh 30 s before expiry) | `reauth { token }` on an open socket (also between `hello` and `subscribed`); before the socket opens, `hello` takes the new token |
| each `heartbeatMs` (at least 5 s), and when the app comes to the foreground | `ping`; no `pong` in 10 s closes and reconnects |
| server `ping` | `pong` with the same `t` |
| close `4401` | refresh the token, then reconnect; sign out if the refresh is refused; backoff if the refresh has a network error. The third `4401` in one minute with no stable session signs out, and the login screen shows "The server did not accept your sign-in." |
| close `1012` | reconnect at once after a stable session, else with backoff |
| close `4429`, `1013`, `4400`, `4408`, `1006`, other | reconnect with backoff |
| no `subscribed` in 15 s after the socket opens | close and reconnect with backoff |
| `resync`, or a `notice` that does not parse | forget `lastSeq` (`resync` only), load the snapshot again; requests in 0.5 s give one read, and requests during a read give one more read after it |
| the app comes to the foreground while it waits for a backoff | connect at once |

One connect runs at a time. Each connect has a generation number that the
client checks after each wait, and `hello` goes only to the socket that
opened. A socket that the client replaces is closed first.

Backoff: 1 s, 2 s, 4 s ... up to 30 s (`WsLimits`), each multiplied by a
random factor from 0.5 to 1, at least 1 s. Only a stable session resets
it: 10 s after `subscribed`, or the first `notice` or `pong` after
`subscribed`. `welcome` alone does not reset it.

Chat (M1, no conversation topic yet): the app keeps the sent messages in
memory.

| Status | When |
| ------ | ---- |
| Sending | at once after Send; the app makes a lower-case UUID v4 (`expo-crypto`) as `Idempotency-Key` |
| Received | the notice with the same `commandId` came, or the task is in the list |
| Still processing | 10 s after Send with no notice |
| Service not available. Trying again. | 502 or 503: up to 4 attempts with backoff; 429: the same, but it waits `Retry-After` |
| Not sent, with Send again | a network error, or the last attempt failed; Send again uses the same key |
| The server did not accept this message. | another problem answer (400, 409, 413, 422), or a text that does not fit `SubmitTaskCommandPayloadV1`; no retry. The input takes at most 20000 characters. |

A 401 answer refreshes the token and sends the request one more time.
TalkBack reads each status change of a message (polite live region).

Offline: the app keeps the task list (the newest 200 tasks) and `lastSeq`
in the sqlite cache (key `live.tasks`), only after a snapshot. While the socket is not
connected, the Tasks screen shows "Offline, last update hh:mm" and the
chat input and Send are off. Sign-out (also from the lock screen, or when
the session ends) removes `live.tasks` and keeps the settings.

### Maestro

Status: the flow is written, but it was never run, and it does not fit
the local system of M1-05 yet. Maestro is not part of the toolchain now
(owner decision).

`.maestro/live-tasks.yaml` signs in, sends a task in the chat, sees it in
the list, sets airplane mode, sends a second task through the API from the
host while the phone is offline (two times with the same
`Idempotency-Key`), turns airplane mode off, and checks that each task
shows once.

What is missing before it can run against the local system:

- The dev issuer of the local system has no authorization endpoint and
  no refresh grant. The app signs in with the code flow and PKCE and
  refreshes the token, so it needs an issuer with both (for example a
  local Keycloak realm with the client `ai-systems-app` and the redirect
  `com.famashines.ai:/oauth2redirect`). The flow also needs a client with
  the password grant (`TOKEN_CLIENT_ID`) for the API step.
- The issuer host must be the same for the emulator and the containers:
  the token `iss` must equal `EXPO_PUBLIC_OIDC_ISSUER`, and the gateways
  check `iss` against `OIDC_ISSUER`. The local issuer gives
  `http://issuer:8080/realms/ai-systems`, a name that only the containers
  resolve. `10.0.2.2` works only from the emulator, `localhost` only from
  the host.
- Ports of the local system: api-gateway 8080, socket-gateway 8081,
  issuer 8082. `/api` and `/ws` are on different ports, so the build needs
  `EXPO_PUBLIC_API_URL=http://10.0.2.2:8080` and
  `EXPO_PUBLIC_WS_URL=ws://10.0.2.2:8081/ws`.
- React Native sends the WebSocket `Origin` from the URL, here
  `http://10.0.2.2:8081`. The socket-gateway `ALLOWED_ORIGINS` must have
  it.
- The Maestro CLI.

When these are in place:

```
EXPO_PUBLIC_OIDC_ISSUER=<issuer URL that the emulator and the containers both reach> \
EXPO_PUBLIC_API_URL=http://10.0.2.2:8080 \
EXPO_PUBLIC_WS_URL=ws://10.0.2.2:8081/ws npm run android
adb shell pm clear com.android.chrome
maestro test .maestro/live-tasks.yaml \
  -e API_URL=http://localhost:8080 \
  -e ISSUER=<the same issuer URL, as the host reaches it> \
  -e TOKEN_CLIENT_ID=<client with the password grant> \
  -e USERNAME=<test owner> -e PASSWORD=<password>
```

`pm clear` removes the issuer cookie of the last run from Chrome, so the
login page shows again. The token of `TOKEN_CLIENT_ID` must have the
audience `ai-systems-app` and the role `owner`.

## Known limits

- The Android recents screen can show a thumbnail of the last screen. The
  app does not set `FLAG_SECURE`. Reconsider in M9 hardening.
- Chat messages are in memory only. After a restart the chat is empty;
  the tasks are in the Tasks list. The `conversation:<id>` topic comes in
  M2.
- A refresh with the same refresh token joins the request that waits,
  so the server normally sees each refresh token one time. React Native
  fetch has no read timeout and `expo-auth-session` takes no
  `AbortSignal`, so a request can wait for ever. After 60 s
  (`lateAnswerMs`), or at the next foreground event when the request is
  older than 15 s, the app gives up on it and sends one new refresh with
  the same refresh token. A late answer of the old request is revoked if
  a newer token is stored, else kept; its late `invalid_grant` does not
  end the session. With refresh token rotation the worst case is an
  `invalid_grant` on the new request: the app signs out, and the user
  signs in again. Each caller stops waiting after 15 s.
- `1013` is not in contracts `WsCloseCode` v0.2.0 (M2-02); the app has a
  local constant.
- Invalid WebSocket frames are only counted in memory
  (`LiveClient.invalidFrames`); there is no telemetry yet.

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
