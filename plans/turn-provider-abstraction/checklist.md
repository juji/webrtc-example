## Context

`server/src/routes/turn.ts` only knows one TURN vendor (Metered) — the URL, the auth model, and the response shape are all hardcoded to Metered's REST API. Goal: make the TURN vendor swappable via config, covering every vendor worth supporting, without the client needing to know or care which one is active.

Decided:
- **Every vendor gets its own `*_SERVICE` env var** (`COTURN_SERVICE`, `CF_SPEED_SERVICE`, `OPENRELAY_SERVICE`, `METERED_SERVICE`, `TWILIO_SERVICE`, `XIRSYS_SERVICE`, `EXPRESSTURN_SERVICE`), not a single `TURN_PROVIDER=name` selector — the active provider is inferred from which `*_SERVICE` var(s) are actually filled in.
- **Exactly one provider is used per request, even if multiple `*_SERVICE` vars are filled in at once** — resolved by a fixed, deterministic priority order over the provider list (self-hosted coturn first, since that's the one under direct control; public/commercial vendors after). Same input every time picks the same provider, always — no runtime/per-request selection, no separate selector env var.
- **No standard client-facing API exists across TURN vendors.** The TURN wire protocol (RFC 5766/8656) and coturn's `use-auth-secret` HMAC scheme (the expired "TURN REST API" IETF draft: `username = timestamp:userid`, `credential = base64(HMAC-SHA1(secret, username))`) are the closest things to a convention, and several vendors (coturn, Metered) follow it — but each vendor still exposes its own bespoke REST endpoint and response shape on top. This is exactly why a per-vendor adapter layer is needed server-side.
- **Provider list is open-ended by design** — each vendor is one small adapter (its own request/response shape mapped to the common `iceServers` output) registered in a list, so adding a vendor later (Xirsys, ExpressTURN, etc.) is a new adapter + one new env var, not a rewrite of the dispatch logic.
- **coturn runs in Docker via `network_mode: host`**, not port-mapped — a TURN relay needs a wide UDP port range plus the actual public/LAN IP it announces to match what it's bound to; host networking is the only practical way to get that in Docker for now. Real internet-facing NAT traversal (a genuine public IP) is out of scope until this is actually deployed somewhere reachable — LAN/localhost testing is the target for this phase.
- Regardless of which provider is active, `/turn/credentials` always returns the same `{ iceServers }` shape the client already consumes — the client (`use-webrtc-chat.ts`'s `fetchIceServers`) needs zero changes.

## Phase 1 — Infra: coturn in docker-compose

detail: [phase-1-coturn-infra.md](phase-1-coturn-infra.md)
- [ ] **Add `coturn` service to `docker-compose.yml`** — `network_mode: host`, `use-auth-secret` configured
- [ ] Verified: coturn accepts a connection and issues a relay allocation on the local network

## Phase 2 — Server: provider abstraction in turn.ts

detail: [phase-2-provider-abstraction.md](phase-2-provider-abstraction.md)
- [ ] **Define the provider adapter shape** — each vendor is a small module: reads its own `*_SERVICE` env var(s), returns `iceServers` in the common shape
- [ ] **Build adapters for the named vendors**: `COTURN_SERVICE` (HMAC-derived credentials), `CF_SPEED_SERVICE` (Cloudflare's `speed.cloudflare.com/turn-creds`), `OPENRELAY_SERVICE`, `METERED_SERVICE` (existing logic, ported into the adapter shape), `TWILIO_SERVICE` (Twilio's Network Traversal Service, `ice_servers` response), `XIRSYS_SERVICE` (Xirsys's `_turn` REST API), `EXPRESSTURN_SERVICE` (ExpressTURN's credential API)
- [ ] **Fixed priority-order dispatch** — `/turn/credentials` walks the provider list in a set order, uses the first one whose env var(s) are filled in

## Phase 3 — Verify end-to-end

detail: [phase-3-verify.md](phase-3-verify.md)
- [ ] **Cloudflare**: confirm relay candidates via `turn-cf/test-turn.mjs`-style check (already proven working manually)
- [ ] **coturn**: same relay-candidate check, against the local Docker coturn instance
- [ ] **OpenRelay / Metered / Twilio / Xirsys / ExpressTURN**: same relay-candidate check, against each vendor's live service
- [ ] **App**: confirm a real chat session connects (data channel opens) with each provider active, one at a time
- [ ] **Priority order**: confirm that with multiple `*_SERVICE` vars filled in, the same one always wins, per the fixed order
