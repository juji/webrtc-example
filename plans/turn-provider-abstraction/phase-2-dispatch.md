# Phase 2 — Server: shared dispatch plumbing

## Files

`server/src/routes/turn.ts` (rewritten), `server/src/turn-providers/types.ts` (new)

## The adapter shape

`server/src/turn-providers/types.ts` defines the one shape every vendor phase (3–9) implements:

```ts
export type RTCIceServerLike = { urls: string | string[]; username?: string; credential?: string }

export type TurnProvider = {
  name: string
  isConfigured: () => boolean
  getIceServers: () => Promise<RTCIceServerLike[]>
}
```

`RTCIceServerLike` is defined here rather than reusing the DOM `RTCIceServer` type, since this runs server-side with no DOM lib. `isConfigured()` checks whether that vendor's env var(s) are actually filled in — cheap, synchronous, no network call. `getIceServers()` does the real work (HMAC computation, or a `fetch` to the vendor's API) and throws on failure. `name` is used in error messages (below).

This file has no vendor-specific content — it's the contract every `server/src/turn-providers/*.ts` file (built in Phases 3–9) implements.

## `/turn/credentials`'s dispatch logic

`server/src/routes/turn.ts` imports each vendor's provider object (built incrementally as Phases 3–9 land — this file's `providers` array grows by one line per phase) and walks them in a fixed order:

```ts
const providers: TurnProvider[] = [coturn, cfSpeed, openRelay, metered, twilio, xirsys, expressTurn]

turn.get('/credentials', async (c) => {
  const provider = providers.find((p) => p.isConfigured())
  if (!provider) return c.json({ error: 'TURN credentials are not configured' }, 500)

  try {
    const iceServers = await provider.getIceServers()
    return c.json({ iceServers })
  } catch {
    return c.json({ error: `${provider.name} TURN request failed` }, 502)
  }
})
```

Order, self-hosted first: `coturn` (own infra, most control) → `cfSpeed` → `openRelay` → `metered` → `twilio` → `xirsys` → `expressTurn` (remaining commercial vendors, alphabetical — no functional reason to prefer one over another once coturn/free-tier options are exhausted). This exact order is what Phases 3–9 are numbered after.

## Why no fallback on failure

If the selected provider's `getIceServers()` throws (vendor API down, bad credentials), the response is `502` — **not** a silent fallback to the next provider in the list. Falling back would make behavior depend on which vendors happen to be down at the moment a request comes in, defeating the "same input, same provider, every time" guarantee from checklist.md. A caller who wants resilience across vendor outages should retry, not have the server silently substitute a different vendor's relay infrastructure.

## Landing this phase before any vendor exists

At the end of Phase 2, `providers` is an empty array and `turn.ts` always returns `500` — this phase is pure plumbing, intentionally not runnable end-to-end until Phase 3 adds the first real entry. Confirm the file compiles and the empty-array `500` path returns cleanly; the array grows one vendor at a time starting Phase 3.

## Verification

- `bunx tsc --noEmit` passes with `providers = []`.
- `curl http://localhost:4000/turn/credentials` returns `{"error":"TURN credentials are not configured"}` with status `500` — confirms the dispatch loop and the "none configured" path work before any vendor is wired in.

Per-vendor live verification (a real relay candidate, an actual vendor API call) happens in each vendor's own phase (3–9), not here.
