# Phase 4 — Vendor: Cloudflare (CF Speed)

## File

`server/src/turn-providers/cf-speed.ts`

## Adapter

Env: `CF_SPEED_SERVICE` (any truthy value enables it — this endpoint needs no API key, so the env var is just an on/off switch, e.g. `CF_SPEED_SERVICE=1`).

```ts
import type { TurnProvider } from './types'

export const cfSpeed: TurnProvider = {
  name: 'cfSpeed',
  isConfigured: () => !!process.env.CF_SPEED_SERVICE,
  async getIceServers() {
    const res = await fetch('https://speed.cloudflare.com/turn-creds', {
      headers: { Origin: 'https://speed.cloudflare.com' },
    })
    if (!res.ok) throw new Error(`cf-speed responded ${res.status}`)
    const { urls, username, credential } = await res.json()
    return [{ urls, username, credential }]
  },
}
```

Response is `{ urls, username, credential }` — a single object, not an array — hence the wrap. Same call already proven working in `turn-cf/test-turn.mjs`.

This is Cloudflare's own speed-test page's TURN endpoint, not an official public API — no SLA, could change or disappear. Acceptable for this project's goal of covering every named vendor, but not something to depend on for anything production-critical.

## Wiring in

Add `import { cfSpeed } from '../turn-providers/cf-speed'` to `turn.ts`, add `cfSpeed` as the second entry in the `providers` array (Phase 2), after `coturn`.

## Verification

1. Set `CF_SPEED_SERVICE=1` in `server/.env` (and unset `COTURN_SERVICE`/`COTURN_SECRET`, or this provider never gets reached — Phase 2's dispatch picks the first configured one).
2. `curl http://localhost:4000/turn/credentials` — confirm `iceServers` contains `turn:`/`turns:` URLs at `turn.cloudflare.com`.
3. Relay-candidate check via the same Playwright approach as Phase 3 — already proven manually working (see `turn-cf/test-turn.mjs`'s prior output); this step re-confirms the adapter's output shape survived the round-trip through `/turn/credentials`.
