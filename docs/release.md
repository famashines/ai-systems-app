# Release to Google Play

The app is `ai.famashines` in Google Play, package `com.famashines.ai`.
The Expo project is `@m-yahya/ai-systems`. Releases go to the internal
testing track (ADR 0012).

```
npm run aab ──> ai-systems-<version>.aab ──> Play Console (first release, by hand)
                                        └──> npm run submit:play (each later release)
```

## 1. What you need

- Node 22.13.0 (`nvm use`), then `npm ci`.
- The Android SDK on `ANDROID_HOME` and a JDK of 17 or later.
- `npx --yes eas-cli@23.0.0 login` as `m-yahya`.
- For a later release only: `.env` with `GOOGLE_APPLICATION_CREDENTIALS`
  (see section 4).

`npm run aab` runs a local EAS build of the `production` profile and writes
`ai-systems-<version>.aab` in the repository root (gitignored). The build
takes about 30 minutes. `<version>` is the `version` in `package.json`.
`app.json` has the same version; `scripts/bump-version.js` changes both.

EAS keeps the version code (`appVersionSource: remote`) and adds one for
each production build. EAS also keeps the upload keystore. The first EAS
build made it. Keep a copy in the password manager:
`npx --yes eas-cli@23.0.0 credentials --platform android`, then download
the keystore. The same keystore must sign every later build.

## 2. First release (manual upload)

The Play Publishing API cannot upload the first bundle of a new app. Do
these steps in Play Console one time.

1. On the tip of `main`, run `npm ci`, then `npm run aab`. This gives
   `ai-systems-1.0.0.aab`.
2. Create the app: **Home > Create app**. App name `ai.famashines`,
   default language English (United States), **App**, **Free**. Accept the
   declarations.
3. Testers: **Test and release > Testing > Internal testing > Testers**.
   Create an email list, add the tester Google accounts, save. Copy the
   opt-in link for the testers.
4. Release: on the same page select **Create new release**.
   - Accept Play App Signing (Google keeps the app signing key; the EAS
     keystore is the upload key).
   - Upload `ai-systems-1.0.0.aab`. The first upload registers the upload
     key.
   - Release name: `<versionCode> (1.0.0)`, the same format that
     `submit:play` uses. Add the release notes.
   - Select **Next**, correct each error that the console shows, then
     **Save and publish**.
5. Complete the app content forms (section 3). Play shows them in
   **Dashboard** and in **Policy and programs > App content**.
6. Give the service account access (section 4).
7. Send the opt-in link to the testers. They join, then install the app
   from Google Play.

## 3. App content forms

| Form | Answer |
| ---- | ------ |
| Privacy policy | `https://github.com/famashines/ai-systems-app/blob/main/PRIVACY.md` |
| App access | All or some functions are restricted. Add the login instructions: open the app, select **Sign in**, then enter the user name and the password of a test account in the Keycloak realm `ai-systems`. Make this test account first; it needs the `owner` role. Do not put the password in git. |
| Ads | No, the app has no ads. |
| Content rating | Fill in the IARC questionnaire. Category: all other app types (a utility or productivity app). No violence, sexual content, bad language, drugs or gambling. Users cannot talk to other users. The app shows text that an AI model makes. |
| Target audience | 18 and over only. The app is not for children. |
| News app | No. |
| Advertising ID | No. The app does not use the advertising ID. |
| Government app, financial features, health | No. |

### Data safety

The answers come from `PRIVACY.md`. Change both together.

| Question | Answer |
| -------- | ------ |
| Does the app collect or share user data? | Yes, it collects data. |
| Is all data encrypted in transit? | Yes (https and wss only). |
| How can users ask to delete data? | By email to famashines@gmail.com. |
| Accounts | The app does not create accounts. The owner makes them in Keycloak. |
| Personal info: User IDs | Collected, not shared. Required. Purpose: app functionality, account management. |
| Messages: Other in-app messages (the chat text) | Collected, not shared. Required. Purpose: app functionality. |
| All other data types | Not collected. |

The server sends the chat text to model providers through OpenRouter, as
service providers that make the reply for the app. Google Play does not
count a transfer to a service provider as sharing. The requests deny data
collection and ask for zero data retention (PRIVACY.md).

Before a closed testing or production track: the Google Play policy for
AI-generated content asks for a way in the app to report offensive AI
output. The app does not have it yet. The internal testing track does not
need it.

## 4. Service account for later uploads

Use the service account that Taseen uses:
`eas-play-submit-worta@worta-eas-submit.iam.gserviceaccount.com`.

1. In Play Console open **Users and permissions**, then **Invite new
   users**, and enter the service account email.
2. In **App permissions** add `ai.famashines`. Give **Release apps to
   testing tracks** and **View app information**.
3. Send the invitation. A service account does not need to accept it.
4. In this repository, make `.env` from `.env.example` and set
   `GOOGLE_APPLICATION_CREDENTIALS` to the path of the same JSON key that
   Taseen uses. Keep the key out of the repository. `.env` and
   `*service-account*.json` are gitignored.

| Variable | Default | Use |
| -------- | ------- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | none | path of the service-account JSON key |
| `GOOGLE_PLAY_TRACK` | `internal` | the Play track for `submit:play` and `bump-version.js` |
| `GOOGLE_PLAY_RELEASE_STATUS` | `completed` | `completed` or `draft` |

### A draft app

`submit:play` sends the release with the status `completed`. While the app
is a draft in Play Console (no release was published yet), Google Play
accepts only a `draft` release and answers: "Only releases with status
draft may be created on draft app." Taseen does not handle this, because
its first release was published by hand before the script ran.

If you see this error, set `GOOGLE_PLAY_RELEASE_STATUS=draft` in `.env`
and run `npm run submit:play` again. A new build is not necessary. Then
open the internal testing track in Play Console and roll out the draft
release. After the app is published, remove the variable.

## 5. Later releases

Do these steps on your own machine.

1. Update `main`: `git switch main && git pull --rebase origin main`.
2. Pick the bump from the conventional commit types since the last
   release: `major` for a breaking change, `minor` for a `feat`, `patch`
   for the other types. Then:
   ```
   node --env-file=.env scripts/bump-version.js <major|minor|patch>
   ```
   The script stops if the working tree is not clean or if `HEAD` is not
   the tip of `origin/main`. It changes `package.json`,
   `package-lock.json` and `app.json`. If the Play track already has this
   version or a newer one, it moves to the patch version after the Play
   version.
3. Build and upload:
   ```
   npm run release:android
   ```
   If the build is good but the upload fails, correct the cause and run
   `npm run submit:play`. A new build is not necessary.
4. After Google Play confirms the release, put the bump on a branch and
   open a pull request. Do not commit to `main`:
   ```
   git switch -c chore/release-<version>
   git add package.json package-lock.json app.json
   git commit -m "chore: release <version>"
   git push -u origin chore/release-<version>
   gh pr create --fill
   ```
   Do not commit a bump that did not reach Google Play.
