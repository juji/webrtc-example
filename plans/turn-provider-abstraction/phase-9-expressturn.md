# Phase 9 — Vendor: ExpressTURN

## File

`server/src/turn-providers/express-turn.ts`

## Adapter

Env: `EXPRESSTURN_SERVICE` (host:port, e.g. `relay1.expressturn.com:3478`), `EXPRESSTURN_USERNAME`, `EXPRESSTURN_PASSWORD`.

```ts
import type { TurnProvider } from './types'

export const expressTurn: TurnProvider = {
  name: 'expressTurn',
  isConfigured: () =>
    !!(process.env.EXPRESSTURN_SERVICE && process.env.EXPRESSTURN_USERNAME && process.env.EXPRESSTURN_PASSWORD),
  async getIceServers() {
    return [
      {
        urls: `turn:${process.env.EXPRESSTURN_SERVICE}`,
        username: process.env.EXPRESSTURN_USERNAME!,
        credential: process.env.EXPRESSTURN_PASSWORD!,
      },
    ]
  },
}
```

No REST API — ExpressTURN issues static long-term credentials via their dashboard, not a live credential-issuing endpoint (confirmed: their free/standard tier has no API; only their Premium tier exposes a shared-secret HMAC option, which would need its own separate adapter if ever used — not built here since it requires a paid tier to verify against). `getIceServers()` makes no network call, just returns the static pair from env.

## Wiring in

Add `import { expressTurn } from '../turn-providers/express-turn'` to `turn.ts`, add `expressTurn` as the seventh and last entry in the `providers` array (Phase 2), after `xirsys`.

## Verification

1. Set `EXPRESSTURN_SERVICE`/`EXPRESSTURN_USERNAME`/`EXPRESSTURN_PASSWORD` in `server/.env` (and unset the higher-priority vars from Phases 3–8).
2. `curl http://localhost:4000/turn/credentials` — confirm `iceServers` contains the static ExpressTURN entry with the configured username.
3. Relay-candidate check via the same Playwright approach as Phase 3, against the static credentials.
