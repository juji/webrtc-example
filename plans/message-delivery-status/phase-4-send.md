# Phase 4 — Client: status-aware send pipeline

## Files

`client/lib/messages-store.ts` (new), `client/lib/use-webrtc-chat.ts`

## Current state (why it needs to change)

`sendMessage`/`sendFile` currently no-op silently if the data channel isn't open. No status tracking exists at all, and `messages`/`ChatMessage[]` currently live in local `useState` inside `useWebRtcChat`, which only exists while a specific `/chat/[username]` page is mounted.

## Decided: message state moves into a Zustand store, keyed by peer

Per Phase 5's requirement — `MessageStatusListener` (a root-level component, not scoped to any one chat page) needs to update a conversation's messages and look up a pending sent-row id even when that conversation's chat page isn't mounted — `ChatMessage[]` and sent-row tracking cannot live in `useWebRtcChat`'s local `useState`/`useRef`. This mirrors why Phase 0b moved the signaling WebSocket itself out of the component tree for the same reason.

### New file: `client/lib/messages-store.ts`

A Zustand store holding:

- `byPeer: Record<string, ChatMessage[]>` — one thread per peer username, matching how `/chat/[username]` is the app's only per-conversation route. `ChatMessage` has `clientId`, optional `text`, optional `file` (`name`/`type`/`url`), `fromSelf`, and `status` (`"sending" | "in-transit" | "sent" | "read"`). This type is now owned by `messages-store.ts` and re-exported — `use-webrtc-chat.ts` imports it rather than declaring its own copy.
- `pendingSentRows: Map<string, number>` — `clientId` → server row id, for failover messages this device sent. Needed so `MessageStatusListener` (Phase 5) can `DELETE` the row once this sender has learned the recipient acked; the id only comes back from the server on row creation. This is a plain `Map` mutated in place (not stored via Zustand's `set`), matching the same non-reactive-internals pattern `signaling-store.ts` already uses for its `listeners`/`sendQueue`/`recentMessages` — nothing renders off this map directly, only `status` (via `byPeer`) is reactive.
- Actions: `addMessage(peer, message)` appends to that peer's array; `updateStatus(peer, clientId, status)` maps that peer's array, replacing the matching message's status; `setPendingSentRow(clientId, rowId)` and `takePendingSentRow(clientId)` (reads and deletes in one step) manage the pending-rows map.

`byPeer` is *not* persisted (no `persist` middleware, unlike `session-store.ts`) — per checklist.md, this is deliberately not a history feature. A refresh loses in-memory messages the same way it does today; only the server's failover mailbox (Phase 1/2) is durable across a refresh, for the narrow window before both sides ack.

`MessageRow` (the server row shape: `id`, `clientId`, `text`, `fileName`, `fileType`, `fileUrl`, `recipientAckedAt`, `createdAt`) is also defined in `messages-store.ts`, since both this phase and Phase 5 need it.

## `use-webrtc-chat.ts` changes

`useWebRtcChat` no longer holds its own `messages` state — it reads `byPeer[peerUsername]` (defaulting to an empty array) and binds `addMessage`/`updateStatus`/`setPendingSentRow` from the store, scoped implicitly to its own `peerUsername` at each call site. Every existing local-state append becomes a call to the store's `addMessage`.

`clientId` is generated with `crypto.randomUUID()` at creation time — already done for files (as the transfer id, which can double as `clientId`); now also needed for text messages. This is the same id from Phase 1's `client_id` column — what lets a later ack, P2P or server, find the right message to update its status.

## `dc.readyState === "open"` does not mean delivery happened

`readyState` reflects the *local* channel object's state, not whether the remote side is actually still receiving. A stale-but-technically-open channel (recipient's tab closed a moment ago, a dropped packet before an ICE restart completes, etc.) means a send on that channel succeeds locally, no error is thrown, no `close` event fires — so if the P2P branch is taken and nothing ever checks whether it actually landed, that message has no server row, no retry, and no ack ever comes back. It would sit at `"in-transit"` forever with zero recovery path.

**Decided fix**: the P2P branch gets an ack timeout. If the recipient's `ack` (Phase 5, data-channel message kind `"ack"`) doesn't arrive within a fixed window, fall back to the exact same server-failover path already used for "channel not open" — not a separate code path, the same one, just triggered later.

Use a shared constant `ACK_TIMEOUT_MS` (4000ms — generous for a channel that's actually alive) and a module-scope `Map<string, TimeoutHandle>` named `ackTimers`, keyed by `clientId`, living in `use-webrtc-chat.ts` alongside the existing refs. Same non-reactive-bookkeeping pattern as `pendingSentRows` above — nothing renders off it, it exists purely so the ack handler (Phase 5) can find and cancel the right pending timeout.

## `sendMessage` behavior

Generate a `clientId`, add a local message with `status: "sending"`. Refactor the server-dispatch logic (the `POST /messages` call, reading back the row, `setPendingSentRow`) into one shared step used by both branches below, since it's identical either way.

- If the data channel is open: set status to `"in-transit"`, send the message over the data channel, then start an `ACK_TIMEOUT_MS` timer keyed by `clientId` in `ackTimers` — if it fires (no ack arrived), remove itself from the map and run the server-dispatch step as a fallback. Return immediately after sending and arming the timer; don't await the server path unless the timer actually fires.
- If the data channel is not open: set status to `"in-transit"` and run the server-dispatch step directly, no timer involved.

Either way, "in-transit" means "an attempt has been dispatched, but the recipient doesn't have it yet" — that's true immediately after either the P2P send or the failover POST, and it's deliberately not "P2P is connecting" or "the server accepted my POST." Only Phase 5's ack handling (a P2P ack, or the recipient's client actually fetching the failover copy) can confirm the recipient has it, which is what `"sent"` means.

## `sendFile` behavior

Same shape as `sendMessage`, but the two paths diverge more:

- **P2P path**: existing chunking logic (`RTCDataChannel` messages are constrained to a few hundred KB, hence chunking) — unchanged from what's already implemented. After sending the final chunk-end marker, arm the same kind of `ACK_TIMEOUT_MS` timer as `sendMessage`, falling back to the server upload path if it fires.
- **Failover path**: per Phase 3, this is a presign → direct browser PUT to RustFS → confirm sequence, not a plain POST carrying the file body. Refactor this sequence into one shared step, used both as the direct fallback (channel not open) and as what the ack timeout triggers if the P2P chunks never get acked.

## `DataChannelMessage` kinds

The data-channel message union needs five kinds, each carrying `clientId` so a later ack (P2P or server) can find the right message: `"text"` (with `text`), `"ack"`, `"read"`, `"file-start"` (with `name`/`type`), `"file-end"`. The existing file-transfer id becomes `clientId` for consistency with the server's `client_id` column and Phase 5's ack matching.

`"ack"` is sent by the *receiver* back to the sender immediately upon receipt — what Phase 5 uses to flip the sender's local status from `"in-transit"` to `"sent"` on the P2P path, and to cancel the pending ack-timeout (see Phase 5). `"read"` is sent by the receiver when they view the thread (Phase 5) — lets the sender flip `"sent"` → `"read"` on the P2P path, since read state is otherwise purely local to whichever client marked it.
