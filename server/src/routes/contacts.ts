import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { contactRequests, users } from '../db/schema'
import { notifyUserByPush } from '../push'

export const contactsRoute = new Hono()

contactsRoute.post('/request', async (c) => {
  const { fromUsername, toId } = await c.req.json<{ fromUsername?: string; toId?: string }>()
  if (!fromUsername || !toId) return c.json({ error: 'fromUsername and toId are required' }, 400)

  const [fromUser] = await db.select().from(users).where(eq(users.username, fromUsername))
  if (!fromUser) return c.json({ error: 'unknown fromUsername' }, 404)

  const [toUser] = await db.select().from(users).where(eq(users.id, toId))
  if (!toUser) return c.json({ error: 'unknown toId' }, 404)

  if (fromUser.id === toUser.id) return c.json({ error: 'cannot request yourself' }, 400)

  const [existing] = await db
    .select()
    .from(contactRequests)
    .where(and(eq(contactRequests.fromUserId, fromUser.id), eq(contactRequests.toUserId, toUser.id)))

  const request =
    existing ??
    (
      await db
        .insert(contactRequests)
        .values({ fromUserId: fromUser.id, toUserId: toUser.id })
        .returning()
    )[0]

  await notifyUserByPush(toUser.id, {
    title: 'Primssg',
    body: `${fromUser.username} wants to add you as a contact`,
    url: '/chat?open=requests',
  })

  return c.json({ request })
})

// Pending incoming requests for a user — what the requests popup renders.
contactsRoute.get('/requests', async (c) => {
  const username = c.req.query('username')
  if (!username) return c.json({ error: 'username is required' }, 400)

  const [user] = await db.select().from(users).where(eq(users.username, username))
  if (!user) return c.json({ error: 'unknown username' }, 404)

  const rows = await db
    .select({
      id: contactRequests.id,
      fromUsername: users.username,
      createdAt: contactRequests.createdAt,
    })
    .from(contactRequests)
    .innerJoin(users, eq(users.id, contactRequests.fromUserId))
    .where(and(eq(contactRequests.toUserId, user.id), eq(contactRequests.status, 'pending')))

  return c.json({ requests: rows })
})

// Accepting is intentionally the only state change this endpoint makes.
// The server never persists the resulting contact relationship (see
// plans/contacts' Context) — it marks the request accepted (so re-requesting
// doesn't spam a new pending row), notifies the original requester, and
// hands the accepting client the requester's public key so it can write its
// own local contact entry. Nothing about a chat/conversation happens here.
contactsRoute.post('/requests/:id/accept', async (c) => {
  const id = c.req.param('id')
  const { username } = await c.req.json<{ username?: string }>()
  if (!username) return c.json({ error: 'username is required' }, 400)

  const [user] = await db.select().from(users).where(eq(users.username, username))
  if (!user) return c.json({ error: 'unknown username' }, 404)

  const [request] = await db
    .select()
    .from(contactRequests)
    .where(and(eq(contactRequests.id, id), eq(contactRequests.toUserId, user.id)))
  if (!request) return c.json({ error: 'request not found' }, 404)
  if (request.status !== 'pending') return c.json({ error: 'request is not pending' }, 409)

  const [fromUser] = await db.select().from(users).where(eq(users.id, request.fromUserId))
  if (!fromUser) return c.json({ error: 'requester no longer exists' }, 404)

  await db.update(contactRequests).set({ status: 'accepted' }).where(eq(contactRequests.id, id))

  await notifyUserByPush(fromUser.id, {
    title: 'Primssg',
    body: `${user.username} accepted your contact request`,
    url: '/chat',
  })

  return c.json({
    contact: { id: fromUser.id, username: fromUser.username, mlKemPublicKey: fromUser.mlKemPublicKey },
  })
})
