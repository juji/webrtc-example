# Phase 5 — Client: receive, ack, and read tracking

## Files

`client/lib/use-webrtc-chat.ts`, `client/app/message-status-listener.tsx` (new), `client/app/layout.tsx`, `client/app/chat/[username]/page.tsx`.

## Why this isn't wired into `use-webrtc-chat.ts`'s per-chat-page effect

Per Phase 0b, the signaling WebSocket lives in `signaling-store.ts` and stays open for the whole session — but `use-webrtc-chat.ts`'s subscription (used for `offer`/`answer`/`ice-candidate`) only runs while one specific `/chat/[username]` page is mounted, filtered to messages from the current peer only. `new-message` and `message-acked` are different: they need to reach the user's device regardless of which chat page is open, or whether any is open at all — that's the entire reason Phase 0b moved the WebSocket to the root in the first place. Wiring this into `use-webrtc-chat.ts` would silently reintroduce the exact bug Phase 0b fixed, just for message-status pushes instead of WebRTC signaling.

Instead, `new-message`/`message-acked` are handled by a **separate, root-level subscriber** — parallel to `SignalingConnection`, not inside it. Message state (Phase 4's `messages-store.ts`) lives outside any one component, so this subscriber can update it directly for any conversation, whether or not that conversation's chat page is mounted.

## `SignalMessage` union stays as Phase 0b built it; a second union covers message-status pushes

Rather than growing `signaling-store.ts`'s `SignalMessage` type (WebRTC signaling payloads) to also carry message-status payloads it has nothing to do with, define a second message shape and route it through the same store — both shapes arrive over the same one WebSocket, and the store's `ws.onmessage` already broadcasts every parsed payload to every subscriber. Widen the store's listener type to accept either shape, so this stays type-safe rather than falling back to `any`.

The new `MessageStatusPush` union has two variants: `"new-message"` (carrying the full `MessageRow` plus `fromUsername`) and `"message-acked"` (carrying `clientId` plus `peerUsername`). `fromUsername`/`peerUsername` ride along specifically so the client never has to resolve a peer's username from a bare user id — `MessageRow` only carries `fromUserId`/`toUserId` integers, and `messages-store.ts` keys everything by username.

`MessageRow` is imported from `messages-store.ts` (Phase 4) into `signaling-store.ts` for this type. The dependency only runs one direction (`messages-store.ts` needs nothing from `signaling-store.ts`), so this doesn't create a circular import.

Three spots in the already-built `signaling-store.ts` need their type annotation widened from `SignalMessage` to `SignalMessage | MessageStatusPush` for the file to keep type-checking once these payloads start arriving: the actual parse site in `ws.onmessage` (easy to miss if only the type declarations are updated), the `recentMessages` replay buffer's declared type, and nothing else — `send`'s parameter stays narrowed to `SignalMessage`, since a `MessageStatusPush` is never something the client sends, only receives.

**A real type error this widening introduces, must be fixed at the same time**: `use-webrtc-chat.ts`'s existing subscriber callback checks the sender before checking the message kind. `MessageStatusPush`'s two variants have no sender field at all, so once the listener's parameter type is the union, that field no longer type-checks unconditionally — TypeScript won't allow reading a property that doesn't exist on part of a union without narrowing first. Fix by checking the message's `type` (is it `offer`/`answer`/`ice-candidate`?) before touching the sender field at all; if it's neither, return early. This also makes "ignores new-message/message-acked" explicit and type-safe, rather than relying on an `if`/`else if` chain that happens to fall through. Apply the mirror-image version in the new root-level subscriber below: narrow to `new-message`/`message-acked` first, ignore the WebRTC signaling kinds.

## New file: `client/app/message-status-listener.tsx`

A headless client component, mounted in `layout.tsx` alongside `SignalingConnection` (not nested inside it — both are independent root-level subscribers to the same store). On mount (once a user is logged in), it subscribes to the signaling store and handles two cases:

- **`new-message`**: add the row to `messages-store.ts` under the sender's username (`fromSelf: false`, `status: "sent"` — the local device now has it), mapping the row's `text`/`file` fields into a `ChatMessage`, then `POST /messages/:id/ack` to tell the server this device has it (Phase 2's recipient-ack endpoint).
- **`message-acked`**: look up and clear the pending sent-row id for that `clientId` (`takePendingSentRow`), flip that message's status to `"sent"` under the given peer username, and if a row id was found, `DELETE /messages/:id` to complete the sender's ack.

Unsubscribe on unmount/logout, same lifecycle as `SignalingConnection`.

## P2P receipt → immediate ack (no server involved)

In `use-webrtc-chat.ts`'s data-channel receive handler, whenever a text message or a completed file transfer is received: immediately send an `"ack"` back over the same data channel (carrying that message's `clientId`), then add the message locally with `status: "sent"`. Both sides of the two-sided ack (recipient-has-it, sender-told) happen in this single data-channel round trip — there's no server row to manage at all, since none was ever created for a message that went straight over the data channel. This part is unaffected by Phase 0b — the data channel is separate from the signaling WebSocket and was never moved.

## Handling the `"ack"` kind (sender side, P2P path)

When an `"ack"` arrives on the data channel: look up the pending timeout for that `clientId` in `ackTimers` (Phase 4); if found, cancel it and remove it from the map, then flip that message's status to `"sent"`.

**Race this closes**: without cancelling the timer, a real ack arriving just under the timeout window would correctly flip the message to `"sent"` — but the timeout armed at send time would still fire moments later and trigger the server-fallback anyway, creating a redundant server row for a message the recipient already has. Cancelling the timer on ack receipt is what makes the timeout only ever fire for a send that's actually stuck.

## Handling the `"read"` kind (sender side, P2P path)

When a `"read"` arrives on the data channel: flip that message's status to `"read"`.

## Failover path: the two-sided ack takes two separate round trips

The row is **not** deleted the moment the recipient has the message — only once the sender has also been told. "Receiving" and "the row disappearing" are two distinct steps, matching Phase 1's `recipientAckedAt` model.

### Step 1 — recipient receives and acks (does not delete)

Two entry points feed messages that went through the server (because P2P wasn't available at send time), covering both text and attachments since both end up as a `messages` row with the same shape from the client's point of view:

1. **On chat-page mount**: `GET /messages?peer=<peerUsername>&self=<selfUsername>` (Phase 2) — a one-shot fetch, not a poll, run once per chat-page visit to catch up on anything missed. For every row returned, add it locally with `status: "sent"` and call `POST /messages/:id/ack`.
2. **Live push while a session is connected**, handled by `MessageStatusListener` (root-level, described above): `new-message`.

Either way, this ack sets `recipientAckedAt` server-side and triggers the server to try pushing `message-acked` to the sender — but the row itself still exists after this call. The recipient's job is done; the sender's isn't yet.

### Step 2 — sender learns delivery happened, then acks-in-turn (this deletes the row)

Handled in `MessageStatusListener`: on `message-acked`, look up and clear the pending row id recorded when the message was first dispatched via the server (Phase 4), flip the sender's local copy to `"sent"` regardless of whether that conversation's chat page is open, then `DELETE` the row to complete the sender's ack.

## No polling: what covers the sender being offline when the recipient acked

`notifyUser` (server-side, Phase 2) doesn't drop a payload if the target is offline — it falls into `signaling.ts`'s existing queue, flushed the instant that user's WebSocket reopens. Combined with Phase 0b's fix (the WebSocket now stays open for the whole session), a `message-acked`/`new-message` notice reaches `MessageStatusListener` — mounted for the whole session — the moment it's sent if the user is online anywhere in the app, or the instant they reconnect if they weren't. Connecting *is* catching up; there's no timer, no separate poll.

## Read tracking

Purely client-side and best-effort, since by the time a message is "read" the server's copy is already gone (deleted at the sender's final ack, step 2 above). When a chat page is mounted/visible, mark any locally-held messages from the peer that are currently `"sent"` as `"read"` — a local status flip against the shared store, no network call. For the P2P path, also echo a `"read"` message back over the data channel if still connected, so the sender can flip their own copy from `"sent"` to `"read"` too. If the data channel isn't open at that moment, the sender simply never learns the peer read it — acceptable, since read receipts are explicitly best-effort, unlike delivery, which the two-sided server ack guarantees eventually resolves.
