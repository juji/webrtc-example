import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { pushSubscriptions } from '../db/schema'
import { notifyUserByPush, VAPID_PUBLIC_KEY } from '../push'
import { requireSession, type AuthedVariables } from '../session'

export const pushRoute = new Hono<{ Variables: AuthedVariables }>()

pushRoute.get('/vapid-public-key', (c) => c.json({ publicKey: VAPID_PUBLIC_KEY }))

pushRoute.use('/subscribe', requireSession())
pushRoute.post('/subscribe', async (c) => {
  const { endpoint, p256dh, auth } = await c.req.json<{
    endpoint?: string
    p256dh?: string
    auth?: string
  }>()

  if (!endpoint || !p256dh || !auth) {
    return c.json({ error: 'endpoint, p256dh and auth are required' }, 400)
  }

  await db
    .insert(pushSubscriptions)
    .values({ userId: c.var.userId, endpoint, p256dh, auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: c.var.userId, p256dh, auth },
    })

  return c.json({ ok: true })
})

pushRoute.use('/unsubscribe', requireSession())
pushRoute.post('/unsubscribe', async (c) => {
  const { endpoint } = await c.req.json<{ endpoint?: string }>()
  if (!endpoint) return c.json({ error: 'endpoint is required' }, 400)

  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, c.var.userId)))
  return c.json({ ok: true })
})

// Sends a push to every subscription the caller's own account owns —
// exists purely to verify the push pipeline works end-to-end before Phase 5
// wires a real contact-request event into sendPush(). Not a general-purpose
// "notify anyone" endpoint: only ever targets the requester's own session.
pushRoute.use('/test', requireSession())
pushRoute.post('/test', async (c) => {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, c.var.userId))
  if (subs.length === 0) return c.json({ error: 'no push subscription for this user' }, 404)

  await notifyUserByPush(c.var.userId, { title: 'Primssg', body: 'Test push notification' })

  return c.json({ ok: true, sent: subs.length })
})
