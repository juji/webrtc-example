# Phase 0b — Client: signaling WebSocket lives in a Zustand store, not per-chat-page

**Status: already implemented and verified.** This file documents what was actually built (and the bugs found while building it), so whoever reads this plan next has the real gotchas, not just the intended design. The actual code lives in the files named below — this document describes their behavior, it isn't a copy of their contents.

## Why this phase exists

Every later phase in this plan (`message-acked`/`new-message` pushes, the recipient's ack, the sender learning delivery happened) depends on the signaling WebSocket staying open for the whole session. It previously did not: `useWebRtcChat` used to open the signaling WebSocket inside an effect that only ran while `/chat/[username]/page.tsx` was mounted. Next.js App Router unmounts route components on navigation — this is not a classic single persistent-root SPA. The moment a user navigated from a chat page to `/users` (completely normal — checking other conversations, searching someone else), that WebSocket closed. Any push meant for that user while they were anywhere except that one specific chat page would have been silently missed.

## What was built

### `client/lib/signaling-store.ts`

A Zustand store holding one signaling WebSocket for the whole logged-in session. It exposes `connect(username)`/`disconnect()` to manage the connection's lifecycle, `send(message)` to send a signaling message to a given peer, and `subscribe(listener)` to register a callback for incoming messages, returning an unsubscribe function.

Internally, alongside the reactive `ws`/`connected` state: a plain array of registered listeners (not part of reactive state, since nothing renders off "who's listening"), a send queue, and a bounded replay buffer of the last 20 received messages.

Three things exist here because of real bugs found while building and testing this, not speculative design:

1. **Send queue** — a WebSocket throws if `send()` is called before the socket reaches the open state. Since `connect()` is called once at the root and a chat page's effect can run and try to send an offer before that connection has finished opening, outgoing sends attempted too early are queued instead of thrown away, and flushed the moment the socket opens.
2. **Replay buffer (last 20 messages)** — verified via a real end-to-end test that without this, an offer could arrive and be delivered to zero listeners (`useWebRtcChat`'s subscription happens after an async ICE-server-fetch call, so there's a real window where the store has no subscriber yet) and be silently dropped forever, permanently breaking that connection attempt. The buffer replays recent messages to any newly-subscribing listener so a "too early" message isn't lost.
3. **Peer filtering happens in the subscriber, not the store** — the store itself doesn't know which peer a given chat page cares about; it broadcasts to all listeners, and each listener is responsible for ignoring messages not addressed from its own peer (see `use-webrtc-chat.ts` below).

### `client/app/signaling-connection.tsx` + `client/app/layout.tsx`

A headless client component, mounted once in the root layout, that owns the connection's lifecycle tied to login state (not to which page is active): connects when a user is present, disconnects on logout or unmount. `layout.tsx` is a Server Component and can't run effects directly, hence the separate client component, mounted inside `<body>` alongside the page content.

### `client/lib/use-webrtc-chat.ts`

No longer owns a WebSocket. Keeps the peer-connection/data-channel logic (genuinely per-chat-page — a peer connection is specific to one conversation) but routes all signaling through the shared store:

- Outgoing signaling messages go through the store's `send`, addressed to the current peer, instead of a local socket.
- Incoming signaling messages are handled via the store's `subscribe`, unsubscribing on cleanup, filtered to only the current peer's messages — this filter did not exist in the original per-page-WebSocket version (it didn't need to, since that WebSocket only ever carried messages for one conversation) and is a real, separate bug fix required now that one shared connection carries signaling traffic for whichever peer the user is currently viewing.
- The initiator's offer is sent only after subscribing (not before), so replies aren't at risk of arriving before anything is listening for them.
- Effect cleanup now only tears down the peer connection and unsubscribes — it no longer closes a WebSocket, since it doesn't own one.

## Verification (already performed)

1. Confirmed via Playwright, using real client-side navigation (not a full page reload, which isn't representative): the signaling WebSocket opens exactly once per session and survives navigating away from a chat page and back — zero reopens, zero closes.
2. Confirmed the full register → search → WebRTC data-channel chat → file-attachment flow (`e2e/chat.test.mjs`) still passes after this refactor, across repeated runs — this caught the dropped-offer bug (fixed via the replay buffer) and would have caught the missing peer-filter bug had two concurrent conversations been in play.
