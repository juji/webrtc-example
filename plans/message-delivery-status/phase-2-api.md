# Phase 2 — Server: failover API + delivery push

## New file: `server/src/routes/messages.ts`

Follows the exact pattern of `server/src/routes/auth.ts` and `server/src/routes/users.ts` (plain Hono sub-router, mounted in `server/src/index.ts` via `app.route('/messages', messagesRoute)`).

The Drizzle table export `messages` (from `../db/schema`) must be imported under an alias — `messagesTable` — to avoid colliding with the Hono router variable, which is itself named `messagesRoute` (not `messages`). Without this, `messages.post(...)` is ambiguous between "call `.post()` on the router" and "call `.post()` on the table object," and only one of those exists.

Imports needed: `Hono`, Drizzle's `and`/`eq`/`isNull`, the `db` instance, `messages as messagesTable` and `users` from the schema, and `notifyUser` from `../signaling` (Phase 2's own addition, described below).

## The two-sided ack model (why the endpoints are shaped this way)

A row is deleted only once **both** sides are confirmed caught up. That means two separate acks:

1. **Recipient ack** — the recipient's client actually has the message (P2P receipt, or fetched/pushed via this API). Marks `recipientAckedAt` (Phase 1). Does not delete the row — the sender still needs to be told.
2. **Sender ack** — the sender's client has been told the recipient got it (pushed live if online, or picked up on next reconnect — no polling). Only this second ack deletes the row.

### `POST /messages`

Body: `clientId`, `fromUsername`, `toUsername`, optional `text`.

Looks up both users by username (400 if either doesn't exist), inserts a row with `clientId`, `fromUserId`, `toUserId`, `text`, then calls `notifyUser(toUsername, { type: 'new-message', message: row, fromUsername })` and returns the created row.

`fromUsername` rides along in the push payload, not just the row (which only has `fromUserId`, an integer) — the client's `messages-store.ts` (Phase 4) keys conversations by peer *username*, and `MessageStatusListener` (Phase 5) has no other cheap way to resolve which conversation a pushed row belongs to without an extra round trip. The server already has the username in scope, so including it costs nothing.

The failover **attachment** case does not go through this endpoint — see Phase 3, which has its own presign/confirm endpoints since attachment bytes go directly from the browser to RustFS.

### `GET /messages?peer=<username>&self=<username>`

Used exactly once per chat-page mount (Phase 5), to catch up on anything that arrived while this device was closed/unreachable — a one-shot fetch, not a poll.

Looks up both users by username (400 if either is missing), then selects rows where `fromUserId` = the peer's id, `toUserId` = self's id, and `recipientAckedAt IS NULL` — i.e. messages the peer sent that this device hasn't acked yet. Once acked (`POST /messages/:id/ack`), a row stops appearing here.

There's no "sender checking on their own messages" variant of this endpoint, because no client code path needs it: the sender learns about a recipient's ack purely through the `message-acked` push (live or queued), which already carries everything needed (`clientId`) to act.

### `POST /messages/:id/ack`

The **recipient's** ack. Sets `recipientAckedAt = now()` on the row identified by `:id` — does not delete it. Called the moment the recipient's client actually has the message, whether via `GET /messages` or a live push.

After updating the row, the handler must look up both the sender's and recipient's usernames (join back to `users` via `fromUserId`/`toUserId` — the row only stores integer ids, and `notifyUser` needs a username to find the right WebSocket connection). If both resolve, call `notifyUser(sender.username, { type: 'message-acked', clientId: row.clientId, peerUsername: recipient.username })`.

`peerUsername` here is the recipient's username, from the sender's point of view — same reasoning as `POST /messages`'s `fromUsername`: `MessageStatusListener` needs a peer username to update the right entry in `messages-store.ts`'s `byPeer` without an extra lookup.

If the sender isn't online right now, this push queues automatically (see "Push on connect" below) and reaches them the moment they next connect.

### `DELETE /messages/:id`

The **sender's** final ack. Only now is the row actually deleted — the only deletion trigger. Looks up the row first; if `recipientAckedAt` is still null, return 409 (the sender can't have learned about a delivery that hasn't happened yet — a well-behaved client should never trigger this, but the guard exists). Otherwise deletes the row and returns success.

There is no `/read` endpoint — read-tracking (Phase 5) is purely client-side, since by the time a message could be marked read, both acks have already happened and the server's copy is gone.

## No message history server-side

`messages` is a transient mailbox, not a history log. A row's entire lifecycle (create → recipient-ack → sender-ack/delete) only exists to bridge the gap when P2P couldn't deliver live. If both peers are connected via the data channel at send time, no row is ever created. Chat history living only in each client's in-memory state (lost on refresh) is an accepted limitation, not something this phase tries to fix.

## Push on connect — extending `server/src/signaling.ts`, no polling anywhere

`signaling.ts` already has the mechanism this needs: a `pending` map (username → queued payloads) flushed the instant that user's WebSocket reopens (`onOpen`) — the existing pattern for "deliver this the moment the recipient reconnects," already used for WebRTC offers to a not-yet-connected peer.

Add and export a `notifyUser(username, payload)` function from `signaling.ts` (the file currently only exports `websocket`): if the target's WebSocket is open (`peers.get(username)`, checking `readyState`), send the payload immediately; otherwise push the JSON-stringified payload onto that username's queue in the existing `pending` map, to be flushed by the existing `onOpen` handler. `messages.ts` imports this as `import { notifyUser } from '../signaling'`.

Both push sites use this:
- `POST /messages` (and Phase 3's attachment confirm) → `new-message`, recipient-facing, queues if they're offline.
- `POST /messages/:id/ack` → `message-acked`, sender-facing, queues if they're offline.

On the client, this signaling WebSocket lives in `client/lib/signaling-store.ts` (Phase 0b) — `new-message`/`message-acked` are handled by a root-level subscriber there (Phase 5's `MessageStatusListener`), not inside `use-webrtc-chat.ts` (which only handles WebRTC signaling for whichever one conversation is currently open). Since `onOpen` flushes the server's queue by replaying stored payloads through the same socket, queued messages arrive through the store's normal `ws.onmessage` → `subscribe` broadcast exactly like a live push — client code doesn't need to know or care whether a given message arrived live or was queued.

## Why no separate "delivery" WebSocket, and why no polling

The signaling WebSocket already exists per logged-in user and is already used for cross-device push (ICE candidates) plus queued delivery on reconnect. Reusing both for message delivery/ack notices means zero new infrastructure — no second connection, no polling loop, no timer.

## Verification

1. `POST /messages` with a text body between two known users — confirm the row comes back.
2. `GET /messages?peer=<sender>&self=<recipient>` — confirm the row appears, unacked.
3. `POST /messages/<id>/ack` — confirm this triggers `notifyUser` toward the sender (check server logs, or connect as the sender to observe the push, live or queued).
4. Repeat the `GET` from step 2 — confirm the row no longer appears (recipient already has it).
5. `DELETE /messages/<id>` — confirm success, then repeat the same `DELETE` and confirm a 404 (row is actually gone).
