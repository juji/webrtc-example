## SUPERSEDED

Superseded by `plans/sqlite-migration` — Dexie (IndexedDB) can't offer 1:1 data-layer parity with a future Tauri desktop build, where SQLite is used natively instead. Decided to standardize on SQLite everywhere (Wasm+OPFS on web, native via Tauri) behind one shared interface, rather than a web-only IndexedDB layer that would need its own migration later. Nothing in this plan was implemented — no code changes to revert.

## Context

Every client-side IndexedDB store today (`client/lib/keys.ts`, `client/lib/contacts.ts`, `client/lib/chats.ts`) hand-rolls the same boilerplate: a promise-wrapped `openDb()`, manual `onupgradeneeded`, manual transaction/request promise-wrapping for every read/write. Migrating all three to Dexie, plus building `webrtc-convos` (`plans/convo` Phase 1, currently on hold) directly on Dexie instead of raw IndexedDB.

No size/perf motivation — this is purely to stop hand-rolling IndexedDB boilerplate for every new store.

**Future, not scoped here:** a Rust server + Postgres backing store to back up local IndexedDB data off-device. Sync would be handled by the existing service worker (`client/public/sw.js` — one worker at the app's origin, already registered for push per `plans/contacts` Phase 3/4; a backup-sync listener would be added to that same file, not a second worker — only one is allowed per scope), triggered by Dexie's `db.on('changes')` hook (or similar).

Periodic Background Sync (waking the service worker on a schedule with no tab open) is **not viable cross-browser** — Safari/WebKit has no support for it at all, on macOS or iOS, and has explicitly declined to implement it (not just unimplemented — a deliberate "won't do," per WebKit's own tracking bug). Chrome-only APIs can't be the trigger mechanism this depends on — whatever design gets built needs a fallback that works without them (e.g. sync on app foreground/open, or server-push-triggered sync rather than a browser-scheduled wake). Also see `plans/ios-install-prompt` — on iOS, service worker/push only runs at all for an installed PWA, a separate existing gap surfaced by this same research. Would need its own plan (server, sync protocol, conflict handling, cross-browser trigger strategy) once it's actually picked up — noted here only so this constraint isn't rediscovered later.

## Phase 0 — Add Dexie, convert `webrtc-keys`

- [ ] `dexie` added to `client/package.json`
- [ ] `client/lib/keys.ts` converted: `Dexie` subclass with a `keys` table (`id` as primary key, matching today's bare-key `keys` store), `generateKeys()`/`storeKeys()`/`loadKeys()` keep their current signatures, only the storage internals change

## Phase 1 — Convert `webrtc-contacts`

- [ ] `client/lib/contacts.ts` converted: `Dexie` subclass with a `contacts` table, compound primary key `[ownerId+id]`, `ownerId` index — same schema `contacts.ts` already has, just declared via Dexie's schema syntax instead of `onupgradeneeded`
- [ ] `addContact`/`listContacts`/`getContact`/`syncAcceptedContact` keep their current signatures

## Phase 2 — Convert `webrtc-chats`

- [ ] `client/lib/chats.ts` converted: `Dexie` subclass with a `chats` table, compound primary key `[ownerId+contactId]`, `ownerId` index
- [ ] `listConversations`/`getOrCreateConversation` keep their current signatures

## Phase 3 — Verify + resume `plans/convo`

- [ ] `client/` typecheck clean
- [ ] Manual verification: register/login (keys), QR-scan accept (contacts), open a chat (chats) all still work
- [ ] Remove the ON HOLD note from `plans/convo/checklist.md`, resume Phase 1 there (build `webrtc-convos` on Dexie directly, no raw IndexedDB)
