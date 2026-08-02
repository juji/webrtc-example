# One socket, two concerns — discussion, not a plan

Surfaced while discussing `notifyUser`'s keying (see `plans/encryption/discussion.md` for the unrelated userId-vs-username fix that came out of the same conversation): `server/src/signaling.ts` — named and built for WebRTC signaling — also carries message-delivery/read-receipt push events that have nothing to do with WebRTC setup. This captures the observation. Nothing decided, nothing scoped.

## What's actually on the wire today

One WebSocket connection per logged-in user (`SignalingConnection` in `client/app/signaling-connection.tsx`, mounted at the root layout, connects on login, stays open for the session). Two unrelated message families flow over it, distinguished only by a `type` field:

- **WebRTC signaling** (what the file is named for): `offer` / `answer` / `ice-candidate` — the SDP/ICE exchange needed to establish a direct P2P `RTCDataChannel` between two peers. Genuinely temporary/setup-only; once the data channel is open, these stop being needed for that connection.
- **Delivery/status push** (not signaling at all): `new-message` / `message-acked` / `message-read` (`MessageStatusPush` in `client/lib/signaling-store.ts`) — real-time notification that a chat message was sent/delivered/read, consumed by `client/app/message-status-listener.tsx`. This exists purely because the socket was already open and convenient, not because it belongs with WebRTC setup.

Server-side, both route through the same `notifyUser(userId, payload)` / `peers`/`pending` map in `signaling.ts` — there's no structural separation, just a shared transport and a `type` discriminator.

## Is this standard?

Not a named/textbook pattern — it's a pragmatic shortcut, not a mistake. The more conventional separation:

- WebRTC signaling as its own short-lived setup channel (sometimes even a separate/third-party service, since it's disposable once P2P connects).
- App-level real-time notifications as their own thing — a dedicated pub/sub channel, SSE, or (notably) **this app already has an alternative**: Web Push (`server/src/push.ts`, VAPID keys, `notifyUserByPush`) runs in parallel today for the case where the tab isn't open. The live-socket path and the push path are two separate delivery mechanisms for overlapping event types (`new-message` triggers both `notifyUser` *and* `notifyUserByPush` in `server/src/routes/messages.ts`).

Reusing one already-open connection for a second, unrelated purpose because standing up a second channel felt unnecessary is common in real codebases — not wrong, just not what the file's name promises, which is what prompted this discussion.

## Not decided

Whether to actually split this apart — separate the WebRTC-signaling concern from delivery-status-push into two channels/mechanisms, rename `signaling.ts` to reflect what it actually carries, or fold status-push entirely into the existing Web Push path instead of a live socket — hasn't been decided. This is a capture of the observation, not a proposal to act on it.
