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
├── components/       ui.tsx (Screen, AppText, Button, StateView), lock-screen.tsx
├── i18n/             en.json, de.json, ur.json, t()
├── lib/              auth, lock, cache, config
├── state/            settings (language, theme), session (login, lock)
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
| `EXPO_PUBLIC_API_URL` | `https://ai.famashines.com` | gateway base URL (used from M1-11) |

The client id is `ai-systems-app`. The redirect URI is
`com.famashines.ai:/oauth2redirect`, a private-use scheme in reverse-domain
form (RFC 8252). The Keycloak client must have the same redirect URI. The
app scheme is `com.famashines.ai`. `EXPO_PUBLIC_*` values go into the
bundle. Do not put a secret in them.

The app accepts a discovery document only when its `issuer` is the
configured issuer and all endpoints use https. A development build also
accepts http on `localhost`, `127.0.0.1` and `10.0.2.2`, for a local test
issuer.

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
  ends the session; a network error keeps it. Sign out waits for a running
  token request, then deletes both tokens and revokes the newest refresh
  token.
- Lock: the app locks at start with a stored session, and after 5 minutes
  in the background (or when the clock moved back). Unlock is biometrics
  or the device PIN. The lock screen also has Sign out. If the screen-lock
  check fails, the app locks. A device with no screen lock is not locked,
  because it cannot unlock; Settings shows a warning.
- Language: follows the device (English, German or Urdu, else English),
  with an override in Settings. Urdu sets right to left and reloads the
  app once. That reload does not lock the app (a mark valid for 30
  seconds).
- Theme: follows the device, with an override in Settings.

## Known limits

- The Android recents screen can show a thumbnail of the last screen. The
  app does not set `FLAG_SECURE`. Reconsider in M9 hardening.
- The `EXPO_PUBLIC_*` values are not checked with zod yet. That comes in
  M1-11 with the contracts package.

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
