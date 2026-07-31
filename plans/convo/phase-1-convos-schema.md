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
  createdAt: string;     // ISO timestamp — set once, when the row is first written (addMessage call time)
  sentAt: string | null; // ISO timestamp — set when status transitions to "sent"; null while "sending"/"in-transit"
  deliveredAt: string | null; // ISO timestamp — set when status transitions to "read"; null until then
};
```

### Storage details

- `DB_NAME = "webrtc-convos"`, `STORE_NAME = "messages"`
- keyPath: `["ownerId", "messageId"]` — unique per row, matches `contacts.ts`/`chats.ts`'s pattern of keying on `[ownerId, <the thing this row is about>]`
- index: `CONVO_INDEX`, on `["ownerId", "threadId"]`. `convos.ts` holds one row per *message*, and the real read pattern is always "this owner's messages in this one thread" (`ChatPane` opening a thread, 1:1 or group) — indexing the exact lookup key makes `listMessages` a direct fetch instead of a scan-and-filter. `threadId` unifies 1:1 and group lookups under one index, so no separate index is needed per thread type.
- `addMessage(message: ConvoMessage): Promise<void>` — `put`, keyed via the compound keyPath
- `listMessages(ownerId: string, threadId: string): Promise<ConvoMessage[]>` — `index(CONVO_INDEX).getAll([ownerId, threadId])`, a direct lookup, no client-side filtering

### Field-by-field reasoning

**`messageId`.** The message's own id, assigned client-side by whichever device sends it, generated with `uuidv7()` (same package/function the server uses for every DB row id — `server/src/db/schema.ts`; `uuidv7` isn't yet a `client/` dependency, this phase adds it). It ties this row back to the live message: both the P2P and server-failover delivery paths already key ack/status-matching on this same id today (`use-webrtc-chat.ts`).

**`files`.** A message can carry multiple attachments, each `{ name, type, url }`.

**`threadId`.** A contact's user id for a 1:1 conversation, or a group id once group chat exists — one field covers both, so lookups don't need to branch by thread type. No discriminator field for "is this a group" exists yet: nothing today reads one (no group store, no group-aware rendering exists), so it'd have no consumer. Group chat itself is out of scope for this phase — this schema is just shaped so it won't need a migration once group chat is built.

**`sender: { id, username }`.** `sender.id === ownerId` identifies an own message; `username` is captured at write time (from whatever the message payload/push carried) rather than looked up live, so a row always renders a name even for a sender not yet in this device's `webrtc-contacts` — e.g. a group member never individually 1:1-verified (see `plans/group-chat/note.md`). `messages-store.ts`'s in-memory `ChatMessage` (covered in [[phase-2-messages-store-rebuild]]) keeps a plain `fromSelf: boolean` instead, since that store only ever holds one live session at a time.

**`createdAt` / `sentAt` / `deliveredAt`.** Three timestamps, each tied to one point in the `status` lifecycle (`"sending" → "in-transit" → "sent" → "read"`, `use-webrtc-chat.ts`). `createdAt` is set once, unconditionally, at `addMessage` time — this is what `ChatPane`'s date separators/time labels sort and group by (equivalent to today's `ChatPaneMessage.createdAt: Date`, persisted as a string here). `sentAt` is set when `status` reaches `"sent"` (P2P ack received, or server failover confirmed), `null` until then — including for a message stuck indefinitely at `"sending"`/`"in-transit"`, a state Phase 5's persistence makes durable/visible for the first time, where today's in-memory `messages-store.ts` just silently loses it on reload. `deliveredAt` is set when `status` reaches `"read"`, `null` until the peer actually views the thread. An incoming message (from the peer) gets `createdAt` = `sentAt` = arrival time — there's no `"sending"`/`"in-transit"` phase for something received rather than sent.
