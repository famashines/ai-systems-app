# Privacy policy: Fama AI

Last change: 2026-11-08.

Fama AI (package `com.famashines.ai`) is the Android app of the
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
| Direct chats: your messages and the answers of the model, at most 50 chats | Local SQLite database `cache.db` | When you delete the chat in the menu, when it is older than the newest 50 chats, at sign-out, or when you remove the app or clear its data |
| Update client id: a random id that the app makes for this install | Android app storage (`dev.expo.EASSharedPreferences`) | When you remove the app or clear its data |
| App updates: the app code and images of the last update | Android app storage | When a newer update comes, when you remove the app, or when you clear its data |

The task thread, the conversation id and the budget are not kept on the
device. The app gets them from the server each time. Each start of the app
opens a new conversation. Direct chats are kept on the device only (table
above); the server does not store them.

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
- `u.expo.dev` and the Expo file servers: EAS Update by Expo, the update
  service of the app. At each start, the app asks for a new version of its
  code. The request has the platform (android), the app version, the update
  channel, the ids of the installed updates and of updates that failed, and
  the update client id. If the app could not start the last time, the
  request also has the error text of that start (at most 1024 characters),
  so that the service does not send a bad update again. The request has no
  account data and no chat text.

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
