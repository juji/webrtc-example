## Context

`ChatPane` (`client/components/chat-pane.tsx`, built in plans/contacts Phase 8) is a UI-only mockup — `messages`/`connected` are passed in from `chat/page.tsx` as `[]`/`false`. `useWebRtcChat` (`client/lib/use-webrtc-chat.ts`) already has the real WebRTC/signaling/failover logic, proven out in `chat-old/[username]/page.tsx`. This plan is wiring the two together — no new messaging functionality, just connecting what already exists.

Found while starting this plan: `webrtc-keys` (`client/lib/keys.ts`), `webrtc-contacts` (`client/lib/contacts.ts`), and `webrtc-chats` (`client/lib/chats.ts`) all key their records on `username`, even though every user already has a real server-issued `id` (UUIDv7). Username was never meant to be the stable identity — the server's actual primary key is `id`. Fixed first, as its own phase, so `webrtc-convos` gets built on the corrected pattern from the start rather than needing a second migration later.

## Phase 0 — Migrate `webrtc-keys`/`webrtc-contacts`/`webrtc-chats` to id-keyed

- [x] **`/auth/challenge`** (`server/src/routes/auth.ts`): response now includes `userId` alongside `nonce` — it already looks up the user row to issue the challenge, so the client learns the id before it needs it for a key lookup
- [x] **`client/lib/keys.ts`**: `generateAndStoreKeys(username)` split into `generateKeys()` (pure keygen, no DB write) + `storeKeys(id, bundle)` — registration needs the public keys before the server round-trip, but can only store the bundle under the server-issued id after; `loadKeys(username)` → `loadKeys(id)`
- [x] **`client/lib/api.ts`**: `register()` generates keys, sends public halves, stores the full bundle under the returned `user.id`; `login()` calls `/auth/challenge` to get `userId` before `loadKeys(userId)`; `loginOrRegister()` calls `/auth/challenge` once and branches on 404 (register) vs found (login) — login path issues a second, redundant challenge call internally, accepted since challenges are cheap/short-TTL
- [x] **`client/lib/contacts.ts`** / **`client/lib/chats.ts`**: `ownerUsername` → `ownerId` throughout — types, IndexedDB keyPath/index, function signatures
- [x] **Five call sites updated**: `qr-code-popup.tsx`, `service-worker-registration.tsx`, `requests-popup.tsx`, `contacts-popup.tsx`, `chat/page.tsx`
- [x] No migration path for pre-existing browser-local IndexedDB data — old username-keyed records are orphaned under the new id-based lookups; accepted, no real user data existed yet
- [x] Verified: `client/` and `server/` typecheck clean; curl-verified `/auth/challenge` returns the correct `userId` for a real registered user
- [x] **Bug found and fixed, adjacent but not this migration:** a browser with notification permission already `"granted"` (from a prior account) never re-subscribed to push for a new account, since the enable banner/`enablePushForUser()` call only fires on `"default"` permission — surfaced as the new account never receiving push. Fixed in `client/app/chat/page.tsx`; full detail in `plans/contacts/checklist.md` Phase 5.

## Phase 1 — `webrtc-convos` schema

- [ ] Rows: `ownerId`, `sender: { id, username }`, `receiver: { id, username }`, `group` (empty for now), `message`, `datetime`

## Phase 2 — Wire `useWebRtcChat` into `ChatPane`

- [ ] TBD

## Phase 3 — Persist messages to `webrtc-convos`

- [ ] TBD

## Phase 4 — Retire `chat-old`

- [ ] TBD
