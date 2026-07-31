# Phase 7 — Vendor: Xirsys

## File

`server/src/turn-providers/xirsys.ts`

## Adapter

Env: `XIRSYS_SERVICE` (ident), `XIRSYS_SECRET`, `XIRSYS_CHANNEL` (the named channel/application in Xirsys's dashboard).

```ts
import type { TurnProvider } from './types'

export const xirsys: TurnProvider = {
  name: 'xirsys',
  isConfigured: () => !!(process.env.XIRSYS_SERVICE && process.env.XIRSYS_SECRET && process.env.XIRSYS_CHANNEL),
  async getIceServers() {
    const ident = process.env.XIRSYS_SERVICE!
    const secret = process.env.XIRSYS_SECRET!
    const channel = process.env.XIRSYS_CHANNEL!
    const auth = Buffer.from(`${ident}:${secret}`).toString('base64')

    const res = await fetch(`https://global.xirsys.net/_turn/${channel}`, {
      method: 'PUT',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'urls' }),
    })
    if (!res.ok) throw new Error(`xirsys responded ${res.status}`)

    const body = await res.json()
    if (body.s !== 'ok') throw new Error('xirsys returned non-ok status')
    return [body.v.iceServers]
  },
}
```

Response shape is `{ v: { iceServers: { urls: [...], username, credential } }, s: "ok" }` — **`v.iceServers` is a single object, not an array** (confirmed against Xirsys's modern `format:"urls"` response shape). `s` is the status field; check it before using `v`.

## Wiring in

Add `import { xirsys } from '../turn-providers/xirsys'` to `turn.ts`, add `xirsys` as the fifth entry in the `providers` array (Phase 2), after `twilio`.

## Verification

1. Set `XIRSYS_SERVICE`/`XIRSYS_SECRET`/`XIRSYS_CHANNEL` in `server/.env` (and unset the higher-priority vars from Phases 3–6).
2. `curl http://localhost:4000/turn/credentials` — confirm `iceServers` contains one entry with Xirsys's `turn:`/`stun:` URLs.
3. Relay-candidate check via the same Playwright approach as Phase 3 — also confirms the single-object-not-array unwrapping (`[body.v.iceServers]`) is correct, since getting this wrong would silently produce a zero-length or malformed `iceServers` array rather than an obvious error.
