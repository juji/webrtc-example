# primssg-db

Shared data-layer package: `PrimssgDB`, an abstract class defining every storage operation the app needs (keys, contacts, chats — later convos), with one method per real call site traced from `client/lib/keys.ts`, `client/lib/contacts.ts`, `client/lib/chats.ts`. No `query()`/raw-SQL escape hatch — callers never write SQL, every operation is its own named, typed method.

Exists so the web build and a future Tauri desktop build can share one schema and one query layer instead of two divergent data models. See `plans/sqlite-migration/checklist.md` for the full plan and reasoning.

## Conventions

- Filenames: lowercase kebab-case, matching the rest of this repo.
- `PrimssgDB` (`src/primssg-db.ts`) is interface-only — abstract methods, no implementation. Concrete backends (`PrimssgDBWasm` for web, a future native backend for Tauri) extend it in their own files.
- Before adding a method to `PrimssgDB`, trace a real call site first (an existing function in `client/lib/keys.ts`/`contacts.ts`/`chats.ts`, or wherever the caller actually lives) — don't add speculative methods ahead of a real need.
- Types (`src/types.ts`) are ported from the client's existing types (`KeyBundle`, `Contact`, `Conversation`) — keep them in sync in shape, but this package doesn't import from `client/`.

## Inspecting live data

The SQLite database (OPFS/SAHPool-backed) lives entirely inside the browser's storage — there is no server-side file or endpoint that can read it. The only way to inspect it is through a real browser.

- **`client/app/dev/sqlite/page.tsx`** — a dev-only page that connects a fresh `PrimssgDBWasm` and runs arbitrary SQL via `debugQuery()` (a raw-SQL escape hatch that exists only on `PrimssgDBWasm`, not on the `PrimssgDB` interface real callers use). Requires the dev server running under Webpack (`next dev --webpack`, already the `client` `dev` script — Turbopack cannot statically resolve `@sqlite.org/sqlite-wasm`'s internal Worker construction, confirmed not fixed even on a Next.js canary build past the relevant upstream PR).
- **`scripts/query.mjs`** — drives a headless Playwright browser to `/dev/sqlite`, runs one query, prints the result as JSON. Run: `bun run packages/primssg-db/scripts/query.mjs "SELECT * FROM keys"` (dev server must already be running). This is the way to check real DB state from the terminal — including for an agent — without opening an actual browser window.
