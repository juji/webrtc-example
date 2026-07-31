## Context

`ChatPane` (`client/components/chat-pane.tsx`, built in plans/contacts Phase 8) is a UI-only mockup — `messages`/`connected` are passed in from `chat/page.tsx` as `[]`/`false`. `useWebRtcChat` (`client/lib/use-webrtc-chat.ts`) already has the real WebRTC/signaling/failover logic, proven out in `chat-old/[username]/page.tsx`. This plan is wiring the two together — no new messaging functionality, just connecting what already exists.

Found while starting this plan: `webrtc-keys` (`client/lib/keys.ts`), `webrtc-contacts` (`client/lib/contacts.ts`), and `webrtc-chats` (`client/lib/chats.ts`) all key their records on `username`, even though every user already has a real server-issued `id` (UUIDv7). Username was never meant to be the stable identity — the server's actual primary key is `id`. Fixed first, as its own phase, so `webrtc-convos` gets built on the corrected pattern from the start rather than needing a second migration later.

## Phase 0 — Migrate `webrtc-keys`/`webrtc-contacts`/`webrtc-chats` to id-keyed

- [ ] TBD

## Phase 1 — `webrtc-convos` schema

- [ ] Rows: `ownerId`, `sender: { id, username }`, `receiver: { id, username }`, `group` (empty for now), `message`, `datetime`

## Phase 2 — Wire `useWebRtcChat` into `ChatPane`

- [ ] TBD

## Phase 3 — Persist messages to `webrtc-convos`

- [ ] TBD

## Phase 4 — Retire `chat-old`

- [ ] TBD
