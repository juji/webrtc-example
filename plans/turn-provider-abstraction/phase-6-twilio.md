# Phase 6 — Vendor: Twilio

## File

`server/src/turn-providers/twilio.ts`

## Dependency

`cd server && bun add twilio` — the official `twilio` npm package (5.5M+ weekly downloads, actively maintained). The only one of the six vendors with a real, documented SDK method for TURN credential generation (confirmed via npm survey — the other five vendors either have no SDK at all, or their SDK doesn't cover this specific API).

## Adapter

Env: `TWILIO_SERVICE` (Account SID), `TWILIO_AUTH_TOKEN`.

```ts
import Twilio from 'twilio'
import type { RTCIceServerLike, TurnProvider } from './types'

export const twilio: TurnProvider = {
  name: 'twilio',
  isConfigured: () => !!(process.env.TWILIO_SERVICE && process.env.TWILIO_AUTH_TOKEN),
  async getIceServers() {
    const client = Twilio(process.env.TWILIO_SERVICE!, process.env.TWILIO_AUTH_TOKEN!)
    const token = await client.tokens.create() // optional: { ttl: 3600 }
    return (token.iceServers ?? []).map(({ urls, username, credential }) => ({
      urls: urls!,
      username,
      credential,
    })) satisfies RTCIceServerLike[]
  },
}
```

`token.iceServers` is already `RTCIceServer[]`-shaped at runtime (plural `urls`, `credential` not `password`, confirmed live — `urls` is always present in practice) — but the `twilio` SDK's own TypeScript types mark `urls` as optional (`string | undefined`), which doesn't satisfy `RTCIceServerLike`'s required `urls`. The `.map(...)` above narrows the type at the boundary (asserting `urls!` since it's never actually absent) rather than loosening `RTCIceServerLike` itself to accommodate one vendor's overly-loose SDK types.

## Wiring in

Add `import { twilio } from '../turn-providers/twilio'` to `turn.ts`, add `twilio` as the fourth entry in the `providers` array (Phase 2), after `metered`.

## Verification

1. Set `TWILIO_SERVICE`/`TWILIO_AUTH_TOKEN` in `server/.env` (and unset the higher-priority vars from Phases 3–5).
2. `curl http://localhost:4000/turn/credentials` — confirm `iceServers` contains Twilio's `global.turn.twilio.com`-style entries.
3. Relay-candidate check via the same Playwright approach as Phase 3 — also confirms the SDK's `ice_servers` passthrough mapping is correct, since a malformed shape would show up as zero candidates or a browser-side ICE error rather than a clean failure.
