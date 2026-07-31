## `messages-store.ts` rebuilt in place

Same file, same role — runtime-only Zustand store, not persisted, not deleted (only `clientId`/`file` are being renamed/reshaped, matching [[phase-1-convos-schema]]'s `ConvoMessage`, the store itself stays).

- `ChatMessage.clientId` → `ChatMessage.messageId`.
- `ChatMessage.file?: {...}` → `ChatMessage.files: {...}[]`.
- `text?`, `fromSelf`, `status` unchanged — `fromSelf` stays here since this store is always scoped to one live session/identity (unlike the persisted `ConvoMessage`, which derives it instead of storing it).
