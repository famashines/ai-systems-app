# Privacy policy: Fama AI

Last change: 2026-11-14.

Fama AI (package `com.famashines.ai`) is the Android app of the
famashines ai-systems service. You use it to chat with an AI model and to
see the cost. This policy tells you which
data the app keeps on your device, which data the server keeps, which
data the app sends, and where the data goes.

## Data on your device

| Data | Where | When it is deleted |
| ---- | ----- | ------------------ |
| Refresh token of your login | Android secure storage (`expo-secure-store`, encrypted with the Android Keystore) | At sign-out, or when the server ends the session |
| Access token of your login | App memory only | When the app stops, or at sign-out |
| Settings: language and theme | Local SQLite database `cache.db` | When you remove the app or clear its data |
| A copy of your chats: your messages, the answers of the model, the title and the bookmark, at most 50 chats | Local SQLite database `cache.db` | When you delete the chat in the menu, when it is older than the newest 50 chats, at sign-out, or when you remove the app or clear its data |
| Changes that wait for the server: the id of a deleted chat, or a new title or bookmark of a chat | Local SQLite database `cache.db` | When the server has the change. At sign-out the app keeps only the ids of deleted chats, so that the server deletes them too |
| Update client id: a random id that the app makes for this install | Android app storage (`dev.expo.EASSharedPreferences`) | When you remove the app or clear its data |
| App updates: the app code and images of the last update | Android app storage | When a newer update comes, when you remove the app, or when you clear its data |

The budget and the model list are not kept on the device. The app gets
them from the server each time. The copy of your chats on the device is
a cache. The chats are also kept on the server (next section).

## Data on the server

| Data | Where | When it is deleted |
| ---- | ----- | ------------------ |
| Your chats: your messages, the answers of the model, the title, the bookmark, the model and the cost of each answer, and the times | The MongoDB database of the ai-systems server (`ai.famashines.com`), with the id of your account | When you delete the chat in the app. There is no automatic expiry: a chat stays until you delete it |
| A deleted chat: its id, the id of your account and the time of the delete, with no text | The same database | It stays, so that a late save of the chat does not bring it back. It has no text of the chat |

- The server saves a chat after each answer. Chats that were on the
  device before this update go to the server only when you send the
  next message in them.
- A delete in the app deletes the chat and all its messages on the server
  at once. The database has no backup, so no copy stays. If the device is
  offline, the app sends the delete when it is online again.
- Sign-out deletes the copy on the device only. The chats stay on the
  server, and they come back after the next login.
- The server uses your chats only to show them to you in the app. It
  does not give them to third parties, and it does not use them to train
  models.

The app lock uses the Android biometric prompt or your device PIN. Android
does the check. The app gets only "unlocked" or "not unlocked". It does not
get or keep your fingerprint, face or PIN.

Android backup is off for this app (`allowBackup` is false), so the data
above does not go to a Google backup.

## Data that the app sends

The app connects only to these servers, and only with https:

- `auth.famashines.com`: the login (Keycloak, OpenID Connect with PKCE).
  Your account name and password go to this server, not to the app.
- `ai.famashines.com`: the ai-systems server. The app sends the chat (your
  messages and the answers before them, for the next answer), the model
  that you choose, a new title or bookmark of a chat, the deletes of
  chats, and your budget settings. The server sends back the answer of
  the model, your saved chats, the model list, and the cost.
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

- Delete a chat in the chat menu, or with a swipe in the side menu. This
  deletes it on the device and on the server.
- Sign out in Settings or on the lock screen. This deletes the tokens and
  the copy of the chats on the device. The chats stay on the server.
- Remove the app, or clear its data in Android Settings, to delete all
  data on the device.
- To delete all your chats on the server at one time, or for each other
  question, write to the contact below.

## Children

The app is not for children. It is for the owner of an ai-systems account.

## Changes

A change to this policy is a change to this file. The history is in the
git log of this repository.

## Contact

famashines, famashines@gmail.com.
