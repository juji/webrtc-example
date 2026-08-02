# webrtc

Post-quantum encrypted 1:1 chat: WebRTC data channel for direct P2P, with a Hono server for signaling, contact discovery, and server-relay failover when a direct connection can't be established.

## Structure

Bun monorepo:

- `client/` — Next.js app (App Router)
- `server/` — Hono API + WebRTC signaling
- `packages/primssg-db/` — client-side SQLite (via OPFS) for local message/contact storage
- `e2e/` — Playwright end-to-end tests
- `plans/` — design discussions, not implementation plans (see each folder's `discussion.md`)

Run everything from the root with `bun run dev` (see `README.md` for full setup, including Docker services and env files).

## Auth

No passwords. Every user gets an ML-KEM-768 + ML-DSA-65 keypair generated client-side at registration (`client/lib/keys.ts`); secret keys never leave the device (`packages/primssg-db`'s `keys` table). Login is a challenge-response signature check against the registered ML-DSA public key (`server/src/routes/auth.ts`), not a password.

Server-side sessions are real: login/register set an httpOnly JWT cookie (`server/src/session.ts`), backed by a `user_sessions` DB row for revocation and rolling renewal (30-day JWT expiry, re-issued past 15 days of use). Every route that needs to know "who is this request from" resolves it from that session (`requireSession()`), never from a client-supplied identity field.

## Contacts

No open user search. Adding a contact is a QR-code handshake: one user's app shows a QR encoding their id + key fingerprint, the other scans it and sends a contact request (`server/src/routes/contacts.ts`), the fingerprint gets verified against the scanned copy before a contact is ever trusted client-side (`client/lib/contacts.ts`).

## Chat

1. User registers/logs in via the key-pair flow above.
2. Once logged in, only existing accepted contacts (from the QR flow) can be chatted with — there's no discovery search.
3. Selecting a contact opens a chat with them, primarily over WebRTC (`RTCDataChannel`), using the server for signaling and TURN credential issuance (`server/src/routes/turn.ts`, multiple TURN providers supported).
4. If a direct/relayed WebRTC connection isn't available, messages fail over through the server (`POST /messages`, `server/src/routes/messages.ts`) and get delivered via the same signaling WebSocket when the recipient reconnects.

## Data

- Postgres via Docker Compose (`docker-compose.yml` at repo root — dev-only, not a production deployment path). Schema: `server/src/db/schema.ts` — `users`, `user_sessions`, `messages`, `notifications`, `push_subscriptions`.
- Message text and attachment metadata are stored as opaque strings today (not yet encrypted server-side — see `plans/encryption/discussion.md` for the planned design and why the columns are already shaped for it).
- Attachments live in an S3-compatible bucket (RustFS locally). The bucket and its lifecycle (expiry) rule are provisioned outside `.env`, by `docker-compose.yml`'s `rustfs-init` service in dev — see `README.md`.
- Client-side local storage (messages, contacts, keys) is SQLite via OPFS, not IndexedDB/localStorage (`packages/primssg-db`).

## Conventions

- Filenames: lowercase kebab-case.
- Match existing code style already in `client/` and `server/`.
- Server never trusts client-claimed identity — resolve `fromUserId`/equivalent from the session, not a request body field.
- Design discussions live in `plans/<topic>/discussion.md` and are explicitly not implementation plans unless stated otherwise.
