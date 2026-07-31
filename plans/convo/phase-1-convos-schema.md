## `webrtc-convos` IndexedDB store

New file: `client/lib/convos.ts`. Same `openDb()`/`onupgradeneeded` scaffolding as `contacts.ts`/`chats.ts`, but the index differs from both — see Storage details.

### Type

```ts
export type ConvoMessage = {
  ownerId: string;       // which locally-registered identity this row belongs to
  threadId: string;      // a contact's user id (1:1) or a group id (group chat) — groups rows into a conversation
  messageId: string;     // ties this row back to the live message (see below)
  sender: { id: string; username: string }; // id === ownerId if fromSelf; username denormalized at write time — see below
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

### Field-by-field reasoning

**`messageId`, not `clientId`.** It's the message's own id, assigned client-side by whichever device sends it — not an id "of a client." The name also avoids confusion with `MessageRow.id`, the *server*-assigned id that only exists for messages that went through server failover. `messageId` is the one id both the P2P and failover paths share, which is why ack/status-matching already keys on it today. Generated with `uuidv7()` (the same package/function the server already uses for every DB row id — `server/src/db/schema.ts`), not `crypto.randomUUID()` (v4): this is a new field for new code, no reason to inherit `clientId`'s old v4 generation. `uuidv7` isn't yet a `client/` dependency — this phase adds it.

**`files: []`, not a single `file`.** Attachments can be multiple per message. Shape is `{ name, type, url }` per file.

**`threadId`, not `contactId`+`group`.** `threadId` is a contact's user id for 1:1, or a group id once group chat exists — one field, one index, no per-thread-type branching needed just to look up messages. No separate `isGroupThread`/discriminator field: nothing today reads one (no group store, no group-aware rendering exists yet), so it'd be a flag with no consumer — add it when group chat is actually being built and something needs to branch on it. Group chat itself is still out of scope for this phase — this is only about making the schema not need a second migration once it's built.

**`sender: { id, username }`, not a bare `senderId`.** A bare id breaks the moment a message arrives from someone not yet in this device's `webrtc-contacts` — e.g. a group member never individually 1:1-verified (see `plans/group-chat/note.md`), or any future path where a peer can message before a contact record syncs locally. `Contact` (`contacts.ts`) already avoids the equivalent problem by storing `username` alongside `id` rather than depending on a live lookup — same fix here: `username` is denormalized into the row at write time (whatever the message payload/push carried), so the row can render a name regardless of whether a matching `Contact` exists. `sender.id === ownerId` for own messages — no separate `fromSelf` field is stored; a read-time check against `sender.id` covers it. (`messages-store.ts`'s in-memory `ChatMessage`, covered in [[phase-2-messages-store-rebuild]], keeps a real `fromSelf` field — that store only ever holds one live session, so freezing it in doesn't have the same problem a persisted row would.)
