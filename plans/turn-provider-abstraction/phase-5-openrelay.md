# Phase 5 — Vendor: OpenRelay

## File

`server/src/turn-providers/open-relay.ts`

## Adapter

Env: `OPENRELAY_SERVICE` (Metered's app name for the OpenRelay project specifically), `OPENRELAY_API_KEY`.

```ts
import type { TurnProvider } from './types'

export const openRelay: TurnProvider = {
  name: 'openRelay',
  isConfigured: () => !!(process.env.OPENRELAY_SERVICE && process.env.OPENRELAY_API_KEY),
  async getIceServers() {
    const appName = process.env.OPENRELAY_SERVICE!
    const apiKey = process.env.OPENRELAY_API_KEY!
    const res = await fetch(`https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`)
    if (!res.ok) throw new Error(`open-relay responded ${res.status}`)
    return res.json()
  },
}
```

OpenRelay's current hosted API *is* Metered's API under a different account — same endpoint shape as Phase 6's `metered` adapter, just pointed at OpenRelay's own app name/key rather than reusing `METERED_SERVICE`/`METERED_API_KEY`, since they're logically different accounts even though the underlying platform is the same. Response is already a bare `RTCIceServer[]` — no transformation, `iceServers = await res.json()`.

The old static `openrelayproject`/`openrelayproject`@`openrelay.metered.ca` pair some tutorials still reference is deprecated — don't hardcode it.

## Wiring in

Add `import { openRelay } from '../turn-providers/open-relay'` to `turn.ts`, add `openRelay` as the third entry in the `providers` array (Phase 2), after `cfSpeed`.

## Verification

1. Set `OPENRELAY_SERVICE`/`OPENRELAY_API_KEY` in `server/.env` (and unset the higher-priority vars from Phases 3–4).
2. `curl http://localhost:4000/turn/credentials` — confirm `iceServers` contains `turn:`/`stun:` entries at an `openrelay.metered.ca`-style or `<appname>.metered.live`-style host.
3. Relay-candidate check via the same Playwright approach as Phase 3.
