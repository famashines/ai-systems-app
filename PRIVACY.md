# Privacy policy: ai.famashines

Last change: 2026-11-01.

ai.famashines (package `com.famashines.ai`) is the Android app of the
famashines ai-systems service. You use it to send tasks to your own AI
agents, follow the tasks, and see the cost. This policy tells you which
data the app keeps on your device, which data it sends, and where the data
goes.

## Data on your device

| Data | Where | When it is deleted |
| ---- | ----- | ------------------ |
| Refresh token of your login | Android secure storage (`expo-secure-store`, encrypted with the Android Keystore) | At sign-out, or when the server ends the session |
| Access token of your login | App memory only | When the app stops, or at sign-out |
| Settings: language and theme | Local SQLite database `cache.db` | When you remove the app or clear its data |
| Recent task list: task id, title, status and times, at most 200 tasks | Local SQLite database `cache.db` | At sign-out |
| Conversation id: a random id that the app makes for this device | Local SQLite database `cache.db` | When you remove the app or clear its data |

The chat thread and the budget are not kept on the device. The app gets
them from the server each time.

The app lock uses the Android biometric prompt or your device PIN. Android
does the check. The app gets only "unlocked" or "not unlocked". It does not
get or keep your fingerprint, face or PIN.

Android backup is off for this app (`allowBackup` is false), so the data
above does not go to a Google backup.

## Data that the app sends

The app connects only to these servers, and only with https and wss:

- `auth.famashines.com`: the login (Keycloak, OpenID Connect with PKCE).
  Your account name and password go to this server, not to the app.
- `ai.famashines.com`: the ai-systems server. The app sends the chat text
  that you write, your task commands, and your budget settings. The server
  sends back the tasks, the replies of the agents, and the cost.

The server sends the chat text to large language models through
OpenRouter, to make the agent replies. The requests deny data collection by
the model providers and ask for zero data retention. Only providers that
agree to these rules get the text.

## What the app does not do

- No ads.
- No analytics and no tracking. The app has no analytics or crash
  reporting SDK.
- No sale of data, and no sharing of data with third parties for their own
  use.
- No location, contacts, camera, microphone or file access.

## Your choices

- Sign out in Settings or on the lock screen. This deletes the tokens and
  the recent task list on the device.
- Remove the app, or clear its data in Android Settings, to delete all
  data on the device.
- To delete the data on the server, or for each other question, write to
  the contact below.

## Children

The app is not for children. It is for the owner of an ai-systems account.

## Changes

A change to this policy is a change to this file. The history is in the
git log of this repository.

## Contact

famashines, famashines@gmail.com.
