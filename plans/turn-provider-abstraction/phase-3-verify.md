# Phase 3 — Verify end-to-end

## Approach

Same method `turn-cf/test-turn.mjs` already proved out for Cloudflare: fetch credentials, build a real `RTCPeerConnection` in a headless Playwright browser, gather ICE candidates, and check for a `type: 'relay'` candidate — presence of a relay candidate is proof the vendor's TURN server actually accepted the credentials and allocated a relay, not just that the credential-fetch API call succeeded.

Generalize `test-turn.mjs` into a small reusable checker (`turn-cf/test-turn.mjs` → move/rename to `turn-cf/check-provider.mjs`, parameterized by which `/turn/credentials`-shaped response to test) rather than one hardcoded script per vendor — the browser-driving logic (lines 11–68 of the current script) is identical regardless of vendor; only how credentials are obtained differs.

```bash
# Against the running dev server, once Phase 2 is live:
curl http://localhost:4000/turn/credentials
```

Feed that response's `iceServers` into the same Playwright-driven relay-candidate check, once per vendor, by temporarily setting only that vendor's `*_SERVICE` env var (per checklist.md's priority-order rule — only one provider is ever active per request) and restarting the server between checks.

## Per-vendor checks

- [ ] **`COTURN_SERVICE`** only set — confirm a relay candidate appears, `address`/`port` matching the local coturn instance's advertised host and the `min-port`–`max-port` range from Phase 1.
- [ ] **`CF_SPEED_SERVICE`** only set — already proven manually working (see `turn-cf/test-turn.mjs`'s prior output); re-run once ported through `/turn/credentials` to confirm the adapter's output shape didn't break anything in translation.
- [ ] **`OPENRELAY_SERVICE`** only set — confirm relay candidate via OpenRelay's current Metered-hosted API.
- [ ] **`METERED_SERVICE`** only set — confirm relay candidate; this is the pre-existing, already-working integration, so this check is primarily "did the port to the adapter shape preserve behavior," not "does Metered work."
- [ ] **`TWILIO_SERVICE`** only set — confirm relay candidate; also confirms the `ice_servers` passthrough mapping (plural `urls`, `credential` field) is correct, since a malformed shape would show up as zero candidates or a browser-side ICE error rather than a clean failure.
- [ ] **`XIRSYS_SERVICE`** only set — confirm relay candidate; also confirms the single-object-not-array unwrapping (`[response.v.iceServers]`) is correct.
- [ ] **`EXPRESSTURN_SERVICE`** only set — confirm relay candidate against the static long-term credentials.

## Priority order check

- [ ] With **two or more** `*_SERVICE` vars set simultaneously (e.g. both `COTURN_SERVICE` and `METERED_SERVICE`), confirm `/turn/credentials` always returns coturn's servers (first in priority order) — call the endpoint multiple times, confirm the response is identical every time, not alternating or random.

## App-level check

- [ ] With `COTURN_SERVICE` active, open two chat sessions (same machine, per Phase 1's LAN/localhost scope) and confirm `connected` flips true in `chat/[username]/page.tsx` — proof the whole path (server hands out coturn credentials → browser's ICE agent uses them → data channel opens) works, not just that a relay candidate was gathered in isolation.
- [ ] Repeat with `iceTransportPolicy: "relay"` set on the client's `RTCPeerConnection` (forces the connection through TURN specifically, no direct/host fallback) — the strictest possible proof that a given vendor's TURN relay is actually carrying the data channel's traffic, not just present as one of several candidates that direct connectivity happened to route around.

## Cleanup

Once all checks pass, unset every `*_SERVICE` env var except whichever one should be the actual default for this project going forward (a decision for whoever's deploying this, not part of this plan) — leaving all seven set permanently in `server/.env` after verification is done would make `/turn/credentials`'s behavior needlessly opaque (always picks the same one, but for a non-obvious reason to anyone reading `.env` later).
