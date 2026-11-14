# Changelog

## Unreleased

### Added (chat sync)

- The chats are saved on the server (docs ADR 0037). The app shows the
  cached chats at once, then the chats of the server. A chat from another
  device opens when its messages load. Delete, rename and bookmark go to
  the server; when the phone is offline they wait in a queue. Sign-out
  deletes the copy on the phone; the chats stay on the server.
- The privacy policy says which chat data the server keeps and how to
  delete it.

### Added (chat)

- Short chat titles written by a model (docs ADR 0036): after the first
  answer the app asks `POST /api/chat/title` one time. Until the title
  comes, or when the call fails, the title is the first line of the first
  message, cut at a word to 40 characters. A rename always wins.
- A chat menu in the header (three dots): Bookmark, Rename, Delete.
  Bookmarked chats show in their own group at the top of the side menu.
- A swipe to the left on a chat in the side menu shows Delete. TalkBack
  has a Delete action on each chat.

### Changed (chat)

- The side menu has no New chat; it is in the chat header, which shows
  it only when the chat has messages. Budget and Settings have a back
  button to the chat.
- The model chip shows only while the message field has focus, as a
  compact pill. The send button is next to the field, 36 dp with a 48 dp
  touch area. The field has no border.
- The keyboard closes on a tap on the empty chat, on a drag of the list,
  and when the menu or the model picker opens.
- Corners as in Taseen: 8, 14 and full radius, no `borderCurve`. ESLint
  rejects number literals for a radius and any `borderCurve`.

### Removed (tasks)

- All task functions (docs ADR 0035): the Tasks screen, the task detail
  screen, plans and plan editing, owner controls, checkpoints, the New
  task switch, replies to a task, the task thread in the chat, the recent
  tasks in the side menu, and the task cache on the phone.
- The WebSocket connection, the connection bar and `EXPO_PUBLIC_WS_URL`.
  The app uses HTTP only.
- 155 text keys that only the task screens used, the task flows of
  Maestro, and the Tasks store screenshot.

### Added

- `EXPO_PUBLIC_LOGIN=off` turns the login off for internal testing: no
  login screen, no lock screen and no Sign out.

### Fixed

- In Expo Go, the login returns to Expo Go. Before, Android gave the login
  redirect to the installed test version.

### Changed (chat only, new design)

- The app is a chat with a model. The side menu has New chat, the list of
  chats, and Budget and Settings at the bottom.
- Answers are set in Literata, a reading serif, with no bubble. Your
  messages are in a blue tint bubble. New dependency
  `@expo-google-fonts/literata` 0.4.3 (font files only, four faces).
- An empty chat shows only the message field: no mark, no question and no
  starter lines.
- After a copy, the copy icon changes to a green check for 2 seconds. New
  colour token `success`.
- The copy and regenerate icons use the quiet `onSurfaceVariant` colour.
- The header shows the title of the chat (its first message).
- One pulsing dot shows while the first text of an answer has not come.
- The composer has the model chip at the start and Send at the end.
- The model list and the budget load after sign-in. The budget loads again
  after each answer.

### Added (chat history)

- Direct chats are kept on the phone, at most the newest 50. The side menu
  lists them under "Chats". Select a chat to open it and continue it. The
  bin button deletes one chat. Sign-out deletes all chats.
- An answer that still comes when the app stops is not kept; the message
  before it is.

### Changed (CI)

- The CI steps "Verify Expo dependencies" and "Verify Expo project" use the
  package list in the installed `expo` version (`EXPO_OFFLINE=1`). The
  online list changes with each Expo patch release and made `main` red
  with no change in the repo. docs/release.md says when to take the new
  patch versions.

### Added (direct chat)

- With New task off, a message goes directly to the model (`POST
  /api/chat`, docs ADR 0034): no system prompt, no task, no agent. The
  answer shows as it comes. The app sends the full chat with each message,
  and the chosen model and effort.
- Markdown in answers: headings, bold, italic, strike-through, inline code,
  code blocks with a copy button, lists, task lists, quotes, tables, rules
  and links. A link opens only with `http` or `https`. HTML shows as text.
  The replies and the live text of a task use the same view.
- Copy buttons on your messages, on answers and on task replies.
- The send button is a stop button while an answer comes. Stop keeps the
  text that came.
- "Make the answer again" on the last answer, also after an error.
- An answer shows its cost. An error shows its reason: budget, connection,
  too many messages, session ended, chat too long.
- A button to go to the latest message shows when you scroll up.
- New dependency `marked` 18.2.0 (JS only). Copy uses `Clipboard` of React
  Native core until the next native release.

### Changed (direct chat)

- New task on, or Reply on a task message, sends a message to the agent
  team as before. New task off no longer steers a running task.
- A direct chat is in memory only. New chat, sign-out and a restart of the
  app clear it.

### Added (Play phone screenshots)

- Four Google Play phone screenshots (1080 x 1920) in
  `play-store-assets/phone-screenshots/`: chat, tasks, budget, settings.
- `goldie/goldie.config.ts` and the argent flows `.argent/flows/store-0*.yaml`
  that capture and frame them. docs/release.md has the steps.

### Added (over-the-air updates)

- `expo-updates` with EAS Update on the channel `production` (ADR 0033). A
  JS-only change goes out with `npm run ota`. Updates reach only builds of
  the same version, from 1.6.0.
- `npm run ota` stops when the native fingerprint differs from
  `.github/last-release-fingerprint`. `npm run aab` writes this file.
- `PRIVACY.md` and the Data safety answers name `u.expo.dev`, the update
  client id and the error text of a failed start. `PRIVACY.md` no longer lists the conversation id as stored.

### Changed (composer and new conversation at start)

- The chat composer has two rows: the input on the full width, then the
  New task switch, the model chip and the send button. The placeholder
  stays on one line. The composer is a rounded box, not a pill.
- Each start of the app, and each sign-in, opens a new conversation. Tasks
  of the old chat stay in the Tasks list.

### Changed (model choice and Fama AI brand)

- Auto is gone from the model and effort lists. Choose a model from the
  list to send a new message. A reply to a task needs no model.
- A chosen model starts at its default effort. The app sends that effort.
- A rail of nodes and edges, low to high, replaces the effort chips.
- The model and effort sheet has a handle. Drag it down or tap it to close
  the sheet. A short drag springs back.
- The colours are the Fama AI tokens of `logo-master/SPEC.md` again. The
  mark shows in the side menu, on login, on the lock screen and in an
  empty chat. The splash colour needs a native release.

### Changed (new chat)

- The pencil in the chat header starts a new chat. It clears the thread and
  starts a new conversation. Tasks of the old chat stay in the Tasks list.

### Added (model and effort for a task)

- The chat composer is one pill-shaped row: the New task switch (a task
  icon in place of the text), the input ("Message Fama AI..."), the model
  chip and a round send button.
- The model chip opens a picker with a search field, the models that the
  API key can use (`GET /api/models`), and the reasoning efforts of the
  chosen model.
- A new message with no `taskId` sends `model` and `effort`. A reply to a
  task never sends them.
- The choice is kept in the settings. A model that is no longer in the
  list shows as Auto.
- The task screen shows the model and the effort of the task.
- When the model list does not load (503), the app reads it one more
  time after 2 s, and again when the picker opens.
- Contracts v0.5.0.

### Changed (calm chat look and side menu)

- New warm colours: a cream background in the light theme, a warm dark
  gray in the dark theme, and one terracotta accent for the main actions.
  All text pairs keep WCAG AA contrast (`npm run contrast`).
- The bottom tab bar is gone. A header with a menu button opens a side
  menu with Chat, Tasks, Budget, Settings and the recent tasks. In Urdu
  the menu comes from the right.
- Chat: agent replies show as plain text with no bubble, your messages
  show in a soft bubble at the end side. The composer is a rounded card
  with a multiline field, the New task switch and a round send button. A
  header action turns on New task.
- Quiet secondary buttons (outlined), cards with thin borders, list rows
  with thin dividers, and smaller muted metadata on all screens.

### Added (tasks, plans and owner controls, M3-08)

- The task screen (`/task/<taskId>`, from the task list and the chat):
  status, mode, cost, the plan as a DAG in steps, the subtask states,
  checkpoints, the live text of the running subtask and of the current
  orchestrator call, the subtask outputs, the timeline and the result.
- Plan preview in the chat with Approve plan, Edit plan and Reject plan.
  The plan editor changes the title, instructions, agent, dependencies,
  order and approval rule of each subtask, and adds or removes subtasks.
- Owner controls: pause, resume, cancel run, cancel task, retry subtask,
  change agent, auto-run switch, and approve or refuse a checkpoint. Each
  action has its own `Idempotency-Key`, and 409, 400 and 503 have their
  own texts.
- Reply to a task in the chat: the next message has the `taskId` of that
  task.
- Contracts v0.4.1.
- Push deferred (owner decision).

### Fixed (keyboard and permissions)

- On Android the keyboard covered the chat input and the Send button.
  With edge-to-edge, `adjustResize` does not make the window smaller.
  `Screen` now puts a `KeyboardAvoidingView` (`padding`) around each
  screen, so the content moves above the keyboard.
- `android.permission.USE_FINGERPRINT` is blocked. The app needs
  Android 10 or later (`minSdkVersion` 29). On these versions
  `expo-local-authentication` uses `androidx.biometric`
  (`BiometricPrompt`), which needs `USE_BIOMETRIC` only.
  `USE_FINGERPRINT` is deprecated since API level 28.

### Changed (app name Fama AI)

- The app name is `Fama AI` (launcher label, in-app text, lock screen
  title and unlock prompt in English, German and Urdu, privacy policy and
  release guide). The package `com.famashines.ai` does not change.

### Added (logo master)

- `logo-master/`: the mark geometry, the master SVGs, the construction
  drawing, the small-size proof and `SPEC.md` (rules, colours, clear
  space, minimum size and the asset table).
- `scripts/build-logo-assets.py` makes the app icons, the splash icons,
  the 512 px Play icon and the 1024 x 500 feature graphic from the
  masters, and checks them against `src/theme.ts` and `app.json`.
- The mark keeps its design. Its geometry is now exact (an equilateral
  triangle, R = 32 units) and it is placed on its optical centre.

### Added (first Google Play release)

- Version 1.0.0.
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
