## Context

Chat currently only works while both peers have an active WebRTC data channel open — if the peer isn't connected, `sendMessage`/`sendFile` silently no-op and nothing is stored anywhere. There is no message history, no delivery guarantee, and no way to tell whether a message actually reached the peer.

Fix: messages get 4 statuses — `sending`, `in-transit`, `sent`, `read` — applying to both text and file attachments.

Decided:
- **WebRTC P2P is the primary transport.** The server is a failover only, used when the data channel isn't open at send time (or the P2P send fails) — not a mandatory hop for every message.
- **The 4 statuses describe the recipient's relationship to the message — never the sender's own mechanics (which transport is being tried, whether P2P or failover is in progress).** How delivery actually happens is an implementation detail; the status is purely "where does this message stand with the other person."
  - `sending` = the recipient does not have this message yet, and no attempt to get it to them has been dispatched from this device at all.
  - `in-transit` = a delivery attempt has been dispatched, but the recipient does not have it yet — whether that attempt is currently riding the data channel or sitting in the server's failover store makes no difference to this status.
  - `sent` = the recipient's device now has the message. Confirmed by a P2P ack over the data channel, or by the recipient's client actually receiving/fetching it from the server (which also deletes the server's copy, see below).
  - `read` = the recipient opened that chat thread and viewed the message. Best-effort — echoed back over the data channel if still connected — but still purely about the recipient's state, not the sender's.
- **The server row is deleted only once BOTH sides are confirmed caught up — not the moment the recipient acks it.** This is a two-step ack, not one: (1) the recipient's client acks receipt (`recipientAckedAt` set — see phase-1-schema.md), which does *not* delete the row, because the sender hasn't been told yet; (2) the server then tries to notify the sender (push if online, else the sender's own client picks it up on its next check-in — same mailbox pattern as step 1), and only once the *sender* acks-in-turn is the row actually deleted. This guarantees the sender can always learn what happened to a message they sent, even if they closed the app the instant they hit send and reopened it a day later — the outcome is reconstructed from durable server state on that next check-in, not dependent on having stayed present for a live event.
- No message is ever silently dropped: if P2P fails and the peer is offline, the row sits in the server's store (still un-acked by the recipient) until they reconnect and pick it up. After that, it sits again (recipient-acked, sender-not-yet-told) until the sender checks in and completes the loop.
- **Failover file/image attachments are stored in RustFS** (S3-compatible object storage, run via Docker), not on the Hono server's disk.
- **Attachment upload is direct-from-browser to RustFS** (presigned PUT) — the client asks the Hono server for a presigned URL, then PUTs the file bytes straight to RustFS. The file's bytes never pass through the Hono server. This was verified working end-to-end against a running RustFS container (presigned PUT + CORS for both `http://localhost:3000` and `https://webrtc-client.jujitest.com`) before being written into this plan — see phase-0-rustfs-infra.md for the verified config.
- RustFS's presigned **POST** (the typical form-upload-with-policy-restrictions mechanism) has a known open bug (`MalformedPOSTRequest`) as of the version in use — presigned **PUT** is used instead (simpler mechanism, verified working).
- **The signaling WebSocket lives in a Zustand store (`client/lib/signaling-store.ts`), not inside the per-chat-page hook.** Next.js App Router unmounts route components on navigation — a WebSocket opened inside `/chat/[username]`'s effect would close every time the user navigated to `/users`, silently dropping any `message-acked`/`new-message` push meant for them. This was found, fixed, and verified (via real client-side-navigation Playwright tests, not full page reloads) before the rest of this plan was written — see phase-0b-signaling-store.md. All later phases' WebSocket-push handling assumes this store, not a per-page connection.

## Phase 0 — Infra: RustFS in docker-compose

detail: [phase-0-rustfs-infra.md](phase-0-rustfs-infra.md)
- [x] **Add `rustfs` service to `docker-compose.yml`** — S3-compatible object storage for failover attachments
- [x] **Configure CORS** for direct browser uploads (`RUSTFS_CORS_ALLOWED_ORIGINS`)

## Phase 0b — Client: signaling WebSocket in a Zustand store

detail: [phase-0b-signaling-store.md](phase-0b-signaling-store.md)
- [x] **`client/lib/signaling-store.ts`** — one signaling WebSocket per session (not per chat page), with a send queue (messages sent before the socket finishes opening) and a recent-message replay buffer (a subscriber that registers slightly late shouldn't silently miss a message)
- [x] **`client/app/signaling-connection.tsx`**, mounted in `layout.tsx` — opens the connection on login, closes it on logout; independent of which page is active
- [x] **`use-webrtc-chat.ts` updated** to route signaling through the store instead of owning its own WebSocket, and to filter incoming messages by `message.from === peerUsername` (a real, separate bug that only became visible once one shared connection started carrying signaling traffic for whatever peer happens to be relevant)
- [x] Verified: WebSocket survives real client-side navigation (`router.push`/`goBack`, not full reloads) away from and back to a chat page; full register→search→chat→attachment e2e flow still passes

## Phase 1 — Server: messages table

detail: [phase-1-schema.md](phase-1-schema.md)
- [ ] **Add `messages` table via Drizzle**, including `recipientAckedAt` (nullable) — durable failover store, not the primary path

## Phase 2 — Server: failover API + delivery push

detail: [phase-2-api.md](phase-2-api.md)
- [ ] **`POST /messages`** — store a text message as failover when P2P couldn't deliver it live
- [ ] **`GET /messages?peer=&self=`** — recipient's one-shot catch-up fetch on chat-page mount: rows still unacked by them (`recipientAckedAt IS NULL`)
- [ ] **`POST /messages/:id/ack`** — recipient's ack: sets `recipientAckedAt`, does NOT delete; triggers a push attempt to notify the sender
- [ ] **`DELETE /messages/:id`** — sender's final ack, only after they've learned the recipient has it; this is the only deletion trigger
- [ ] **Push both directions over the existing signaling WebSocket, with queue-and-flush for whoever's offline**: `new-message` to the recipient on create, `message-acked` to the sender once the recipient acks. `notifyUser` reuses `signaling.ts`'s existing `pending` queue/`onOpen` flush (already used for WebRTC offers) so a target who's offline right now still gets it the instant they reconnect — no polling anywhere in the app

## Phase 3 — Server + client: direct-to-RustFS attachment upload

detail: [phase-3-attachment-upload.md](phase-3-attachment-upload.md)
- [ ] **`ensureAttachmentsBucket()` in `server/src/index.ts`** — creates the `attachments` bucket (idempotent) and applies a public-read policy on server startup, so `fileUrl` is fetchable without a manual console step
- [ ] **`POST /messages/attachment/presign`** — server generates a presigned PUT URL + a `messages` row (file metadata only, no bytes) for the failover attachment case
- [ ] **Client PUTs the file directly to the presigned URL** — bytes never touch the Hono server
- [ ] **Client confirms the upload** so the recipient's `GET`/WS-push picks up a row whose file actually exists in RustFS

## Phase 4 — Client: status-aware send pipeline

detail: [phase-4-send.md](phase-4-send.md)
- [ ] **New `client/lib/messages-store.ts`** — `ChatMessage[]` + pending-sent-row tracking move out of `useWebRtcChat`'s local `useState`/`useRef` into a Zustand store keyed by peer username, so Phase 5's root-level listener can update a conversation's messages even when that conversation's chat page isn't mounted (same reasoning as Phase 0b moving the WebSocket itself)
- [ ] **Rewrite `sendMessage`/`sendFile`** to try the P2P data channel first, fall back to the server (Phase 2/3) if not connected or the send fails
- [ ] **Ack-timeout fallback**: `dc.readyState === "open"` doesn't guarantee the recipient actually received the send — if no P2P `ack` (Phase 5) arrives within `ACK_TIMEOUT_MS`, fall back to the same server path used when the channel wasn't open, so a stale-but-open channel can't strand a message at `in-transit` forever with no server row
- [ ] **Track per-message status** (`sending` → `in-transit` → `sent` → `read`) keyed by a client-generated id, independent of which path delivered it

## Phase 5 — Client: receive, ack, and read tracking

detail: [phase-5-receive.md](phase-5-receive.md)
- [ ] **New `client/app/message-status-listener.tsx`**, mounted in `layout.tsx` alongside `SignalingConnection` — a root-level (not per-chat-page) subscriber that handles `new-message`/`message-acked` against `messages-store.ts`, regardless of which conversation (if any) is currently open
- [ ] **On P2P receipt, send an ack back immediately** over the data channel so the sender flips to `sent` — fully resolved in one round trip, no server involved
- [ ] **On receiving that ack, clear the sender's pending ack-timeout** (Phase 4) — otherwise a real ack that arrives just under the timeout still lets the delayed server-fallback fire afterward, creating a redundant row
- [ ] **On receiving a failover message** (WS push or `GET` on chat open), `POST /messages/:id/ack` — recipient's ack, does NOT delete the row
- [ ] **On receiving `message-acked`** (live push, or flushed from the queue the instant the sender's WebSocket reconnects — never a poll), flip local status to `sent` and `DELETE /messages/:id` — the sender's ack, which finally deletes the row. Works identically whether the sender was live when the recipient acked, or was offline and only reconnects later — the server holds the notice until then.
- [ ] **On opening/viewing a thread, mark unread messages `read` locally** and echo a `read` data-channel message to the sender if still connected (best-effort, no server involvement)

## Phase 6 — Client: status UI + attachment parity

detail: [phase-6-ui.md](phase-6-ui.md)
- [ ] **Render per-message status** (sending/in-transit/sent/read) on both text and file message bubbles
- [ ] **Wire `sendFile` through the same status pipeline** as text messages
