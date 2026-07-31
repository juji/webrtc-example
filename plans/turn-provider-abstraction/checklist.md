## Context

`server/src/routes/turn.ts` only knows one TURN vendor (Metered) — the URL, the auth model, and the response shape are all hardcoded to Metered's REST API. Goal: make the TURN vendor swappable via config, covering every named vendor, without the client needing to know or care which one is active.

Decided:
- **Every vendor gets its own `*_SERVICE` env var** (`COTURN_SERVICE`, `CF_SPEED_SERVICE`, `METERED_SERVICE`, `TWILIO_SERVICE`, `XIRSYS_SERVICE`, `EXPRESSTURN_SERVICE`), not a single `TURN_PROVIDER=name` selector — the active provider is inferred from which `*_SERVICE` var(s) are actually filled in.
- **Exactly one provider is used per request, even if multiple `*_SERVICE` vars are filled in at once** — resolved by a fixed, deterministic priority order (self-hosted coturn first, since that's the one under direct control; public/commercial vendors after). Same input every time picks the same provider, always — no runtime/per-request selection, no separate selector env var.
- **No standard client-facing API exists across TURN vendors.** The TURN wire protocol (RFC 5766/8656) and coturn's `use-auth-secret` HMAC scheme (the expired "TURN REST API" IETF draft: `username = timestamp:userid`, `credential = base64(HMAC-SHA1(secret, username))`) are the closest things to a convention, and a couple of vendors (coturn, Metered) follow it — but each vendor still exposes its own bespoke REST endpoint and response shape on top. This is exactly why a per-vendor adapter is needed, and why each vendor gets its own phase below rather than being batched.
- **Each vendor is its own phase**, covering both its adapter code and its own live verification together — not a shared "build all adapters" phase followed by a shared "verify all" phase. A vendor is genuinely done (built and proven working) before moving to the next one; a broken/changed vendor integration later doesn't require touching a shared verification phase that covers five other, unrelated vendors.
- **Twilio uses the official `twilio` npm SDK** (`client.tokens.create()`) — the only one of the six vendors with a real, maintained SDK method for TURN credential generation (confirmed via npm survey). The other five are hand-rolled `fetch`/HMAC — no viable SDK exists for any of them (checked and confirmed per-vendor, including official-looking packages that turned out unmaintained or nonexistent).
- **coturn runs in Docker via `network_mode: host`**, not port-mapped — a TURN relay needs a wide UDP port range plus the actual public/LAN IP it announces to match what it's bound to; host networking is the only practical way to get that in Docker for now. Real internet-facing NAT traversal (a genuine public IP) is out of scope until this is actually deployed somewhere reachable — LAN/localhost testing is the target for this phase.
- Regardless of which provider is active, `/turn/credentials` always returns the same `{ iceServers }` shape the client already consumes — the client (`use-webrtc-chat.ts`'s `fetchIceServers`) needs zero changes across every phase below.
- **OpenRelay is not covered as its own vendor.** It's Metered's hosted platform under a separate account (same endpoint shape as the `metered` adapter) — without a real OpenRelay signup to verify against, it was dropped rather than shipped as unverified/dead code. Revisit if a real OpenRelay account is ever obtained.

## Phase 1 — Infra: coturn in docker-compose

detail: [phase-1-coturn-infra.md](phase-1-coturn-infra.md)
- [x] **Add `coturn` service to `docker-compose.yml`** — `network_mode: host`, `use-auth-secret` configured
- [x] Verified: coturn accepts a connection and issues a relay allocation on the local network

## Phase 2 — Server: shared dispatch plumbing

detail: [phase-2-dispatch.md](phase-2-dispatch.md)
- [x] **Define the provider adapter shape** — `TurnProvider` type (`isConfigured()`/`getIceServers()`), shared across every vendor phase that follows
- [x] **Fixed priority-order dispatch in `/turn/credentials`** — walks the provider list in a set order, uses the first one whose env var(s) are filled in, no fallback on failure
- [x] **Shared error handling** — a provider's `getIceServers()` throwing returns `502` naming that vendor, no silent fallback to the next one in the list

## Phase 3 — Vendor: coturn

detail: [phase-3-coturn.md](phase-3-coturn.md)
- [x] **`server/src/turn-providers/coturn.ts`** — HMAC-SHA1 credentials per the TURN REST API convention, no network call
- [x] Verified: relay candidate gathered against the local Docker coturn instance from Phase 1

## Phase 4 — Vendor: Cloudflare (CF Speed)

detail: [phase-4-cf-speed.md](phase-4-cf-speed.md)
- [x] **`server/src/turn-providers/cf-speed.ts`** — `speed.cloudflare.com/turn-creds`, unwraps the single-object response
- [x] Verified: relay candidate gathered (already proven manually via `turn-cf/test-turn.mjs`; re-confirm once routed through `/turn/credentials`)

## Phase 5 — Vendor: Metered

detail: [phase-5-metered.md](phase-5-metered.md)
- [x] **`server/src/turn-providers/metered.ts`** — existing `turn.ts` logic, ported into the adapter shape unchanged
- [x] Verified: relay candidate gathered (regression check — this integration already worked pre-refactor)

## Phase 6 — Vendor: Twilio

detail: [phase-6-twilio.md](phase-6-twilio.md)
- [x] **`server/src/turn-providers/twilio.ts`** — official `twilio` SDK, `client.tokens.create()`
- [x] Verified: relay candidate gathered

## Phase 7 — Vendor: Xirsys

detail: [phase-7-xirsys.md](phase-7-xirsys.md)
- [x] **`server/src/turn-providers/xirsys.ts`** — `PUT /_turn/{channel}`, unwraps `v.iceServers` (single object, not an array)
- [x] Verified: relay candidate gathered

## Phase 8 — Vendor: ExpressTURN

detail: [phase-8-expressturn.md](phase-8-expressturn.md)
- [x] **`server/src/turn-providers/express-turn.ts`** — static long-term credentials from env, no network call
- [x] Verified: relay candidate gathered against the static credentials

## Phase 9 — Cross-vendor checks

detail: [phase-9-cross-vendor.md](phase-9-cross-vendor.md)
- [x] **Priority order**: with multiple `*_SERVICE` vars filled in at once, confirm the same provider wins every time, per the fixed order
- [x] **App-level**: a real two-session chat connects (data channel opens) with each provider active one at a time, including with `iceTransportPolicy: "relay"` forced
- [x] **Cleanup**: unset every `*_SERVICE` var except whichever one is the actual deployed default
