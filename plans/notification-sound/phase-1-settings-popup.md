# Phase 1 — Settings popup UI

Built. `SettingsPopup`, opened from a new "Settings" entry in `client/app/chat/page.tsx`'s menu dropdown. Follows the same shape as `RequestsPopup`/`ContactsPopup`/`QrCodePopup`.

## `client/components/settings-popup.tsx` (new)

`SettingsPopup({ open, onClose, user })`. On open, reads the current value via `getSettingsFromIndexedDb(user.id)` (`client/lib/settings-mirror.ts`) — **the popup reads from the IndexedDB mirror, not SQLite**, a deliberate choice (see Context below). On selecting an option, calls `updateSettings(user.id, settings)` (`client/lib/settings.ts`, writes SQLite) then `mirrorSettingsToIndexedDb(user.id, settings)` (re-syncs the mirror) — both writes happen on every change, saves immediately, no separate "Save" step (matches `RequestsPopup`'s immediate-effect pattern). Renders three mode options (`always`/`unfocused`/`never`) as a radio-style list inside the existing `Popup` component, `buttons={[]}` since there's nothing to confirm/cancel.

A second section below the mode list lets the user pick which sound file plays: a numbered grid of buttons, one per entry in `NOTIFICATION_SOUND_FILES` (`client/lib/notification-sound.ts`). Selecting one calls `playSoundFile(file)` immediately (live preview) and persists the choice the same way mode changes do — `updateSettings` then `mirrorSettingsToIndexedDb`, both writing the full `Settings` object (`notificationSound` + `notificationSoundFile`) since SQLite/IndexedDB hold one JSON blob per user, not per-field rows. Below the grid, a required Pixabay attribution line (the eight `.mp3` files under `client/public/` are all by the same uploader, Universfield) links to the uploader and to Pixabay.

## `client/app/chat/page.tsx` wiring

- Added `Settings` to the `lucide-react` import.
- Added `showSettings` state alongside `showContacts`.
- Added a "Settings" menu entry between "Contacts" and "Log out" in the dropdown.
- Rendered `<SettingsPopup open={showSettings} onClose={() => setShowSettings(false)} user={user} />` alongside the other popups.

## Why the popup reads IndexedDB instead of SQLite

Both are always in sync in the normal case (every SQLite write is immediately followed by an IndexedDB mirror write, both here and at login in Phase 0) — the choice was about which store to read from, not correctness of either. Reading the mirror avoids requiring the popup's open to itself depend on the `PrimssgDBWasm` connection resolving before it can render a value; in practice every other popup in this app already assumes that connection exists, so this is a stylistic choice, not a hard technical requirement.

## Verification

Typechecked clean (`bunx tsc --noEmit -p client/tsconfig.json`, zero errors, including this file). No manual pass done yet — before considering this phase done end-to-end:
1. Open Settings from the menu, confirm it loads the current mode (default `"unfocused"` from Phase 0's login-time write).
2. Select each option, close/reopen — confirm it persisted (both the IndexedDB mirror the popup reads from, and the underlying SQLite row).
3. Confirm the IndexedDB row updates immediately on selection, not just at next login.
4. Second account — confirm settings are independent.
