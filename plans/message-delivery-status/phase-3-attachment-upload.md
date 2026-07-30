# Phase 3 — Server + client: direct-to-RustFS attachment upload

## Why this is its own phase

Failover text messages (Phase 2) are small JSON, so `POST /messages` handles them directly. Failover file/image attachments are different: their bytes must end up in RustFS (Phase 0), reachable by a URL any device can later fetch — but per this project's explicit requirement, those bytes must go **directly from the browser to RustFS**, not proxied through the Hono server. The server's only job for an attachment is to hand out a presigned URL and record the resulting message; it never sees the file's contents.

This only applies to the **failover path**. When P2P is available, `sendFile`'s existing chunking logic sends the file directly over the data channel — RustFS is never involved for that case.

## Dependencies

`cd server && bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`.

Verified against the actual running RustFS container (see phase-0-rustfs-infra.md) — bucket creation, presigned PUT generation, a real PUT, and presigned GET readback of the exact bytes all worked with an `S3Client` configured with `endpoint` from `RUSTFS_ENDPOINT` (default `http://localhost:9000`), `region: 'us-east-1'` (RustFS doesn't enforce real AWS regions, but the SDK requires one), credentials from `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY`, and `forcePathStyle: true` (required for RustFS/MinIO-style path-based bucket addressing). Bucket name: `attachments`.

Define this `S3Client` instance and the `BUCKET` constant once, in a shared module (`server/src/storage.ts`), imported by both `index.ts` (for bucket setup, below) and `routes/messages.ts` (for the presign/confirm handlers) — never construct a second `S3Client`.

Add `RUSTFS_ENDPOINT`, `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY` to `server/.env` (same file already holding `DATABASE_URL`, `METERED_APP_NAME`, `METERED_API_KEY`).

**Endpoint mismatch gotcha** (confirmed in RustFS's own docs): a presigned URL is only valid for the exact host:port it was signed for. The Hono server runs in the same Docker network as RustFS, but the *browser* needs to reach RustFS at whatever host/port is externally reachable — for local dev that's `http://localhost:9000` (matches `docker-compose.yml`'s port mapping), so `RUSTFS_ENDPOINT` must be set to that, not an internal Docker service name like `http://rustfs:9000`. If server and RustFS end up on different reachable hostnames later, `RUSTFS_ENDPOINT` must be whatever hostname the browser will use.

## Bucket creation + public-read policy (one-time, on server startup)

The `attachments` bucket doesn't exist until something creates it, and a newly created bucket is private by default — `fileUrl` (the plain, unsigned URL stored on each row, see "Confirm" below) would 403 for the recipient without a public-read policy applied.

Both steps happen in code, in `server/src/index.ts`, right after `db`/app setup and before the server starts listening — not a manual console step, so a fresh checkout works with just `docker compose up` + `bun run dev`. An `ensureAttachmentsBucket()` function: check whether the bucket exists (a `HeadBucketCommand` that either succeeds or throws), create it if the check throws, then unconditionally apply a bucket policy granting anonymous `s3:GetObject` only on `attachments/*` (read-only, object-level — no list, no write, no bucket-level access) via `PutBucketPolicyCommand`. The existence check first is what makes this idempotent across restarts — attempting to create an already-existing bucket on every server boot would otherwise throw. Call this once at startup, awaited, before the server starts listening.

## New endpoint: `POST /messages/attachment/presign`

Added to `server/src/routes/messages.ts` (same file as Phase 2's other routes, same `messagesRoute`/`messagesTable` naming).

Body: `clientId`, `fromUsername`, `toUsername`, `fileName`, `fileType`.

Looks up both users by username (400 if either is missing), builds an object key from `clientId` and `fileName` (e.g. `${clientId}-${fileName}`, guaranteeing uniqueness since `clientId` is a UUID), generates a presigned PUT URL for that key with a short expiry (5 minutes is enough for a direct browser upload), and returns `{ putUrl, key }`.

This does **not** insert a `messagesTable` row yet — the row is only created once the upload actually succeeds (see "Confirm" below), otherwise a failed/abandoned upload would leave a phantom message the recipient could never fetch.

## New endpoint: `POST /messages/attachment/confirm`

Called by the client after the presigned PUT succeeds. Body: `clientId`, `fromUsername`, `toUsername`, `fileName`, `fileType`, `key`.

Looks up both users by username (400 if either is missing), builds `fileUrl` from `RUSTFS_PUBLIC_ENDPOINT` (or the same default endpoint) + bucket + key, inserts a row with `clientId`, `fromUserId`, `toUserId`, `fileName`, `fileType`, `fileUrl`, then calls `notifyUser(toUsername, { type: 'new-message', message: row, fromUsername })` (same shape and reasoning as Phase 2's text-message push) and returns the row.

`fileUrl` stored here is a plain, unsigned object URL — this relies on the public-read policy `ensureAttachmentsBucket()` applies at startup. A tighter setup would generate a fresh presigned GET on every fetch instead; skipped here for simplicity, since this is a learning app with no sensitive data.

## Client: `sendFile`'s failover branch

Presign → direct browser PUT to RustFS → confirm, in sequence: call the presign endpoint with the same fields as above, `PUT` the raw file body to the returned `putUrl` with the file's content type as the header, then call the confirm endpoint with the same fields plus the returned `key`. This replaces the earlier, now-superseded design of a multipart upload proxied through Hono — the requirement is a direct client-to-storage upload, and this is what satisfies it. See Phase 4 for how this branch fits into the overall send pipeline (including the ack-timeout fallback that governs whether this branch is taken at all).

## Verification

1. `POST /messages/attachment/presign` with known usernames and file metadata — confirm a `putUrl` and `key` come back.
2. `PUT` a small test body directly to that `putUrl` — confirm success (this is what the browser does).
3. `POST /messages/attachment/confirm` with the same fields plus that `key` — confirm the row comes back with a `fileUrl`.
4. `GET /messages?peer=&self=` (Phase 2) — confirm the recipient sees the row, then fetch the plain `fileUrl` directly and confirm it returns the uploaded bytes.
5. Same two-sided ack flow as any other failover message (Phase 2) applies here too — recipient acks (pushes `message-acked` to the sender, live or queued), sender acks-in-turn to delete the row.
