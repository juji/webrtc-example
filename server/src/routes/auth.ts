import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { db } from '../db'
import { users } from '../db/schema'
import { createSession, destroySession } from '../session'

export const auth = new Hono()

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

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
  await createSession(c, created.id)
  return c.json({ user: created })
})

auth.post('/challenge', async (c) => {
  const { username } = await c.req.json<{ username?: string }>()
  const trimmed = username?.trim() ?? ''

  const [user] = await db.select().from(users).where(eq(users.username, trimmed))
  if (!user) return c.json({ error: 'unknown username' }, 404)

  const nonce = crypto.randomUUID()
  pendingChallenges.set(trimmed, { nonce, expiresAt: Date.now() + CHALLENGE_TTL_MS })
  return c.json({ nonce, userId: user.id })
})

auth.post('/login', async (c) => {
  const { username, signature } = await c.req.json<{ username?: string; signature?: string }>()
  const trimmed = username?.trim() ?? ''

  const pending = pendingChallenges.get(trimmed)
  if (!pending || Date.now() > pending.expiresAt) {
    return c.json({ error: 'no active challenge — request one first' }, 400)
  }
  pendingChallenges.delete(trimmed)

  const [user] = await db.select().from(users).where(eq(users.username, trimmed))
  if (!user || !signature) return c.json({ error: 'invalid login' }, 401)

  const valid = ml_dsa65.verify(
    fromBase64(signature),
    new TextEncoder().encode(pending.nonce),
    fromBase64(user.mlDsaPublicKey),
  )
  if (!valid) return c.json({ error: 'invalid signature' }, 401)

  await createSession(c, user.id)
  return c.json({ user })
})

auth.post('/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})
