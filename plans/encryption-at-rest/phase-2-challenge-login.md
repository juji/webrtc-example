# Phase 2 — Challenge-based login

## Files

`server/src/routes/auth.ts` (rewritten), `client/lib/api.ts` (modified), `client/app/page.tsx` (modified)

## Why a challenge, not just "send the public key back"

Sending a public key to prove identity proves nothing — public keys are, by definition, public; anyone who ever saw this user's public key (every other user, since key lookup has no access control per the Context doc's deferred-items list) could replay it. The server must ask for something only the real private-key holder can produce *right now*: a signature over a value the server itself just generated, so a captured request can't be replayed against a future login attempt.

## Server: challenge + verify

`server/src/routes/auth.ts`, replacing the old single `/login` handler:

```ts
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { db } from '../db'
import { users } from '../db/schema'

export const auth = new Hono()

// In-memory, single-server assumption — matches this project's existing scale
// (no session store, no Redis anywhere else in the codebase). A challenge is
// consumed (deleted) on first use and expires after 60s either way.
const pendingChallenges = new Map<string, { nonce: string; expiresAt: number }>()
const CHALLENGE_TTL_MS = 60_000

auth.post('/register', async (c) => {
  const { username, mlDsaPublicKey, mlKemPublicKey } = await c.req.json<{
    username?: string
    mlDsaPublicKey?: string
    mlKemPublicKey?: string
  }>()

  if (!username?.trim() || !mlDsaPublicKey || !mlKemPublicKey) {
    return c.json({ error: 'username and both public keys are required' }, 400)
  }

  const trimmed = username.trim()
  const [existing] = await db.select().from(users).where(eq(users.username, trimmed))
  if (existing) return c.json({ error: 'username already registered' }, 409)

  const [created] = await db
    .insert(users)
    .values({ username: trimmed, mlDsaPublicKey, mlKemPublicKey })
    .returning()
  return c.json({ user: created })
})

auth.post('/challenge', async (c) => {
  const { username } = await c.req.json<{ username?: string }>()
  const trimmed = username?.trim() ?? ''

  const [user] = await db.select().from(users).where(eq(users.username, trimmed))
  if (!user) return c.json({ error: 'unknown username' }, 404)

  const nonce = crypto.randomUUID()
  pendingChallenges.set(trimmed, { nonce, expiresAt: Date.now() + CHALLENGE_TTL_MS })
  return c.json({ nonce })
})

auth.post('/login', async (c) => {
  const { username, signature } = await c.req.json<{ username?: string; signature?: string }>()
  const trimmed = username?.trim() ?? ''

  const pending = pendingChallenges.get(trimmed)
  if (!pending || Date.now() > pending.expiresAt) {
    return c.json({ error: 'no active challenge — request one first' }, 400)
  }
  pendingChallenges.delete(trimmed) // one-time use regardless of outcome

  const [user] = await db.select().from(users).where(eq(users.username, trimmed))
  if (!user || !signature) return c.json({ error: 'invalid login' }, 401)

  const valid = ml_dsa65.verify(
    fromBase64(signature),
    new TextEncoder().encode(pending.nonce),
    fromBase64(user.mlDsaPublicKey),
  )
  if (!valid) return c.json({ error: 'invalid signature' }, 401)

  return c.json({ user })
})
```

`pendingChallenges` is a plain in-memory `Map`, not a DB table — matches this project's existing "no session infrastructure" scale (no Redis, no session store anywhere else in the codebase; `session-store.ts` is client-side Zustand only). A restart drops in-flight challenges, which just means an in-progress login has to re-request one — acceptable for a project this size. Revisit if this server ever runs as more than one instance.

## Client: split registration from login, and complete the challenge automatically

`client/lib/api.ts`:

```ts
export async function login(username: string): Promise<User> {
  const keys = await loadKeys(username);
  if (!keys) throw new Error("no local key for this username on this device");

  const challengeRes = await fetch(`${SERVER_URL}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!challengeRes.ok) throw new Error((await challengeRes.json()).error ?? "challenge failed");
  const { nonce } = await challengeRes.json();

  const signature = ml_dsa65.sign(new TextEncoder().encode(nonce), keys.dsaSecretKey);

  const loginRes = await fetch(`${SERVER_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, signature: toBase64(signature) }),
  });
  if (!loginRes.ok) throw new Error((await loginRes.json()).error ?? "login failed");
  const { user } = await loginRes.json();
  return user;
}
```

`client/app/page.tsx`'s submit handler now needs to decide register-vs-login *before* calling either — it can't just try one and fall back, because `register()` fails loudly (409) on an existing username by design (Phase 1), and `login()` fails if this browser has no local key for that username (a new device, or a cleared IndexedDB). The decision is made by checking local key presence first, not by asking the server:

```ts
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setError("");
  setLoading(true);
  try {
    const existingKeys = await loadKeys(username);
    const user = existingKeys ? await login(username) : await register(username);
    setUser(user);
    router.push("/users");
  } catch (err) {
    setError(err instanceof Error ? err.message : "something went wrong");
  } finally {
    setLoading(false);
  }
}
```

This is where the "no multi-device, no recovery" scope decision from checklist.md becomes user-visible: if `loadKeys(username)` returns nothing (new browser, cleared storage) but the username *is* already registered server-side, this code takes the `register()` branch — which now fails with the server's 409 "username already registered," surfaced to the user as an error rather than silently logging them in as someone else's identity. That's the correct failure mode (refusing access without proof), but the error message should say something more specific than the generic 409 text — e.g. catch that specific case and show "this username exists but isn't registered on this device" — a small UX addition worth doing in this phase since it's the direct, expected consequence of the scope decision already made, not new scope.

## Verification

1. Register a new username, confirm `login()` immediately after (same browser) succeeds — full round trip: challenge issued, signed, verified.
2. Confirm a captured/replayed signature+nonce pair fails on a second `POST /auth/login` attempt (challenge already consumed) — proves the one-time-use property actually holds, not just "looks right on the happy path."
3. Confirm requesting `/auth/login` without ever calling `/auth/challenge` first returns the 400 "no active challenge" error.
4. Simulate a new-device scenario: clear IndexedDB (or use a fresh browser profile), attempt to "log in" to a username registered earlier — confirm it correctly falls into the `register()` branch and surfaces the 409 as a clear error, not a silent wrong-identity login.
5. `bunx tsc --noEmit` clean in both `client/` and `server/`.
