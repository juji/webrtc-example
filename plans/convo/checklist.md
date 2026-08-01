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

## Phase 1 — `webrtc-convos` messages table

detail: [phase-1-convos-schema.md](phase-1-convos-schema.md)
- [x] **`messages` table on `PrimssgDB`** (`packages/primssg-db`) + `ConvoMessage` type + `addMessage`/`listMessages`, plus `client/lib/convos.ts` (new) wrapping them via `useDbStore` — built and verified as `plans/sqlite-migration` Phase 5; full detail there

## Phase 2 — `messages-store.ts` rebuild

detail: [phase-2-messages-store-rebuild.md](phase-2-messages-store-rebuild.md)
- [x] **`messages-store.ts` rebuilt in place**: `clientId` → `messageId`, `file?` → `files: []`

## Phase 3 — `use-webrtc-chat.ts` callers

detail: [phase-3-use-webrtc-chat-callers.md](phase-3-use-webrtc-chat-callers.md)
- [x] **`use-webrtc-chat.ts` callers updated** for the rename/pluralization — `messageId` generated via `uuidv7()` (new `client/` dependency) instead of `crypto.randomUUID()`; `sendFile` wraps into `files: [file]`; `DataChannelMessage` protocol frames renamed too (this app's own wire format, not server-facing); `MessageRow.clientId`/`MessageStatusPush.clientId` (server-facing fields) left unchanged. `message-status-listener.tsx` and `chat-old/[username]/page.tsx` (kept as reference, not yet retired — Phase 9) updated to match since both are real consumers of the renamed `ChatMessage` type. `client/` typechecks clean.

## Phase 4 — Attachment upload validation (extension allow/block-list)

detail: [phase-4-attachment-validation.md](phase-4-attachment-validation.md)
- [x] **`ATTACHMENT_WHITELIST_EXTENSIONS`/`ATTACHMENT_BLACKLIST_EXTENSIONS` env vars**, whitelist overrides blacklist when set, default blacklist of known executable extensions
- [x] **Server-side enforcement** in `POST /attachment/presign` (`server/src/routes/messages.ts`) — `isExtensionAllowed()` checked before the user-existence lookup; verified against the real running server (blacklisted `.exe`/`.EXE` rejected with 400, non-blacklisted `.png` passes through to the next check, matching case-insensitively)
- [x] **Client-side check** in `ChatPane`'s file picker — built as part of Phase 5, see there

## Phase 5 — Attachment picker mockup

- [x] **`ChatPane`'s Paperclip button wired to a real file picker**: hidden `<input type="file">` + click trigger, matching `qr-code-popup.tsx`'s existing pattern. Selecting a file runs `isExtensionAllowed()` (new `client/lib/attachment-validation.ts`, mirrors the server's `isExtensionAllowed` in `server/src/routes/messages.ts` using `NEXT_PUBLIC_ATTACHMENT_WHITELIST_EXTENSIONS`/`NEXT_PUBLIC_ATTACHMENT_BLACKLIST_EXTENSIONS`) — rejected files show an error message, allowed files show a removable attachment-preview chip above the input row. Send button now enables on a selected file alone, not just text. Still no `useWebRtcChat` wiring (Phase 7) — selecting a file only sets local UI state, nothing is sent yet. Verified end-to-end in a real browser: attach button opens the file chooser, a blacklisted `.exe` is rejected with the error shown, an allowed `.png` is accepted and rendered as a preview chip, send button enables with file-only.
- [x] **Phase 4's client-side check unblocked** — was pending on this picker existing; done now (`plans/convo/checklist.md` Phase 4 updated separately)

## Phase 6 — Audio/video recording + photo capture

- [x] **`NEXT_PUBLIC_ATTACHMENT_AUDIO_RECORDING`/`NEXT_PUBLIC_ATTACHMENT_VIDEO_RECORDING`/`NEXT_PUBLIC_ATTACHMENT_PHOTO_CAPTURE` env vars** (boolean, client-visible per Phase 4's `NEXT_PUBLIC_` convention) gating each capture option in the attach menu — `ATTACHMENT_PHOTO_CAPTURE` is a still photo taken via the device camera, distinct from `ATTACHMENT_VIDEO_RECORDING`
- [x] **`ChatPane`'s Paperclip button rebuilt as a menu trigger**, not a direct file-picker trigger — opens a small dropdown menu (Upload file / Record audio / Record video / Take photo, capture options only shown when their env var is truthy) anchored above the button, closes on outside click
- [x] **`client/components/capture-popup.tsx`** (new): a `Popup`-based (matching `qr-code-popup.tsx`'s modal style, per explicit instruction — not inline in `ChatPane`) recorder handling all three modes. `getUserMedia` opens the camera/mic the instant a mode is picked, torn down the instant the popup closes. Audio/video use `MediaRecorder` (Start Recording/Stop); photo draws the live `<video>` frame to a `<canvas>` and calls `toBlob`. Once captured: Retake (discards, re-opens the live preview) or Use (wraps the `Blob` into a `File` named `${mode}-${timestamp}.${ext}`, calls back into `ChatPane`). No `useWebRtcChat` wiring — captured files feed into the same `selectedFile` attachment-preview state Phase 5 built, nothing is sent yet (Phase 7).
- [x] **Verified end-to-end** in a real browser via Playwright with `--use-fake-device-for-media-stream`: attach menu shows all three capture options (env vars active), photo capture produces a real captured frame with working retake/use controls, audio recording produces a real `MediaRecorder` output — both end up as attachment preview chips identical to Phase 5's file-upload chip.

## Phase 7 — Wire `useWebRtcChat` into `ChatPane`

- [x] **`ChatMessage` (`client/lib/messages-store.ts`) gained a `createdAt: string` field** — `ChatPane`'s date-separator UI needs it and the real in-memory store never had it. Set at every `addMessage` call site: `new Date().toISOString()` for real-time sends/receives, `row.createdAt` (the real server timestamp) for the catch-up-fetch and push-delivered paths in `use-webrtc-chat.ts` and `message-status-listener.tsx`.
- [x] **`ChatPaneMessage` (the decoupled mock type) retired entirely** — `ChatPane` now imports and renders the real `ChatMessage` directly (`files[0]` instead of the old singular `file?`, `messageId` instead of `clientId`), one type end to end instead of two parallel ones.
- [x] **`ChatPane` calls `useWebRtcChat` itself**, matching how `chat-old` calls the hook right where it's rendered — takes `selfId`/`selfUsername`/`peerId`/`username` as props instead of `messages`/`connected`. `chat/page.tsx`'s `selected` state changed from a bare username string to `{ id, username }` (Phase 8 needed the peer's real id for persistence — both places that set `selected` already had the full `Contact`/joined-conversation object, so this was just carrying one more field through) and now passes all four to `ChatPane` instead of the old `messages={[]} connected={false}` placeholders.
- [x] **`handleSubmit` wired to the real `sendMessage`/`sendFile`** — sends text and/or the selected attachment (both independently, since either can be present alone), then clears the draft/attachment/textarea height exactly as before.
- [x] **Verified end-to-end** with two real registered users in separate browser contexts, seeded as mutual contacts via `query.mjs`'s `debugQuery`, both opening the same conversation through the real `ChatPane`: real WebRTC connection established (`Connected` shown in both panes), a message sent from one pane arrived in the other's real message list through the actual data channel — not mocked, not simulated.

## Phase 8 — Persist messages to `webrtc-convos`

- [x] **`useWebRtcChat` gained `selfId`/`peerId` parameters** (signature now `useWebRtcChat(selfId, selfUsername, peerId, peerUsername)`) — persisting a `ConvoMessage` needs real user ids (`ownerId`/`threadId`/`sender.id`), not just usernames. `chat-old/[username]/page.tsx` updated to the new signature too (kept compiling as reference — no real peer id available from its route param, so its own persistence isn't accurate, but it's not a routed/live page).
- [x] **Write-through persistence**: `addAndPersist`/`updateStatusAndPersist` wrap the existing `messages-store.ts` `addMessage`/`updateStatus` actions — every call site in `use-webrtc-chat.ts` (catch-up fetch, P2P data-channel receive, ack/read handling, `sendMessage`/`sendFile`) now also upserts the matching `ConvoMessage` row via `client/lib/convos.ts`'s `addMessage`. `messages-store.ts` stays the live/render source of truth; `webrtc-convos` is the durable mirror, not a replacement.
- [x] **`sentAt`/`deliveredAt` derived from `status`** at persist time (`"sent"`/`"read"` → current timestamp, otherwise `null`) — matches Phase 1's schema intent, not just copying `createdAt` into every field.
- [x] **Load-on-mount effect** added: `listMessages(selfId, peerId)` seeds `messages-store.ts` with prior history from `webrtc-convos` on every mount, skipping any `messageId` already in memory (so a fast remount within the same session doesn't duplicate rows) — this is what makes chat history survive a reload, since `messages-store.ts` itself is in-memory-only and starts empty every time.
- [x] **Verified end-to-end**: two real registered users exchanged a real P2P message through `ChatPane`, delivered live; then a hard page reload on the sender's side re-opened the same conversation and the message was still there — proving it came from `webrtc-convos`/SQLite, not surviving in memory.

## Phase 9 — Retire `chat-old`

- [x] **`client/app/chat-old/` deleted** — no real source file imported from it (confirmed via grep before deleting), only stale generated `.next` build artifacts referenced the route, which were cleared along with it. `client/` typechecks clean with it gone.
- [x] **`plans/encryption-at-rest/checklist.md`'s stale open item updated** — it had an unchecked "chat-old not yet deleted" bullet (a live claim, not historical narration) left over from when `chat-old` was first created as reference; marked done and pointed at where each part was actually resolved (`plans/contacts` for real conversation data/chat pane, this deletion for `chat-old` itself).
