# Phase 0 — `settings` table + write-on-login (SQLite, then IndexedDB)

Built. Single row per user, written once at login if it doesn't already exist, then mirrored into IndexedDB in the same flow. SQLite is the source of truth; the IndexedDB copy exists purely so `sw.js` can read it, since a service worker cannot open the app's OPFS/SAHPool SQLite connection at all (confirmed by direct testing — see `checklist.md`'s Context).

## `packages/primssg-db/src/schema.ts`

Added a `settings` table (`id TEXT PRIMARY KEY`, `settings TEXT NOT NULL`) after the existing `messages` table + index, inside `SCHEMA_SQL`. `id` is the user id directly (not `ownerId` — this table has exactly one row per account, unlike every other table which can hold many rows per owner). `settings` is JSON-as-text, not one column per setting, so a second setting later is a JSON-shape change, not a schema migration. No `migrate()` entry — `CREATE TABLE IF NOT EXISTS` covers a brand-new table, same as every prior addition in this file.

## `packages/primssg-db/src/types.ts`

Added `NotificationSoundMode = "always" | "unfocused" | "never"` and `Settings = { notificationSound: NotificationSoundMode }`. `Settings` is the parsed shape (`JSON.parse(row.settings)`), not the raw row.

## `packages/primssg-db/src/primssg-db.ts`

Added `abstract getOrCreateSettings(id: string): Promise<Settings>` and `abstract updateSettings(id: string, settings: Settings): Promise<void>` to the `PrimssgDB` abstract class, imported `Settings` alongside the existing type imports.

## `packages/primssg-db/src/worker.ts`

Added `DEFAULT_SETTINGS: Settings = { notificationSound: "unfocused" }` at module scope, and a `// settings` section on `PrimssgDBWasmEngine`:

- `getOrCreateSettings(id)` — plain `SELECT settings FROM settings WHERE id = ?` first; if a row exists, `JSON.parse`s and returns it. If not, inserts `DEFAULT_SETTINGS` and returns it. Two-step read-then-maybe-insert, not a `RETURNING`-based single statement — matches this file's existing style (`getOrCreateConversation` is the same shape).
- `updateSettings(id, settings)` — `INSERT ... ON CONFLICT(id) DO UPDATE SET settings = excluded.settings`, same overwrite pattern as `addContact`/`setLastMessage`.

## `packages/primssg-db/src/primssg-db-wasm.ts`

Added the matching `// settings` proxy methods (`getOrCreateSettings`/`updateSettings`), each a one-line `this.call(...)` passthrough, same shape as every other method group.

## `packages/primssg-db/src/index.ts`

Added `NotificationSoundMode, Settings` to the existing `export type { ... }` line.

## `client/lib/settings.ts` (new)

Thin connect-then-delegate wrapper around `useDbStore`, matching `client/lib/chats.ts`'s exact shape — `getOrCreateSettings(id)` and `updateSettings(id, settings)`, each awaiting `useDbStore.getState().connect()` first.

## `client/lib/settings-mirror.ts` (new)

The IndexedDB side, using `idb-keyval`'s `get`/`set` (already a dependency — `client/lib/session-store.ts` uses it for the session row). Two functions:

- `getSettingsFromIndexedDb(userId)` — reads `webrtc-settings-<userId>`, falls back to `{ notificationSound: "unfocused" }` if the key doesn't exist yet (mirrors the SQLite side's default).
- `mirrorSettingsToIndexedDb(userId, settings)` — plain overwrite.

Key is `webrtc-settings-${userId}`, deliberately separate from the `webrtc-session` key `session-store.ts` already uses, since this is a different piece of per-account data. `sw.js` (Phase 2) reads this same row directly via a raw `indexedDB.open("keyval-store")` call — it can't import `idb-keyval` since it's a static file, not part of the Next bundle.

## `client/app/page.tsx` — the login-time call site

In `handleSubmit`, right after `setUser(user)`: calls `getOrCreateSettings(user.id)` then `mirrorSettingsToIndexedDb(user.id, settings)`, before `router.push("/chat")`. Runs on every `loginOrRegister` call (fresh registration or a returning explicit login) — not on every app mount/reload, since a returning session with an already-persisted `user` redirects straight to `/chat` via the existing `useEffect`, skipping `handleSubmit` entirely. Idempotent either way (`getOrCreateSettings` only inserts if no row exists), so re-running it would be harmless, it just isn't needed on every reload.

## `client/components/dev-panel-sqlite-tab.tsx`

Added `"settings"` to the quick-query shortcut array (`["keys", "contacts", "conversations", "messages", "settings"]`).

## Verification

Typechecked clean: `bunx tsc --noEmit -p client/tsconfig.json` and a standalone check of every modified `packages/primssg-db/src/*.ts` file, both zero errors. No runtime/manual pass done yet (would need the dev stack up) — do the following before considering this phase done end-to-end:
1. Register a brand-new account, confirm via `/dev/sqlite` (now has a `"settings"` shortcut) exactly one row exists with `notificationSound: "unfocused"`.
2. Reload — confirm the row is untouched, not duplicated.
3. Confirm the IndexedDB mirror exists (devtools → Application → IndexedDB → `keyval-store` → `keyval` → `webrtc-settings-<userId>`) and matches the SQLite row.
4. Second account on the same browser — confirm independent rows/mirrors, no cross-account leakage.
