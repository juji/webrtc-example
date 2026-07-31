## `webrtc-convos` IndexedDB store

New file: `client/lib/convos.ts`. Same `openDb()`/`onupgradeneeded` scaffolding as `contacts.ts`/`chats.ts`, but the index differs from both — see Storage details.

### Type

```ts
export type ConvoMessage = {
  ownerId: string;       // which locally-registered identity this row belongs to
  threadId: string;      // a contact's user id (1:1) or a group id (group chat) — groups rows into a conversation
  messageId: string;     // ties this row back to the live message (see below)
  senderId: string;      // ownerId, or whoever else sent it — in a group thread this can be any member, not just threadId
  text?: string;
  files: { name: string; type: string; url: string }[];
  status: "sending" | "in-transit" | "sent" | "read";
  datetime: string;      // ISO timestamp
};
```

### Storage details

- `DB_NAME = "webrtc-convos"`, `STORE_NAME = "messages"`
- keyPath: `["ownerId", "messageId"]` — unique per row, matches `contacts.ts`/`chats.ts`'s pattern of keying on `[ownerId, <the thing this row is about>]`
- index: `CONVO_INDEX`, on `["ownerId", "threadId"]` — **not** a bare `ownerId` index like `contacts.ts`/`chats.ts` use. Those two stores hold one row per *conversation/contact*, so `ownerId` alone is the right granularity to list by. `convos.ts` holds one row per *message* — the real read pattern is always "this owner's messages in this one thread" (`ChatPane` opening a thread, 1:1 or group), never "all of this owner's messages across every thread." Reusing the bare-`ownerId` index here would mean pulling every message across every thread on each chat open and filtering client-side, which gets worse as history grows. Indexing the actual lookup key avoids that. `threadId` unifies 1:1 and group lookups under one index — no separate index needed per thread type.
- `addMessage(message: ConvoMessage): Promise<void>` — `put`, keyed via the compound keyPath
- `listMessages(ownerId: string, threadId: string): Promise<ConvoMessage[]>` — `index(CONVO_INDEX).getAll([ownerId, threadId])`, a direct lookup, no client-side filtering

### Why the shape changed from the original plan

The original row (`sender`/`receiver` as full `{id, username}` objects, `message`, `datetime`) was written before checking what `useWebRtcChat`/`ChatMessage` actually produce, and before thinking through group chat. Four changes resulted:

**`clientId` → `messageId`.** It's the message's own id, assigned client-side by whichever device sends it (`crypto.randomUUID()` at send time) — not an id "of a client." The rename also avoids confusion with `MessageRow.id`, the *server*-assigned id that only exists for messages that went through server failover. `messageId` is the one id both the P2P and failover paths share, which is why ack/status-matching already keys on it today.

**`fromSelf` dropped from the stored row.** It's session-relative — true only relative to whichever local identity is currently active — not a durable fact safe to freeze into IndexedDB. If this device ever holds more than one local identity, a stored `true`/`false` can't be reinterpreted correctly. Instead the row stores `senderId`, and `fromSelf` is derived at read time as `senderId === ownerId`. (`messages-store.ts`'s in-memory `ChatMessage`, covered in [[phase-2-messages-store-rebuild]], keeps `fromSelf` as a real field — that store only ever holds one live session, so the problem doesn't apply there.)

**`file?` → `files: []`.** Attachments can be multiple per message. Shape is unchanged (`{ name, type, url }`), just pluralized to an array.

**`contactId`/`group` → `threadId`.** The original `group: string | null` placeholder didn't actually fit anywhere — `contactId` (a single other user id) has no sensible value for a group message, and nothing indexed or queried `group` at all. Unified instead: `threadId` is a contact's user id for 1:1 (what `contactId` used to hold) or a group id once group chat exists — one field, one index, no per-thread-type branching needed just to look up messages. No separate `isGroupThread`/discriminator field: nothing today reads one (no group store, no group-aware rendering exists yet), so it'd be a flag with no consumer — add it when group chat is actually being built and something needs to branch on it. `senderId` also had to be re-scoped by this change — for a 1:1 thread it's still "`ownerId` or the other party," but for a group thread the sender can be any member, not just `threadId` itself, so its doc comment now says "whoever sent it" rather than naming `contactId` specifically. Group chat itself is still out of scope for this phase — this is only about making the schema not need a second migration once it's built.
