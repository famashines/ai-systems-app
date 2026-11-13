# ai-systems-app

Fama AI, the Android app of ai-systems: a chat with a model. Expo SDK 58,
Expo Router, TypeScript strict, managed workflow. The build setup is the
same as `dev/taseen` (ADR 0012). The app has no task screens since docs
ADR 0035.

```
src/
├── app/              routes only
│   ├── _layout.tsx   providers, fonts, login guard, lock overlay
│   ├── login.tsx
│   └── (tabs)/       chat (index), budget, settings; tabs with no tab bar, the side menu opens them
├── components/       ui.tsx (Screen with header, AppText, Icon, IconButton, Button, Card, StateView),
│                     drawer.tsx (side menu: New chat, the chat list, Budget, Settings),
│                     markdown.tsx (answers as native text, copy button), lock-screen.tsx,
│                     model-picker.tsx (model chip and the model and effort picker)
├── i18n/             en.json, de.json, ur.json, t()
├── lib/              auth, lock, cache, config, api (HTTP: models, budget),
│                     direct (chat stream client, chat store, history), money (micro-USD to text)
├── state/            settings (language, theme, model, effort), session (login, lock),
│                     data (models, budget)
└── theme.ts          colour, spacing, type, font and radius tokens
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
The API URL needs https, with the same local exception
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
- Navigation: the menu button at the start of the header opens a side menu:
  New chat, the list of chats, and Budget and Settings at the bottom. The
  menu comes from the left, and from the right in Urdu. A tap on the
  dimmed area, the close button or the back button closes it. The back
  button on Budget or Settings goes to Chat.
- Data: the app uses HTTP only. It reads the model list and the budget
  after sign-in, and the budget again after each answer. There is no
  WebSocket.

## Chat

```
app                                           api-gateway --> ai-proxy --> OpenRouter
 | POST /api/chat { chatId, model, effort?, messages }   (expo/fetch, a stream)
 | <-- data: {"type":"delta","text":...} ...             text as it comes
 | <-- data: {"type":"done","finishReason","costMicroUsd"}  or  {"type":"error","errorClass"}
 | close the request                                      Stop
```

- Docs ADR 0034 and ADR 0035. The model gets only the messages of the
  chat: no system prompt. `src/lib/direct.ts` has the stream client and
  the chat store.
- History: the store saves each chat in the sqlite cache (`direct.history`
  for the list, `direct.chat.<chatId>` for the messages) when you send a
  message and when an answer ends. It keeps the newest 50 chats. The side
  menu lists them under "Chats": select one to open it, the bin button
  deletes it. Sign-out deletes all. New chat and a restart of the app
  start an empty chat; the old chats stay in the menu. The server stores
  no direct chat.
- The app sends the full chat with each message, and the chosen model and
  effort. A failed answer and an empty answer are not sent again; a
  stopped answer with text is.
- While an answer comes, Send is a Stop button. Stop closes the request
  and keeps the text that came ("Stopped").
- The last answer has "Make the answer again": the app drops that answer
  and asks again. It also shows after an error.
- Errors show under the answer: the budget refused, the connection failed
  (also 45 s with no data; the server sends a ping each 15 s), too many
  messages (429), session ended (401 after one token renewal), chat too
  long (413), no answer from the model.
- An answer that reached the length limit says so.
- `src/components/markdown.tsx` draws markdown with the `marked` lexer as
  native text: headings, bold, italic, strike-through, inline code, code
  blocks (scroll sideways, copy button), lists, task lists, quotes, tables
  (scroll sideways), rules, links. HTML shows as text. A link opens only
  with `http` or `https`. An open code block in a text that still comes
  shows as code.
- Copy: each of your messages and each answer has a copy button. It shows a check mark for 2 s and TalkBack says "Copied". It
  uses `Clipboard` of React Native core (deprecated; it logs one warning);
  change to `expo-clipboard` with the next native release.
- When you scroll up more than 240 dp, a round button goes to the latest
  message.

## Design

```
+----------------------------------+
| [menu]   chat title    [new chat]|   header: the title is the first message
|                                  |
|            ( your message )  blue tint bubble, system sans
|            [copy]                |
| Answer text in Literata, no      |   the answer is a page, not a bubble
| bubble, 17/28, full width        |
| [copy] [again]  Cost $0.0031     |
|                                  |
| +------------------------------+ |
| | Message Fama AI...           | |   composer
| | (model chip)          (send) | |   send is stop while an answer comes
| +------------------------------+ |
+----------------------------------+
```

- One strong choice: the answers are set in Literata (a reading serif,
  regular, italic, semibold, semibold italic), because reading the answer
  is the main job of the app. All other text is the system sans.
  `src/app/_layout.tsx` loads the four font files with `expo-font`; they
  are JS assets, so they come with an EAS Update. Until they load, and for
  scripts that Literata does not have (Urdu), Android uses the system
  font.
- Colours are the brand tokens of `logo-master/SPEC.md`, plus one green
  (`success`) for the check that shows after a copy. Your message uses
  `primaryContainer`.
- An empty chat shows only the message field.
- While the first text of an answer has not come, one blue dot pulses.
  With "Remove animations" on in Android, the dot does not move.

## Model and effort

The owner chooses the model and the reasoning effort of the chat. There
is no Auto. Send stays off until a model is chosen.

```
app                                   api-gateway -> ai-proxy
 | GET /api/models (after sign-in) -------------------------->
 | <-- 200 { items: [{ id, name, efforts, defaultEffort? }] }  (ModelListResultV1)
 | <-- 503 (cold cache): wait 2 s, read one more time
 | picker opens after a failed read: read again
 | POST /api/chat { chatId, model, effort?, messages } ------->
```

- The model chip in the composer shows a short model name and, on a
  second line, the effort, for example "GPT-5" and "High". With no model
  it shows "Choose model", and the composer says that a model is needed. The short name is the text after "Provider: ". When that text
  is longer than 12 characters, the chip shows only its last two words
  ("Anthropic: Claude Opus 5.5" shows as "Opus 5.5"). The picker list
  and the TalkBack label have the full name. TalkBack reads "Model <name>, effort <effort>" and a hint.
- The chip opens the picker (a modal with a title): a search field (it
  filters by name or id), the radio group "Model" (the list, in a
  `FlatList`, because the list can have about 400 models) and the radio
  group "Reasoning effort". The effort group is a rail of nodes and edges,
  from low to high. It shows only when the model has efforts, and only the
  efforts of that model. It starts at the default of the model. "none"
  shows as "Off". Done, the back button, a tap on the dimmed area
  or the handle at the top (drag it down or tap it) closes the picker.
- When the read fails, the picker shows "The model list did not load."
  with Try again.
- A model change keeps the effort in use only when the new model has it,
  else the effort goes back to the default of the new model. A saved effort that is not in use
  (because the saved model is not in the list) does not come back.
- The choice is kept in the settings (sqlite cache key `settings`) and
  stays after sign-out.
- A saved model that is not in the list shows as "Choose model". A saved
  effort that the model does not have is not sent. Until the list loads,
  the app uses the saved model, and the chip shows the last part of its id.
- The picker closes when the app locks, the same as the side menu.

## Budget

- The Budget screen reads `GET /api/budget` (the current month in the
  owner time zone) after sign-in, after each answer, after Save and from
  Try again. A 404 means that no cap is set: the screen says that no
  model call is possible until a cap is set.
- It shows the month, the monthly cap, the soft cap, spent, reserved and
  remaining, and "Over the cap" when `overCapMicroUsd` is above 0.
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

Status: the flow is written, but it was never run. Maestro is not part of
the toolchain now (owner decision).

`.maestro/budget-cap.yaml` signs in, opens the Budget screen, sets a
monthly cap of 0.05 USD with a soft cap of 0.04 USD, and waits until the
view shows the cap.

## Known limits

- The chat history is on this phone only. A second phone does not show it.
  A long chat can pass the 256 KiB body limit of the gateway; the app then
  asks for a new chat.
- A stopped direct answer can book the full reserved amount in the budget
  (ai-proxy README, Known limits).
- The Android recents screen can show a thumbnail of the last screen. The
  app does not set `FLAG_SECURE`. Reconsider in M9 hardening.
- The budget and the model list are not in the offline cache. With no
  connection the Budget screen shows an error with Try again, and a
  message gets "The connection failed".
- The app does not know that the phone is offline before a request fails.
- Push: there are no push notifications.
- The back-end still has the task services (orchestration, agents,
  projections of tasks). The app does not use them (docs ADR 0035).
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
