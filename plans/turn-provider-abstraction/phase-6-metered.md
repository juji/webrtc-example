# Phase 6 — Vendor: Metered

## File

`server/src/turn-providers/metered.ts`

## Adapter

Env: `METERED_SERVICE` (app name, replaces `METERED_APP_NAME`), `METERED_API_KEY` (unchanged name, already exists in `server/.env`).

```ts
import type { TurnProvider } from './types'

export const metered: TurnProvider = {
  name: 'metered',
  isConfigured: () => !!(process.env.METERED_SERVICE && process.env.METERED_API_KEY),
  async getIceServers() {
    const appName = process.env.METERED_SERVICE!
    const apiKey = process.env.METERED_API_KEY!
    const res = await fetch(`https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`)
    if (!res.ok) throw new Error(`metered responded ${res.status}`)
    return res.json()
  },
}
```

This is the existing `turn.ts` logic, ported unchanged into the adapter shape — same endpoint, same response passthrough. The only change from the pre-refactor code is the env var name (`METERED_APP_NAME` → `METERED_SERVICE`, matching the `*_SERVICE` convention every other vendor uses) — update `server/.env` accordingly.

## Wiring in

Add `import { metered } from '../turn-providers/metered'` to `turn.ts`, add `metered` as the fourth entry in the `providers` array (Phase 2), after `openRelay`. Delete the old inline logic this replaces (the original contents of `turn.ts` before Phase 2's rewrite).

## Verification

1. Rename `METERED_APP_NAME` to `METERED_SERVICE` in `server/.env` (and unset the higher-priority vars from Phases 3–5).
2. `curl http://localhost:4000/turn/credentials` — confirm the response is identical in shape to what the pre-refactor endpoint returned.
3. Relay-candidate check via the same Playwright approach as Phase 3 — this is a regression check, since this integration already worked before the refactor; a failure here means the port to the adapter shape broke something, not that Metered itself is failing.
