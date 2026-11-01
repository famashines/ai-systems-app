# ai-systems-app

Fama AI, the Android app of ai-systems. Expo SDK 58, Expo Router, TypeScript
strict, managed workflow. The build setup is the same as `dev/taseen`
(ADR 0012).

```
src/
├── app/              routes only
│   ├── _layout.tsx   providers, login guard, lock overlay
│   ├── login.tsx
│   └── (tabs)/       chat (index), tasks, budget, settings
├── components/       ui.tsx (Screen, AppText, Button, StateView), lock-screen.tsx, live-bar.tsx
├── i18n/             en.json, de.json, ur.json, t()
├── lib/              auth, lock, cache, config, api (HTTP), live (WebSocket client),
│                     chat (thread, deltas, topics), money (micro-USD to text)
├── state/            settings (language, theme), session (login, lock), live (tasks, chat, budget)
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
variable uses the default. The `GOOGLE_*` variables are only for the
release scripts (docs/release.md, section 4).

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
  locked). See "Live tasks", "Chat" and "Budget" below.

## Live tasks

The app uses the contracts v0.3.0 schemas for each API answer
(`TaskListResultV1`, `ConversationThreadResultV1`, `BudgetMonthV1`,
`ProblemJson`) and each WebSocket frame
(`ClientMessageV1`, `ServerMessageV1`). A frame that does not parse (for
example a message type from a later contracts version) does not close the
socket: the app ignores it and counts it. If that frame has the type
`notice`, the app also loads the snapshot again, so no change is lost.

```
app                                  socket-gateway        api-gateway
 | new WebSocket(wsUrl), no token in the URL |                    |
 | hello { v: 1, token, lastSeq? } --------> |                    |
 | <------------- welcome { heartbeatMs }    |                    |
 | subscribe { topics: ["tasks", "budget", "conversation:<id>"] } |
 | <------------- subscribed { fromSeq }     |                    |
 | GET /api/tasks, thread and budget (when a snapshot is necessary) ->
 | <------------- notice { seq, docId, rev, data, commandId? }    |
 | subscribe / unsubscribe { topics: ["task:<taskId>"] } -------> |
 | <------------- delta { taskId, callId, attempt, i, text }      |
```

First load and reconnect:

- The first connect has no `lastSeq`. A reconnect sends `lastSeq` and all
  topics in the first `subscribe`. A stored `lastSeq` of 0 counts as no
  `lastSeq`.
- The app reads the snapshot after `subscribed`, never before. It reads
  it when it has no `lastSeq`, after `resync` (before or after
  `subscribed`; the only reason is `too_old`), and when `fromSeq` is
  higher than `lastSeq + 1`. The snapshot is the task list, the first page
  of the thread and the budget month. The thread and the budget are not
  cached, so the app also reads them at the first `subscribed` of each
  session.
- Only the `subscribed` answer to the first `subscribe` of a socket starts
  the session. A `subscribed` for a later `task:<id>` topic loads nothing:
  the task topics have no read model yet (M3).
- A topic change sends `unsubscribe` before `subscribe`, so the server
  frees the slots first and a new task topic fits at 50 topics. When the
  server refuses a `subscribe` (`error` `validation_failed`, too many
  topics), the app counts it (`LiveClient.refusedSubscribes`) and forgets
  those topics, so it sends them again at the next topic change and after
  a reconnect.
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

## Chat

```
app                                api-gateway / socket-gateway
 | POST /api/conversations/<id>/messages { text, newTask }, Idempotency-Key
 | <-- 202 { messageId, intent, taskId? }
 | <-- notice conversation:<id> owner message { commandId }      "Received"
 | <-- notice conversation:<id> owner message rev 2 { taskId }
 | subscribe task:<taskId> -->
 | <-- delta { attempt, i, text } ...                            live text
 | <-- notice conversation:<id> agent message { text, costMicroUsd? }
 | unsubscribe task:<taskId> --> <-- unsubscribed
```

- One conversation for each device (M2). The app makes a lower-case UUID
  v4 at the first start and keeps it in the sqlite cache
  (`chat.conversationId`). Sign-out keeps it, so the thread is there
  again after the next sign-in; the id has no data, and each read needs
  the token.
- New task: the switch "New task" next to the input. When it is on, the
  next message has `newTask: true`, and the switch goes off after the
  send. When it is off, the message has `newTask: false`, and
  conversation-hub decides: a running task of the thread gets the
  message (steer), else it starts a new task. In this version
  orchestration refuses a message to a running task (the refusal comes as
  a reply), and the TalkBack hint of the switch says so. The app never
  sends a `taskId`.
- Thread: `GET /api/conversations/<id>/messages?limit=50`, newest first,
  shown in an inverted list (newest at the bottom). Older pages use
  `before` = `createdAt` and `beforeId` = `messageId` of the last item of
  the last page. A page is limited by bytes, so it can have fewer items
  than `limit`: only an empty page is the end. When a reload of the first
  page (after a snapshot) shares no `messageId` with the stored items, the
  app drops the stored items and starts the paging again from that page.
  Notices of
  `conversation:<id>` merge by `docId` and `rev`, the same as tasks.
- Task topics: the app subscribes `task:<taskId>` for each task of the
  thread whose newest message is an owner message (it waits for a
  reply), and for each task whose status in the task list is not
  `blocked`, `completed`, `failed`, `cancelled` or `rejected`. So a
  refusal reply to a second message does not stop the live text of a
  running task. At most 50 topics in total, the newest tasks first.
- Deltas: the state is kept by `(taskId, callId)`. The text is the parts
  in index order (an object by index, so a large `i` costs no memory); a
  lost delta is a gap. When `attempt` grows, the app
  drops the text of the earlier attempt and starts again at `i = 0`. A
  delta of an older attempt is dropped. The live text goes away when an
  agent reply of the task came after the last delta and the task status
  in the task list is `completed` or `failed`: then that reply is the
  final run reply. A reply while the task still runs (for example the
  refusal of a second message) does not hide the live text. The app takes deltas only for the task topics that
  it has now, and after `unsubscribed` it removes the live text of those
  tasks.
- The live text has no TalkBack live region (each delta would be read);
  the agent reply has a polite live region.
- Cost: an agent reply shows `costMicroUsd` (integer micro-USD, all LLM
  attempts of its task) in USD with the number format of the language:
  4 decimals under 0.01 USD, else 2. Under 0.0001 USD the text is
  "under $0.0001". The app never stores the amount as a float.

| Status | When |
| ------ | ---- |
| Sending | at once after Send; the app makes a lower-case UUID v4 (`expo-crypto`) as `Idempotency-Key` |
| Received | the message is in the thread: the notice with the same `commandId`, or a snapshot with its `messageId` |
| Still processing | 10 s after Send with no notice |
| Service not available. Trying again. | 502 or 503: up to 4 attempts with backoff; 429: the same, but it waits `Retry-After` |
| Not sent, with Send again | a network error, or the last attempt failed; Send again uses the same key |
| The server did not accept this message. | another problem answer (400, 409, 413, 422), or a text that does not fit `PostOwnerMessageCommandPayloadV1`; no retry. The input takes at most 20000 characters. |

A 401 answer refreshes the token and sends the request one more time.
TalkBack reads each status change of a message (polite live region).

Offline: the app keeps the task list (the newest 200 tasks) and `lastSeq`
in the sqlite cache (key `live.tasks`), only after a snapshot. While the socket is not
connected, the Tasks screen shows "Offline, last update hh:mm" and the
chat input, the New task switch and Send are off, and the Budget form
cannot save. Sign-out (also from the lock screen, or when
the session ends) removes `live.tasks` and keeps the settings.

## Budget

- The Budget tab reads `GET /api/budget` (the current month in the owner
  time zone) at the first `subscribed` and with each snapshot. A 404
  means that no cap is set: the screen says that the agents cannot call a
  model until a cap is set.
- It shows the month, the monthly cap, the soft cap, spent, reserved and
  remaining, and "Over the cap" when `overCapMicroUsd` is above 0.
- A `budget` notice for the shown month with a higher `rev` replaces the
  view. A notice for a later month, or any notice while no month is shown,
  reads the month again. Notices for older months (a cap change notifies
  every month) are dropped.
- Set the cap: the monthly cap and an optional soft cap in USD, with a dot
  or a comma as the decimal sign. The app reads the text to integer
  micro-USD with no float, and shows the read amount under each field
  before Save ("Amount: $1.50"). A dot or a comma with exactly three
  digits after it ("1,000", "1.000") is refused with its own text,
  because it can be a thousands separator. It checks the amount (0 to 1,000,000 USD, at
  most 6 decimals) and that the soft cap is not above the cap before it
  sends `POST /api/budget` with `{ scope: { kind: "month" },
  hardCapMicroUsd, softCapMicroUsd? }` and an `Idempotency-Key`. A retry
  after a network error uses the same key; a change of the amounts makes
  a new key. After 202 the app reads the month again. A problem answer
  (400, 403, 409) shows "The server did not accept this cap."

## Maestro

Status: the flow is written, but it was never run, and it does not fit
the local system of M1-05 yet. Maestro is not part of the toolchain now
(owner decision).

`.maestro/live-tasks.yaml` signs in, sends a message in the chat (it
starts a task), sees the task in the list, sets airplane mode, sends a
second task through the API from the host while the phone is offline (two
times with the same `Idempotency-Key`), turns airplane mode off, and
checks that each task shows once.

`.maestro/budget-cap.yaml` signs in, opens the Budget tab, sets a monthly
cap of 0.05 USD with a soft cap of 0.04 USD, and waits until the view
shows the cap.

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
maestro test .maestro/live-tasks.yaml .maestro/budget-cap.yaml \
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
- The thread and the budget are not in the offline cache. After a cold
  start with no connection the chat and the Budget tab are empty; the
  tasks are in the Tasks list.
- One conversation for each device. There is no list of threads and no
  way to start a second thread (M2 scope).
- The app does not send a `taskId`, so it cannot steer a `blocked` task
  (conversation-hub steers a blocked task only with its `taskId`).
- A task that is older than the loaded task list and whose newest thread
  message is an owner message stays subscribed (at most 47 task topics).
- Each `conversation:<id>` and `budget` notice also moves the `lastSeq`
  of the task cache, so the app writes `live.tasks` for each notice, the
  same as for a `tasks` notice.
- The task list still pages with `items.length === limit`. The task list
  of projections is not limited by bytes, so this is correct for it, but
  it is not the rule of the thread.
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

## Release

`npm run aab` builds `ai-systems-<version>.aab` with a local EAS build.
`npm run release:android` builds and uploads it to the Google Play
internal testing track. The first release, the Play Console forms and the
service account are in [docs/release.md](docs/release.md). The privacy
policy is [PRIVACY.md](PRIVACY.md).

## Logo and store graphics

The app name is `Fama AI`. The mark, its rules and the asset table are in
[logo-master/SPEC.md](logo-master/SPEC.md).
`python3 scripts/build-logo-assets.py` (Python 3 with pycairo and Pillow)
makes the app icons, the splash icons, the 512 px Play icon and the
feature graphic, then checks them. A changed icon or splash needs a new
native build.

## What the owner must do later

Do the first Google Play release by hand: [docs/release.md](docs/release.md),
sections 2 to 4.

The Keycloak realm `ai-systems` and the client `ai-systems-app` with the
redirect URI `com.famashines.ai:/oauth2redirect` must exist before a real
login works (gitops PR, ADR 0009).
