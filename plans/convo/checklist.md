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

## Phase 1 — `webrtc-convos` IndexedDB store

detail: [phase-1-convos-schema.md](phase-1-convos-schema.md)
- [ ] **`webrtc-convos` IndexedDB store** (`client/lib/convos.ts`, new) + `ConvoMessage` type + `addMessage`/`listMessages`

## Phase 2 — `messages-store.ts` rebuild

detail: [phase-2-messages-store-rebuild.md](phase-2-messages-store-rebuild.md)
- [ ] **`messages-store.ts` rebuilt in place**: `clientId` → `messageId`, `file?` → `files: []`

## Phase 3 — `use-webrtc-chat.ts` callers

detail: [phase-3-use-webrtc-chat-callers.md](phase-3-use-webrtc-chat-callers.md)
- [ ] **`use-webrtc-chat.ts` callers updated** for the rename/pluralization

## Phase 4 — Attachment upload validation (extension allow/block-list)

detail: [phase-4-attachment-validation.md](phase-4-attachment-validation.md)
- [ ] **`ATTACHMENT_WHITELIST_EXTENSIONS`/`ATTACHMENT_BLACKLIST_EXTENSIONS` env vars**, whitelist overrides blacklist when set, default blacklist of known executable extensions
- [ ] **Server-side enforcement** in `POST /attachment/presign` — the real trust boundary
- [ ] **Client-side check** in `ChatPane`'s file picker — fail fast, not a security boundary

## Phase 5 — Attachment picker mockup

- [ ] TBD — wiring `ChatPane`'s decorative Paperclip button to an actual file picker

## Phase 6 — Audio/video recording + photo capture

- [ ] **`ATTACHMENT_AUDIO_RECORDING`/`ATTACHMENT_VIDEO_RECORDING`/`ATTACHMENT_PHOTO_CAPTURE` env vars** (boolean) gating recording/capture UI — `ATTACHMENT_PHOTO_CAPTURE` is a still photo taken via the device camera, distinct from `ATTACHMENT_VIDEO_RECORDING`
- [ ] TBD — no `MediaRecorder` usage exists anywhere in the client yet

## Phase 7 — Wire `useWebRtcChat` into `ChatPane`

- [ ] TBD

## Phase 8 — Persist messages to `webrtc-convos`

- [ ] TBD

## Phase 9 — Retire `chat-old`

- [ ] TBD
