# Phase 2 — Server: provider abstraction in turn.ts

## Files

`server/src/routes/turn.ts` (rewritten), `server/src/turn-providers/*.ts` (new — one file per vendor)

## The adapter shape

Each vendor is a function with the same signature:

```ts
type TurnProvider = {
  isConfigured: () => boolean
  getIceServers: () => Promise<RTCIceServerLike[]>
}
```

`RTCIceServerLike` = `{ urls: string | string[]; username?: string; credential?: string }` — the shape `RTCPeerConnection`'s `iceServers` option expects, defined once and reused across all adapters (not the DOM `RTCIceServer` type, since this runs server-side with no DOM lib).

`isConfigured()` checks whether that vendor's env var(s) are actually filled in — cheap, synchronous, no network call. `getIceServers()` does the real work (HMAC computation, or a `fetch` to the vendor's API) and throws on failure; the dispatcher (below) is what decides what happens when a provider throws.

## `/turn/credentials`'s dispatch logic

```ts
const providers = [coturn, cfSpeed, openRelay, metered, twilio, xirsys, expressTurn] // fixed order
```

On each request: walk `providers` in this fixed order, call `isConfigured()` on each, use the **first** one that returns `true` — call its `getIceServers()`, return `{ iceServers }`. If none are configured, `500` (matches the existing "not configured" error shape). If the selected provider's `getIceServers()` throws (vendor API down, bad credentials), `502` (matches the existing failure shape) — **no fallback to the next provider in the list**, since that would make behavior depend on which vendors happen to be down at the moment, defeating the "same input, same provider, every time" guarantee from checklist.md.

Order, self-hosted first: `coturn` (own infra, most control) → `cfSpeed` → `openRelay` → `metered` → `twilio` → `xirsys` → `expressTurn` (remaining commercial vendors, alphabetical — no functional reason to prefer one over another once coturn/free-tier options are exhausted).

## Per-vendor adapter details

### `coturn` — `server/src/turn-providers/coturn.ts`

Env: `COTURN_SERVICE` (the host:port clients should connect to, e.g. `localhost:3478` for local dev — this is what appears in the `turn:` URL, not the Docker service name), `COTURN_SECRET` (Phase 1's shared HMAC key).

`isConfigured()`: both env vars present.

`getIceServers()`: no network call — credentials are computed locally, per the TURN REST API convention coturn's `--use-auth-secret` implements ([draft-uberti-behave-turn-rest-00](https://datatracker.ietf.org/doc/html/draft-uberti-behave-turn-rest-00), confirmed against coturn's own README):

```ts
import { createHmac } from 'node:crypto'

const TTL_SECONDS = 3600
const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS
const username = `${expiry}:webrtc` // "webrtc" as a fixed userid — no per-user identity needed here
const credential = createHmac('sha1', secret).update(username).digest('base64')

return [{ urls: `turn:${host}`, username, credential }]
```

The HMAC is **SHA1** specifically (coturn doesn't support SHA256 for this scheme — confirmed against coturn's README, don't substitute), and the digest is base64 of the raw bytes, not hex. The `timestamp` in `username` is the **expiry** time, not issue time — `time(NULL)` at which the credential stops being valid, per coturn's own docs.

### `cfSpeed` — `server/src/turn-providers/cf-speed.ts`

Env: `CF_SPEED_SERVICE` (any truthy value enables it — this endpoint needs no API key, so the env var is just an on/off switch, e.g. `CF_SPEED_SERVICE=1`).

`getIceServers()`: `fetch('https://speed.cloudflare.com/turn-creds', { headers: { Origin: 'https://speed.cloudflare.com' } })` — same call already proven working in `turn-cf/test-turn.mjs`. Response is `{ urls, username, credential }` (a single object, not an array) — wrap: `[{ urls, username, credential }]`.

This is Cloudflare's own speed-test page's TURN endpoint, not an official public API — no SLA, could change or disappear. Acceptable for this project's "cover every vendor worth supporting" goal, but not something to depend on for anything production-critical.

### `openRelay` — `server/src/turn-providers/open-relay.ts`

Env: `OPENRELAY_SERVICE` (Metered's app name for the OpenRelay project specifically — Metered hosts OpenRelay's current API, distinct from the `METERED_SERVICE` adapter below which is a *different* Metered app/account).

`getIceServers()`: `GET https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}` — needs both an app name and API key env var (`OPENRELAY_SERVICE` for the app name, `OPENRELAY_API_KEY` for the key), same shape as the existing Metered integration below since OpenRelay's current hosted API *is* Metered's API under a different account. Response is already a bare `RTCIceServer[]` — no transformation, `iceServers = await res.json()`.

The old static `openrelayproject`/`openrelayproject`@`openrelay.metered.ca` pair some tutorials still reference is deprecated — don't hardcode it.

### `metered` — `server/src/turn-providers/metered.ts`

Env: `METERED_SERVICE` (app name, replaces `METERED_APP_NAME`), `METERED_API_KEY` (unchanged name, already exists).

This is the existing `turn.ts` logic, ported unchanged into the adapter shape — same endpoint (`GET https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`), same response passthrough.

### `twilio` — `server/src/turn-providers/twilio.ts`

Env: `TWILIO_SERVICE` (Account SID), `TWILIO_AUTH_TOKEN`.

`getIceServers()`: `POST https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Tokens.json`, `Authorization: Basic ${base64(accountSid + ':' + authToken)}`, `Content-Type: application/x-www-form-urlencoded` (body can be empty — `Ttl` param is optional, defaults to 86400s). Response's `ice_servers` field is already `RTCIceServer[]`-shaped (plural `urls`, `credential` not `password`) — pass through directly: `(await res.json()).ice_servers`.

### `xirsys` — `server/src/turn-providers/xirsys.ts`

Env: `XIRSYS_SERVICE` (ident), `XIRSYS_SECRET`, `XIRSYS_CHANNEL` (the named channel/application in Xirsys's dashboard).

`getIceServers()`: `PUT https://global.xirsys.net/_turn/${channel}`, `Authorization: Basic ${base64(ident + ':' + secret)}`, `Content-Type: application/json`, body `{"format":"urls"}`. Response shape is `{ v: { iceServers: { urls: [...], username, credential } }, s: "ok" }` — **`v.iceServers` is a single object, not an array** (confirmed against Xirsys's modern `format:"urls"` response shape). Check `s === 'ok'` before using `v`; wrap the single object: `[response.v.iceServers]`.

### `expressTurn` — `server/src/turn-providers/express-turn.ts`

Env: `EXPRESSTURN_SERVICE` (host:port, e.g. `relay1.expressturn.com:3478`), `EXPRESSTURN_USERNAME`, `EXPRESSTURN_PASSWORD`.

No REST API — ExpressTURN issues static long-term credentials via their dashboard, not a live credential-issuing endpoint (confirmed: their free/standard tier has no API; only their Premium tier exposes a shared-secret HMAC option, which would need its own separate adapter if ever used — not built here since it requires a paid tier to verify against).

`getIceServers()`: no network call, just returns the static pair from env: `[{ urls: `turn:${host}`, username, credential: password }]`.

## Shared error handling

Every adapter's `getIceServers()` can throw (network failure, non-2xx response, unexpected shape). The dispatcher in `turn.ts` wraps the call in `try`/`catch` and returns `502` with the vendor's name in the error message (`` `${provider.name} TURN request failed` ``) — useful for knowing which vendor broke without needing to inspect server logs.

## Verification

Covered by Phase 3 (live relay-candidate checks per vendor) — Phase 2's own scope is the code compiling and each adapter's `isConfigured()`/`getIceServers()` being independently callable, not live network verification.
