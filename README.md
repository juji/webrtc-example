# webrtc

Post-quantum encrypted 1:1 chat over WebRTC, with a Hono server for signaling, contact discovery, and server-relay failover when a direct P2P connection can't be established.

## Structure

Bun monorepo:

- `client/` — Next.js app (App Router)
- `server/` — Hono API + WebRTC signaling
- `packages/primssg-db/` — client-side SQLite (via OPFS) for local message/contact storage
- `e2e/` — Playwright end-to-end tests
- `plans/` — design discussions, not implementation plans (see each folder's `discussion.md`)

## Prerequisites

- [Bun](https://bun.sh)
- Docker (for Postgres, RustFS, and coturn — see `docker-compose.yml`)

## Setup

1. Install dependencies:
   ```
   bun install
   ```
2. Copy env files and fill them in:
   ```
   cp .env.example .env
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```
   See each `.env.example` for what every variable does. At minimum you need `COTURN_SECRET`/`COTURN_EXTERNAL_IP` (root), `JWT_SECRET` (server), and VAPID keys (server, for push — generate with `bunx web-push generate-vapid-keys`).
3. Run everything:
   ```
   bun run dev
   ```
   This starts the Docker services (Postgres, RustFS, coturn), waits for Postgres/RustFS to be ready, pushes the DB schema, and runs both the client and server dev servers.

The app is then at `http://localhost:3000`.

## Attachment storage: a second config surface beyond `.env` (local dev)

Message attachments are stored in an S3-compatible bucket (RustFS locally, via `docker-compose.yml`'s `rustfs` service — **`docker-compose.yml` is dev-only tooling, not a production deployment path**). **The bucket itself and its lifecycle (expiry) rule are not `.env` config — they're infra, provisioned separately.**

- `docker-compose.yml`'s `rustfs-init` service creates the `attachments` bucket and attaches a 1-day object-expiry lifecycle rule automatically on `docker compose up`, via the `rustfs/rc` CLI image. This exists purely to make local dev self-contained — it only targets the local `rustfs` compose service.
- The server never creates buckets or lifecycle rules itself (`server/src/storage.ts` just points an `S3Client` at whatever `RUSTFS_ENDPOINT` is set to and assumes the bucket already exists).
- **Whatever S3-compatible storage is actually used in production is a separate, unrelated setup** — this repo has no production infra config at all. Provisioning that bucket and its lifecycle rule is part of standing up that environment, not something `.env` or `docker-compose.yml` does for you.
- Why a lifecycle rule at all: the server used to delete attachment objects itself (`DELETE /messages/:id`), but that only worked because it could read the S3 key back out of the stored `file` metadata — a design that breaks once that metadata is encrypted (see `plans/encryption/discussion.md`). Expiry is now the bucket's job, not the app's.

## Testing

```
bun run test:e2e
```

## Useful scripts

- `bun run dev` — start the full stack (see `dev.sh`)
- `bun run wipe` — tear down Docker services and delete their volumes (Postgres data, RustFS data)
