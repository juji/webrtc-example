# Phase 3 — Vendor: coturn

## File

`server/src/turn-providers/coturn.ts`

## Adapter

Env: `COTURN_SERVICE` (the host:port clients should connect to, e.g. `localhost:3478` for local dev — this is what appears in the `turn:` URL, not the Docker service name), `COTURN_SECRET` (Phase 1's shared HMAC key).

`isConfigured()`: both env vars present.

`getIceServers()`: no network call — credentials are computed locally, per the TURN REST API convention coturn's `--use-auth-secret` implements ([draft-uberti-behave-turn-rest-00](https://datatracker.ietf.org/doc/html/draft-uberti-behave-turn-rest-00), confirmed against coturn's own README):

```ts
import { createHmac } from 'node:crypto'
import type { TurnProvider } from './types'

const TTL_SECONDS = 3600

export const coturn: TurnProvider = {
  name: 'coturn',
  isConfigured: () => !!(process.env.COTURN_SERVICE && process.env.COTURN_SECRET),
  async getIceServers() {
    const host = process.env.COTURN_SERVICE!
    const secret = process.env.COTURN_SECRET!
    const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS
    const username = `${expiry}:webrtc` // "webrtc" as a fixed userid — no per-user identity needed here
    const credential = createHmac('sha1', secret).update(username).digest('base64')
    return [{ urls: `turn:${host}`, username, credential }]
  },
}
```

The HMAC is **SHA1** specifically (coturn doesn't support SHA256 for this scheme — confirmed against coturn's README, don't substitute), and the digest is base64 of the raw bytes, not hex. The `timestamp` in `username` is the **expiry** time, not issue time — `time(NULL)` at which the credential stops being valid, per coturn's own docs.

## Wiring in

Add `import { coturn } from '../turn-providers/coturn'` to `turn.ts`, add `coturn` as the first entry in the `providers` array (Phase 2).

## Verification

1. Set `COTURN_SERVICE=localhost:3478` and `COTURN_SECRET` (Phase 1's value) in `server/.env`.
2. `curl http://localhost:4000/turn/credentials` — confirm `iceServers` contains a `turn:` URL with a `username` shaped like `<unix-timestamp>:webrtc` and a non-empty base64 `credential`.
3. Feed that response into the same Playwright-driven relay-candidate check `turn-cf/test-turn.mjs` uses (build a real `RTCPeerConnection`, gather ICE candidates, confirm a `type: 'relay'` candidate appears) — confirm the candidate's `address`/`port` matches the local coturn instance's advertised host and the `min-port`–`max-port` range from Phase 1.
