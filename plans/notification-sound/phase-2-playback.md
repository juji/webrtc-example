# Phase 2 — Wire the setting into actual sound/silence decisions

Built. Two independent paths, each reading the setting through whichever store it can actually reach.

## `client/lib/notification-sound.ts` (new) — foreground playback

Exports `NOTIFICATION_SOUND_FILES`, the fixed list of eight `.mp3` filenames under `client/public/` (all Pixabay tracks by Universfield, attribution required — surfaced in the settings popup, see Phase 1). `Settings.notificationSoundFile` (added to `packages/primssg-db/src/types.ts` alongside `notificationSound`) stores which one is selected; both `worker.ts`'s and `client/lib/settings-mirror.ts`'s `DEFAULT_SETTINGS` default it to the first file in that list.

`playSoundFile(file)`: plays the given file via one shared, module-scoped `HTMLAudioElement`, recreated only when `file` changes from the last-played one (`el.currentTime = 0` before each play, so an overlapping second notification restarts rather than getting dropped). `el.play()`'s rejection is caught and ignored — expected before any user interaction, per browser autoplay policy. Exported on its own (not just used internally) so the settings popup can call it directly for live preview when the user picks a sound.

`playNotificationSound(userId)`: reads `getOrCreateSettings(userId)` (SQLite, live — a tab is open, so the real `PrimssgDBWasm` connection is available, no need for the IndexedDB mirror here). Returns early on `"never"`, and on `"unfocused"` when `document.visibilityState === "visible"`. Otherwise calls `playSoundFile(notificationSoundFile)` with the user's selected file.

## `client/app/message-status-listener.tsx` wiring

Added `playNotificationSound(user.id)` in the `new-message` branch, right after the existing `ackMessage(row.id)` call. Not awaited/chained into the `incrementUnread().then()` — no ordering dependency, fires in parallel so a slow settings read doesn't delay the message rendering.

**Scope, unchanged from the original plan:** `use-webrtc-chat.ts`'s P2P receive path and `requests-popup.tsx`'s contact-request path aren't wired to play a sound — out of scope, same as before.

## `client/public/sw.js` changes

- `getLoggedInUsername()`'s body was extracted into a shared `getSessionUser()` (reads the full `user` object from the `webrtc-session` IndexedDB row, not just `.username`) — `getLoggedInUsername()` now just does `getSessionUser().then(user => user?.username ?? null)`. External behavior for the existing `pushsubscriptionchange` caller is unchanged.
- Added a shared `readKeyvalKey(key)` helper (single-key read against the `keyval-store`/`keyval` IndexedDB store) used by both:
  - `getNotificationSoundSetting()` — reads `webrtc-settings-<userId>`, returns `.notificationSound` or `null`.
  - `getFocusState()` — reads `webrtc-focus-<userId>` (see below), defaults to `true` (focused) when the user or key is missing, so an unknown state never wrongly silences a push.
- The `push` handler now awaits both and sets `silent: mode === "never" || (mode === "unfocused" && focused)`.

**`"unfocused"` is now resolved in the SW path too**, via a focus mirror the foreground page keeps current. `client/app/message-status-listener.tsx` tracks `document.visibilityState`/`document.hasFocus()` with `visibilitychange`/`focus`/`blur` listeners (mounted per-user, same effect scope as its existing signaling subscription) and writes the combined focused/not-focused boolean to IndexedDB via `mirrorFocusToIndexedDb` (`client/lib/settings-mirror.ts`, key `webrtc-focus-<userId>`) on every change and once on mount. The SW reads that same key. When a tab is genuinely focused, the SW push stays silent and the foreground path (`client/lib/notification-sound.ts`) independently decides whether to play — avoiding a double-trigger. When no tab is open or the tab is unfocused, the SW now silences exactly like `"never"` would.

## Verification

Typechecked clean (`bunx tsc --noEmit -p client/tsconfig.json`, zero errors across all modified/new files). `sw.js` isn't part of that typecheck (plain JS, not part of the Next bundle) — no syntax check run yet. No manual/runtime pass done yet — before considering this phase done end-to-end:
1. Foreground, `"always"`: message via server-fallback path, tab open — sound plays regardless of focus.
2. Foreground, `"unfocused"`: sound only when tab isn't focused.
3. Foreground, `"never"`: no sound either way.
4. SW path, `"never"`: tab closed, push arrives — OS notification is silent.
5. SW path, `"unfocused"`, tab closed or unfocused: OS notification is silent.
6. SW path, `"unfocused"`, tab open and focused: OS notification is silent (foreground path plays instead — confirm no double sound).
7. SW path, `"always"`, any tab state: OS plays its normal notification sound.
