## `use-webrtc-chat.ts` callers updated for the rename/pluralization

Follows [[phase-2-messages-store-rebuild]] — every reference to `clientId` becomes `messageId`; every reference to `.file` becomes `.files`:

- `sendMessage`/`sendFile`: generate `messageId` via `uuidv7()` instead of `crypto.randomUUID()` for `clientId` (see [[phase-1-convos-schema]] — new field, matches the server's id scheme instead of inheriting the old one). `sendFile` wraps its single `File` into `files: [file]`.
- Ack/status-matching: `updateStatus`, the P2P `ack`/`read` data-channel frames, `dispatchTextViaServer`/`dispatchFileViaServer`, `armAckTimeout` — all keyed on `messageId` throughout, same logic, renamed field.
- `fetchFailoverMessages` catch-up loop (`use-webrtc-chat.ts:72-85`): `addMessage(peerUsername, { clientId: row.clientId, ... })` → `messageId: row.clientId` (server's `MessageRow.clientId` field itself is unaffected — this is a client-side rename only, not a server schema change) and `file: row.fileUrl ? {...} : undefined` → `files: row.fileUrl ? [{...}] : []`.
