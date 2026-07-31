# Phase 9 — Cross-vendor checks

## Why this phase exists

Phases 3–8 each verify one vendor in isolation (its own env vars set, everything else unset). This phase checks properties that only make sense once multiple vendors' adapters coexist in the same `providers` array — the priority-order guarantee, and the app actually working end-to-end with the abstraction in place, not just the isolated `curl`+relay-candidate checks each vendor phase already did.

## Priority order check

- [ ] With **two or more** `*_SERVICE` vars set simultaneously (e.g. both `COTURN_SERVICE` and `METERED_SERVICE`), confirm `/turn/credentials` always returns coturn's servers (first in priority order, per checklist.md and Phase 2's fixed array order) — call the endpoint multiple times, confirm the response is identical every time, not alternating or random.
- [ ] With **all six** `*_SERVICE` vars set at once, confirm coturn still wins — the highest-priority provider being selected shouldn't depend on how many others are also configured.

## App-level check

- [ ] With `COTURN_SERVICE` active (and only that one), open two chat sessions (same machine, per Phase 1's LAN/localhost scope) and confirm `connected` flips true in `chat/[username]/page.tsx` — proof the whole path (server hands out coturn credentials → browser's ICE agent uses them → data channel opens) works, not just that a relay candidate was gathered in isolation.
- [ ] Repeat with `NEXT_PUBLIC_ICE_TRANSPORT_POLICY=relay` set (forces the connection through TURN specifically, no direct/host fallback — see `use-webrtc-chat.ts`) — the strictest possible proof that coturn's relay is actually carrying the data channel's traffic, not just present as one of several candidates that direct connectivity happened to route around.
- [ ] Spot-check at least one commercial vendor (e.g. Twilio, since it's the only SDK-based integration and thus has a different failure mode than the `fetch`-based ones) the same way — `EXPRESSTURN_SERVICE` etc. unset, only `TWILIO_SERVICE`/`TWILIO_AUTH_TOKEN` set, confirm the app connects end-to-end.

## Cleanup

- [ ] Once all checks pass, unset every `*_SERVICE` env var except whichever one should be the actual default for this project going forward (a decision for whoever's deploying this, not part of this plan) — leaving all six set permanently in `server/.env` after verification is done would make `/turn/credentials`'s behavior needlessly opaque (always picks the same one, but for a non-obvious reason to anyone reading `.env` later).

## Verification results

All checks passed:
- Priority order held with 2+ vars set (coturn + Metered) and with all six set simultaneously — `/turn/credentials` returned identical coturn credentials across repeated calls each time.
- App-level: real two-session Playwright chat (`e2e/chat.test.mjs`) passed against local coturn with default `iceTransportPolicy`, then again with `NEXT_PUBLIC_ICE_TRANSPORT_POLICY=relay` forced (`client/.env.local`) — messages and a file attachment exchanged over the data channel both times.
- Twilio spot-check (only `TWILIO_SERVICE`/`TWILIO_AUTH_TOKEN` set, relay still forced) also passed end-to-end.
- Along the way, `client/.env.local`'s `NEXT_PUBLIC_SERVER_URL` was found pointed at a remote prod host (`webrtc-server.jujitest.com`) rather than the local dev server — changed permanently to `http://localhost:4000` per explicit instruction, since testing this phase against prod rather than the local abstraction under test would have been the wrong target.
- Cleanup: `server/.env` left with `COTURN_SERVICE`/`COTURN_SECRET` as the sole active vendor (chosen as the deployed default — self-hosted, most control), all other vendors' vars commented out but preserved for reference.
