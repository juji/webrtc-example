# Notification sound setting

## Context

Per-user setting, three states: always play a sound on an incoming notification, only play when the tab isn't focused, or never play. Decided in `plans/notifications/discussion.md`'s "Notification sound setting" section, then narrowed further: a service worker reading local SQLite directly was investigated and confirmed **not viable** — `ServiceWorkerGlobalScope` has neither OPFS's `createSyncAccessHandle` nor a `Worker` constructor to delegate to, confirmed by direct testing against a live SW. So `sw.js`'s `push` handler cannot read `primssg-db`'s `settings` table directly, ever, under this app's current OPFS/SAHPool-based storage.

**Storage shape, as built:** SQLite (`packages/primssg-db`'s `settings` table) is the source of truth, written once at login if no row exists yet, default `notificationSound: "unfocused"` and `notificationSoundFile` defaulting to the first of eight bundled Pixabay sound files (see Phase 2). An IndexedDB mirror (`client/lib/settings-mirror.ts`) is written right after, so `sw.js` — which can read IndexedDB but not SQLite — has something to check. **The settings popup UI reads from the IndexedDB mirror and writes to SQLite** (then re-mirrors), not the other way around.

All three phases are implemented.

## Phase 0 — `settings` table + write-on-login (SQLite, then IndexedDB)

detail: [phase-0-settings-storage.md](phase-0-settings-storage.md)

- [x] **`settings` table in `primssg-db`, written once at login if no row exists yet, mirrored into IndexedDB right after**
  - `packages/primssg-db/src/schema.ts`, `types.ts`, `primssg-db.ts`, `worker.ts`, `primssg-db-wasm.ts`, `index.ts` — the usual three-part table addition, plus a `getOrCreateSettings`/`updateSettings` pair. New `client/lib/settings.ts` (SQLite wrapper) and `client/lib/settings-mirror.ts` (IndexedDB read/write). Wired into `client/app/page.tsx`'s `handleSubmit`, right after `setUser(user)`.

## Phase 1 — Settings popup UI

detail: [phase-1-settings-popup.md](phase-1-settings-popup.md)

- [x] **`SettingsPopup` component with the 3-way choice + sound-file picker, "Settings" entry added to the chat-page menu**
  - New `client/components/settings-popup.tsx`. Reads the current value from the IndexedDB mirror on open; writes SQLite then re-mirrors to IndexedDB on every selection. A second section lets the user pick and preview one of eight bundled sound files, with required Pixabay/Universfield attribution. Wired into `client/app/chat/page.tsx`'s menu dropdown and popup render list.

## Phase 2 — Wire the setting into actual sound/silence decisions

detail: [phase-2-playback.md](phase-2-playback.md)

- [x] **Foreground `<audio>` playback on incoming messages, `Notification.silent` in `sw.js`'s `push` handler**
  - New `client/lib/notification-sound.ts`, exporting `NOTIFICATION_SOUND_FILES` (eight bundled Pixabay tracks) and `playSoundFile`/`playNotificationSound`, called from `client/app/message-status-listener.tsx`'s `new-message` branch — reads SQLite live, checks `document.visibilityState`, plays the user's selected file. `client/app/message-status-listener.tsx` also mirrors live focus state into IndexedDB (`webrtc-focus-<userId>`) on `visibilitychange`/`focus`/`blur`. `client/public/sw.js`'s `push` handler reads both the settings and focus mirrors and sets `silent: true` for `"never"`, and for `"unfocused"` whenever the mirror says a tab is currently focused (see Phase 2 doc).
