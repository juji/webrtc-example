## Context

Supersedes `plans/dexie-migration` (nothing implemented there — see its SUPERSEDED note). Every client-side store today (`client/lib/keys.ts`, `client/lib/contacts.ts`, `client/lib/chats.ts`) is raw IndexedDB. Decided to move to SQLite instead of Dexie/IndexedDB, because a Tauri desktop build is a real future target for this app, and Tauri gets native SQLite (via `tauri-plugin-sql` or a Rust command) rather than a browser API — building on SQLite now means the web and desktop builds can share one schema and one query layer, instead of maintaining an IndexedDB-shaped web store that would need its own separate migration once Tauri happens.

Shape: `PrimssgDB` (abstract base/interface — method signatures only, e.g. `getKeys`, `addContact`, whatever each phase actually needs) with `PrimssgDBWasm extends PrimssgDB` as the one concrete implementation for now: SQLite Wasm via OPFS/SAHPool, running in a worker. The interface isn't speculative here despite there being only one implementation yet: both the web (Wasm-in-worker) and future Tauri (native SQLite via `tauri-plugin-sql` or a Rust command) backends are called from the *same JS/TS calling code* either way — Tauri's frontend is the same React/Next.js output, just talking to Rust over IPC instead of a Wasm worker over `postMessage`. The two backends were confirmed to need identical method shapes, so defining that shape once, upfront, is just describing what's actually true, not designing ahead of need. When Tauri happens, `PrimssgDBNative extends PrimssgDB` (name TBD) slots in beside it. Dexie is still not part of this design — it can't speak the same SQL as a real SQLite backend, so it can't honestly implement this interface without becoming its own translation layer.

SQLite Wasm+OPFS requires running in a Worker — `createSyncAccessHandle` (the sync file-access API SQLite's OPFS VFS needs) only works inside a dedicated Web Worker, on every browser, never the main thread. This is a bigger structural change than the old Dexie plan assumed, since `keys.ts`/`contacts.ts`/`chats.ts`'s current simple async-function-call shape needs to become a worker + message-passing layer.

Browser support checked (2026): OPFS sync-access-handle support is Baseline-solid everywhere — Chrome/Edge 108+, Firefox 111+, Safari 16.4+ (macOS and iOS), full method set on all. The earlier "Safari might be behind" concern from `plans/dexie-migration` no longer holds; not a blocker.

**VFS decided: SAHPool**, not the standard OPFS VFS. The app will load third-party map tiles (cross-origin), and the standard OPFS VFS requires `SharedArrayBuffer`, which requires COOP/COEP response headers — COEP specifically requires every subresource the page loads to opt in (same-origin, or an explicit `Cross-Origin-Resource-Policy: cross-origin` from the third party, or proxied through this app's own origin). Map tile providers (Mapbox, MapTiler, OSM, etc.) generally don't send that header, so enabling COEP would likely break map tiles outright rather than just complicate them — and proxying every tile request through this app's own server was considered and rejected (added infra, latency, and cost for a feature that already works directly). SAHPool needs no COOP/COEP at all, so it doesn't touch the map tiles feature. Tradeoff accepted: SAHPool locks the database to one tab at a time (no real multi-tab concurrency) — acceptable since this app is single-tab/single-account-per-session in practice today.

## Phase 0 — `PrimssgDB` interface + `PrimssgDBWasm` implementation

- [x] **`packages/primssg-db` workspace created** — new Bun workspace, root `package.json`'s `workspaces` gained `"packages/*"`; `packages/primssg-db/package.json` scaffolded (name `primssg-db`, points at `src/index.ts`, not yet written). `client`/`server` can now depend on it as `"primssg-db": "workspace:*"` once there's something to import.
- [ ] `PrimssgDB` interface + `PrimssgDBWasm` implementation itself — TBD

## Phase 1 — Worker + OPFS wiring for the web backend

- [ ] TBD
- [ ] **Second-tab detection.** SAHPool locks the DB to one tab; a second tab must be detected *before* attempting to open it, not left to surface SAHPool's raw acquisition error. Each tab requests a `navigator.locks.request("primssg-db", { ifAvailable: true }, ...)` Web Lock on load — the tab that gets it opens the DB normally, any tab that gets `null` back shows an "already open in another tab" state instead (same pattern as Notion/Figma/Linear's single-instance local apps).

## Phase 2 — Migrate `webrtc-keys` to `PrimssgDB`

- [ ] TBD

## Phase 3 — Migrate `webrtc-contacts` to `PrimssgDB`

- [ ] TBD

## Phase 4 — Migrate `webrtc-chats` to `PrimssgDB`

- [ ] TBD

## Phase 5 — Verify + resume `plans/convo`

- [ ] TBD
