import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { pushSubscriptions, users } from '../db/schema'
import { notifyUserByPush, VAPID_PUBLIC_KEY } from '../push'

export const pushRoute = new Hono()

pushRoute.get('/vapid-public-key', (c) => c.json({ publicKey: VAPID_PUBLIC_KEY }))

pushRoute.post('/subscribe', async (c) => {
  const { username, endpoint, p256dh, auth } = await c.req.json<{
    username?: string
    endpoint?: string
    p256dh?: string
    auth?: string
  }>()

  if (!username || !endpoint || !p256dh || !auth) {
    return c.json({ error: 'username, endpoint, p256dh and auth are required' }, 400)
  }

  const [user] = await db.select().from(users).where(eq(users.username, username))
  if (!user) return c.json({ error: 'unknown username' }, 404)

  await db
    .insert(pushSubscriptions)
    .values({ userId: user.id, endpoint, p256dh, auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh, auth },
    })

  return c.json({ ok: true })
})

pushRoute.post('/unsubscribe', async (c) => {
  const { endpoint } = await c.req.json<{ endpoint?: string }>()
  if (!endpoint) return c.json({ error: 'endpoint is required' }, 400)

  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
  return c.json({ ok: true })
})

// Sends a push to every subscription the caller's own account owns —
// exists purely to verify the push pipeline works end-to-end before Phase 5
// wires a real contact-request event into sendPush(). Not a general-purpose
// "notify anyone" endpoint: only ever targets the requester's own username.
pushRoute.post('/test', async (c) => {
  const { username } = await c.req.json<{ username?: string }>()
  if (!username) return c.json({ error: 'username is required' }, 400)

  const [user] = await db.select().from(users).where(eq(users.username, username))
  if (!user) return c.json({ error: 'unknown username' }, 404)

  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id))
  if (subs.length === 0) return c.json({ error: 'no push subscription for this user' }, 404)

  await notifyUserByPush(user.id, { title: 'Primssg', body: 'Test push notification' })

  return c.json({ ok: true, sent: subs.length })
})
