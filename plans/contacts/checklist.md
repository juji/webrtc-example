## Context

Today there is no way for two users to start a conversation

Decided:
- **No searchable contact database.** Users cannot look each other up by username or any other query. The only way to become contacts is the live QR handshake below.
- **QR content is `{ id, mlKemPublicKey, username }` of the user showing the code.** `id` + `mlKemPublicKey` are required — the key comes from the QR itself (scanned directly off the other person's screen), not a later server lookup, so acceptance is a trust-on-first-use verified key pin, not a blind fetch. `username` is optional, display-only.

## Phase 1 — QR code creation

## Phase 2 — QR code scan

## Phase 3 — The handshake

## Phase 4 — Contact persistence
