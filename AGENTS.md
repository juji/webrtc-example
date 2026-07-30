# WebRTC Chat Example

A minimal example app: username-only auth, user search, and 1:1 WebRTC chat.

## Structure

Bun monorepo, two workspaces:

- `client/` — Next.js app (App Router)
- `server/` — Hono API + WebRTC signaling

Run everything from the root with `bun run dev`.

## Auth

No passwords. A single username field doubles as both register and login:

- Submit a username.
- If it doesn't exist, create it and log in.
- If it exists, just log in as it (no password check).

## Flow

1. User lands on the app, enters a username (register/login form).
2. Once logged in, user can search for other registered users.
3. Selecting a user opens a chat with them, over WebRTC (data channel), using the server for signaling.

## Data

- Postgres via Docker Compose (see `docker-compose.yml` at repo root).
- Users table: id, username (unique), created_at. Nothing else — no passwords, no profiles.

## Conventions

- Filenames: lowercase kebab-case.
- Match existing code style already in `client/` and `server/` — both are fresh framework installs, don't fight their defaults.
- Keep it minimal: no auth tokens/sessions beyond what's needed to know who's "logged in" client-side, no features not listed above.
