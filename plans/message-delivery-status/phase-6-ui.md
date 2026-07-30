# Phase 6 — Client: status UI + attachment parity

## File

`client/app/chat/[username]/page.tsx`

## Remove the `disabled={!connected}` gates

Currently the message input, the attach button, and the send button are all disabled until `connected` is true — this is the root cause of the original complaint ("this app waits for connection... i should be able to send chat as soon as possible"). Phase 4's send pipeline makes sending work with or without an active data channel, so none of these should be gated on `connected` anymore. Only the send button's existing "empty input" disable condition should remain.

`connected` is still useful to keep showing in the header as a live indicator of whether the P2P fast path is currently available — just not as a gate on interactivity.

## Status rendering

Add a small status indicator per message bubble, for the user's own (`fromSelf`) messages only — a peer's own messages don't need to show you their delivery status of your incoming ones, only your outgoing ones need a status shown to you. Render the message's `status` field (`sending`/`in-transit`/`sent`/`read`) as plain text next to the bubble's content, placed inline after the message content/filename, inside the same bubble element — matching the existing one-bubble-per-message layout without introducing a new row or column.

## Attachment parity

`sendFile` (Phase 4) already produces `ChatMessage` entries with the same `status` field and lifecycle as text messages — no separate rendering logic is needed beyond what already exists for file bubbles. The status indicator above applies uniformly since it's rendered once per bubble regardless of whether the bubble is text or a file. This covers both P2P-delivered attachments (Phase 4's existing chunking) and failover attachments uploaded via RustFS (Phase 3) — the `ChatMessage` shape is identical either way.

## Initial history load + read-marking on mount

Per Phase 5, `use-webrtc-chat.ts`'s effect fetches `GET /messages?peer=&self=` on mount, adds each fetched row locally with `status: "sent"`, then acks it (`POST /messages/:id/ack` — does not delete the server's copy, see Phase 5's two-step model). Marking those as `read` happens separately per Phase 5's read-tracking behavior — a local status flip once the thread is considered viewed, no server call. This is entirely inside the hook; `page.tsx` just renders whatever messages the hook returns, same as today.

## Verification

Manual check covering the original complaint:
1. Open a chat as one user without the peer ever opening their side (so no data channel ever connects).
2. Confirm the message input and send button are NOT disabled, and messages can be typed and sent immediately.
3. Confirm the message appears locally with status `sending` → `in-transit` (never reaches `sent` yet, since the peer hasn't received it).
4. Have the peer log in and open the chat. Confirm their `GET /messages` fetch shows the message and they ack it (row still exists server-side at this point, `recipientAckedAt` now set). Confirm the sender — whether their tab was open the whole time (live push) or they had closed it and reopen now (queued `message-acked` flushes the moment their WebSocket reconnects) — receives `message-acked`, flips their copy to `sent`, and the row is deleted. No polling in either case.
5. Repeat with a file attachment, unconnected — confirm it goes through Phase 3's presign/PUT/confirm flow and the peer can view/download it once they fetch it.
