## `webrtc-convos` messages table (`PrimssgDB`)

New file: `client/lib/convos.ts`. Same shape as the already-migrated `contacts.ts`/`chats.ts` (`plans/sqlite-migration` Phases 3-4): a thin wrapper calling `useDbStore.getState().connect()` then a `PrimssgDB` method — no direct storage access from `client/`. The actual persistence lives in `packages/primssg-db`, not here.

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

Follows the exact pattern `plans/sqlite-migration` Phase 0 established for `keys`/`contacts`/`conversations` — a table in `packages/primssg-db/src/schema.ts`, two new abstract methods on `PrimssgDB`, and a real implementation in `PrimssgDBWasmEngine` (`packages/primssg-db/src/worker.ts`). Nothing new architecturally, just one more table/method pair on the same interface.

- **`packages/primssg-db/src/types.ts`**: add `ConvoMessage` (moves here from being client-only — same reasoning as `Contact`/`Conversation`/`KeyBundle` already living there, not in `client/`)
- **`packages/primssg-db/src/schema.ts`**: new `messages` table —
  ```sql
  CREATE TABLE IF NOT EXISTS messages (
    ownerId TEXT NOT NULL,
    threadId TEXT NOT NULL,
    messageId TEXT NOT NULL,
    senderId TEXT NOT NULL,
    senderUsername TEXT NOT NULL,
    text TEXT,
    files TEXT NOT NULL,          -- JSON-serialized { name, type, url }[]
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    sentAt TEXT,
    deliveredAt TEXT,
    PRIMARY KEY (ownerId, messageId)
  );
  CREATE INDEX IF NOT EXISTS messages_thread ON messages (ownerId, threadId);
  ```
  `sender: { id, username }` flattens to `senderId`/`senderUsername` columns (SQL has no nested-object column type) and reassembles into `{ id, username }` in the engine's row-mapping code, same as any other read. `files` has no fixed shape SQLite can express as columns — stored as a JSON `TEXT` blob, `JSON.parse`/`JSON.stringify` at the engine boundary, same treatment `LastMessage` already gets inside `conversations`.
- **`packages/primssg-db/src/primssg-db.ts`**: add to the abstract class —
  ```ts
  abstract addMessage(message: ConvoMessage): Promise<void>;
  abstract listMessages(ownerId: string, threadId: string): Promise<ConvoMessage[]>;
  ```
- **`worker.ts`**: `addMessage` is an `INSERT OR REPLACE` on `(ownerId, messageId)` (upsert — a message's `status`/`sentAt`/`deliveredAt` get rewritten in place as it moves through its lifecycle, not re-inserted). `listMessages` is `SELECT * FROM messages WHERE ownerId = ? AND threadId = ? ORDER BY createdAt` — the `messages_thread` index makes this a direct index lookup, not a scan.
- **`worker-protocol.ts`**: `MethodName` union picks up the two new methods automatically (derived from `keyof PrimssgDB`, per `plans/sqlite-migration` Phase 0 — no separate edit needed there)
- **`client/lib/convos.ts`**: `addMessage(message)` / `listMessages(ownerId, threadId)`, each `await useDbStore.getState().connect()` then `useDbStore.getState().db.<method>(...)` — identical shape to `chats.ts`/`contacts.ts`. `ConvoMessage` re-exported from `primssg-db`, not declared locally.

### Field-by-field reasoning

**`messageId`.** The message's own id, assigned client-side by whichever device sends it, generated with `uuidv7()` (same package/function the server uses for every DB row id — `server/src/db/schema.ts`; `uuidv7` isn't yet a `client/` dependency, this phase adds it). It ties this row back to the live message: both the P2P and server-failover delivery paths already key ack/status-matching on this same id today (`use-webrtc-chat.ts`).

**`files`.** A message can carry multiple attachments, each `{ name, type, url }`.

**`threadId`.** A contact's user id for a 1:1 conversation, or a group id once group chat exists — one field covers both, so lookups don't need to branch by thread type. No discriminator field for "is this a group" exists yet: nothing today reads one (no group store, no group-aware rendering exists), so it'd have no consumer. Group chat itself is out of scope for this phase — this schema is just shaped so it won't need a migration once group chat is built.

**`sender: { id, username }`.** `sender.id === ownerId` identifies an own message; `username` is captured at write time (from whatever the message payload/push carried) rather than looked up live, so a row always renders a name even for a sender not yet in this device's `webrtc-contacts` — e.g. a group member never individually 1:1-verified (see `plans/group-chat/note.md`). `messages-store.ts`'s in-memory `ChatMessage` (covered in [[phase-2-messages-store-rebuild]]) keeps a plain `fromSelf: boolean` instead, since that store only ever holds one live session at a time.

**`createdAt` / `sentAt` / `deliveredAt`.** Three timestamps, each tied to one point in the `status` lifecycle (`"sending" → "in-transit" → "sent" → "read"`, `use-webrtc-chat.ts`). `createdAt` is set once, unconditionally, at `addMessage` time — this is what `ChatPane`'s date separators/time labels sort and group by (equivalent to today's `ChatPaneMessage.createdAt: Date`, persisted as a string here). `sentAt` is set when `status` reaches `"sent"` (P2P ack received, or server failover confirmed), `null` until then — including for a message stuck indefinitely at `"sending"`/`"in-transit"`, a state Phase 5's persistence makes durable/visible for the first time, where today's in-memory `messages-store.ts` just silently loses it on reload. `deliveredAt` is set when `status` reaches `"read"`, `null` until the peer actually views the thread. An incoming message (from the peer) gets `createdAt` = `sentAt` = arrival time — there's no `"sending"`/`"in-transit"` phase for something received rather than sent.
