# Phase 1 — Server: messages table

## File

`server/src/db/schema.ts`

## What to add

A new `messages` table, defined via Drizzle the same way `users` already is (`pgTable`, no migration files). Columns:

- `id` — serial primary key.
- `clientId` — text, not null. Generated client-side (`crypto.randomUUID()`) the moment the user hits send, before any network call. Lets the client reconcile "the message I created locally as `sending`" with whichever row the server later holds for it, regardless of which path (P2P or failover) ends up mattering.
- `fromUserId` / `toUserId` — integers, not null, each referencing `users.id`.
- `text` — nullable text, for text messages.
- `fileName` / `fileType` / `fileUrl` — all nullable text, for attachment messages (Phase 3). A row is either a text message or a file message, never both — whichever set of columns applies is left null on the other kind.
- `recipientAckedAt` — nullable timestamp. Null until the recipient's device has the message; set (not deleted) the moment they ack it.
- `createdAt` — timestamp, not null, defaults to now.

## Why `recipientAckedAt`, and why the row isn't deleted on recipient-ack alone

Per checklist.md, a row is deleted only once **both** sides are confirmed caught up — not the moment the recipient has the message. Two separate events, not one:

1. The recipient's client actually receives the message and acks it — `recipientAckedAt` gets set. The row still exists.
2. The server then tries to notify the **sender** that delivery happened (live push if online, or the sender's client picks it up the moment it next reconnects — same mailbox pattern as step 1). Only once the sender's client has confirmed *that* notice does the row get deleted.

Without `recipientAckedAt` as a real, queryable state, there's no way to distinguish "nobody has this yet" from "the recipient has it, we're just waiting to tell the sender" — both would otherwise look identical (a bare existing row). A nullable timestamp rather than a boolean was chosen because it doubles as debugging/observability information at zero extra cost.

## Full lifecycle of a row

1. **Created** (`recipientAckedAt: null`) — failover send, recipient doesn't have it yet.
2. **Recipient acks** (`recipientAckedAt` set) — recipient has it now, row still exists, sender not yet told.
3. **Sender acks the delivery notice** — row is deleted. This is the only deletion trigger (see phase-2-api.md's `DELETE` endpoint — the sender's action, distinct from the recipient's earlier ack which only sets a column).

If both peers are connected via P2P when a message is sent, it goes straight over the data channel and no row is ever created — steps 1-3 only apply to the failover path.

## Migration

Same convention as `users`: no migration files, `bun run db:push` from `server/`.

## Verification

After `bun run db:push`, confirm the table exists with the expected columns via `docker compose exec -T postgres psql -U webrtc -d webrtc -c "\d messages"`.
