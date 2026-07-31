# Group chat — not yet planned, open question captured here

Surfaced while scoping `plans/convo` Phase 1 (`webrtc-convos` schema): the schema unifies 1:1 and group under `threadId` so it won't need a second migration later, but group chat itself is out of scope there and nothing about *how* it would work has been decided.

## The blocker

Every identity binding (`id` ↔ `username` ↔ `mlKemPublicKey`) this app currently trusts comes from the live QR-scan + fingerprint-verification handshake (`plans/contacts`) — trust-on-first-use, never trusting a claimed key directly. `Contact` rows (`client/lib/contacts.ts`) are pairwise: a row only exists between two people who each individually did that handshake.

A group has ≥3 members. If I'm added to a group with someone I never 1:1-scanned, I have no verified binding for them — their `id`/`username`/key isn't in my `webrtc-contacts` store, and there's no mechanism today to get it there without the QR dance.

"Just have the group creator hand out member info automatically" (no per-pair QR scan) skips verification entirely — it means trusting whatever the creator (or the server, relaying on their behalf) claims about a member's identity/key, which breaks the trust-on-first-use model every other part of this app relies on.

## What actually needs deciding, before any schema/implementation work

- Does group membership require a trust root (e.g. the creator's already-verified 1:1 contacts vouch for new members, server relays their pinned keys) instead of pairwise re-verification? If so, that's a real departure from "server never stores/attests identity bindings" (`plans/contacts`'s Context) and needs its own justification.
- Or does joining a group still require each member to pairwise-verify each other member out-of-band eventually (even if messaging starts before that's complete)?
- How does `useWebRtcChat` (strictly pairwise today — one `RTCPeerConnection` per peer) deliver to N members? Fan-out from sender, mesh, or a server-relay path?
- Where does group membership itself live — no server table, no client store exists for this yet.

Not scoped further than this — deliberately just a note, not a plan, until someone picks it up.
