import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { notifications, users } from '../db/schema'
import { notifyUserByPush } from '../push'
import { requireSession, type AuthedVariables } from '../session'

export const contactsRoute = new Hono<{ Variables: AuthedVariables }>()
contactsRoute.use('*', requireSession())

contactsRoute.post('/request', async (c) => {
  const { toId, keyFingerprint } = await c.req.json<{
    toId?: string
    keyFingerprint?: string
  }>()
  if (!toId || !keyFingerprint) {
    return c.json({ error: 'toId and keyFingerprint are required' }, 400)
  }

  const [fromUser] = await db.select().from(users).where(eq(users.id, c.var.userId))
  if (!fromUser) return c.json({ error: 'session user no longer exists' }, 401)

  const [toUser] = await db.select().from(users).where(eq(users.id, toId))
  if (!toUser) return c.json({ error: 'unknown toId' }, 404)

  if (fromUser.id === toUser.id) return c.json({ error: 'cannot request yourself' }, 400)

  const [existingIncoming] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, toUser.id),
        eq(notifications.type, 'contact_request'),
        eq(notifications.status, 'pending'),
      ),
    )

  let incoming = existingIncoming
  if (!incoming || (incoming.data as { otherUserId?: string }).otherUserId !== fromUser.id) {
    // Two rows for one handshake: one each side can see in their own
    // notification feed, linked by pairId so accepting one updates the other.
    const [outgoingRow] = await db
      .insert(notifications)
      .values({
        userId: fromUser.id,
        type: 'contact_request',
        data: {
          direction: 'outgoing',
          otherUserId: toUser.id,
          otherUsername: toUser.username,
          scannedFingerprint: keyFingerprint,
        },
      })
      .returning()

    const [incomingRow] = await db
      .insert(notifications)
      .values({
        userId: toUser.id,
        type: 'contact_request',
        data: {
          direction: 'incoming',
          otherUserId: fromUser.id,
          otherUsername: fromUser.username,
          pairId: outgoingRow.id,
          scannedFingerprint: keyFingerprint,
        },
      })
      .returning()

    await db
      .update(notifications)
      .set({ data: { ...(outgoingRow.data as object), pairId: incomingRow.id } })
      .where(eq(notifications.id, outgoingRow.id))

    incoming = incomingRow
  }

  await notifyUserByPush(toUser.id, {
    title: 'Primssg',
    body: `${fromUser.username} wants to add you as a contact`,
    url: `/chat?open=notifications&id=${incoming.id}`,
  })

  return c.json({ notification: incoming })
})

// Accepting updates both sides of the pair: the recipient's own row (so a
// second accept 409s) and the sender's row (so the sender's client sees
// status flip to accepted and can sync the contact locally). The server
// never persists the resulting contact relationship itself (see
// plans/contacts' Context) — only marks both notification rows accepted and
// hands the accepting client the sender's public key to write its own local
// contact entry.
contactsRoute.post('/requests/:id/accept', async (c) => {
  const id = c.req.param('id')

  const [user] = await db.select().from(users).where(eq(users.id, c.var.userId))
  if (!user) return c.json({ error: 'session user no longer exists' }, 401)

  const [incoming] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
  if (!incoming) return c.json({ error: 'request not found' }, 404)
  if (incoming.status !== 'pending') return c.json({ error: 'request is not pending' }, 409)

  const data = incoming.data as {
    otherUserId: string
    otherUsername: string
    pairId: string
    scannedFingerprint: string
  }

  const [fromUser] = await db.select().from(users).where(eq(users.id, data.otherUserId))
  if (!fromUser) return c.json({ error: 'requester no longer exists' }, 404)

  await db.update(notifications).set({ status: 'accepted' }).where(eq(notifications.id, incoming.id))
  await db.update(notifications).set({ status: 'accepted' }).where(eq(notifications.id, data.pairId))

  await notifyUserByPush(fromUser.id, {
    title: 'Primssg',
    body: `${user.username} accepted your contact request`,
    url: `/chat?open=notifications&id=${data.pairId}`,
    data: {
      type: 'contact-accepted',
      contact: { id: user.id, username: user.username },
      keyFingerprint: data.scannedFingerprint,
    },
  })

  return c.json({
    contact: { id: fromUser.id, username: fromUser.username, mlKemPublicKey: fromUser.mlKemPublicKey },
  })
})
