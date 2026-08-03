import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { messages as messagesTable, users } from '../db/schema'
import { notifyUserByPush } from '../push'
import { requireSession, type AuthedVariables } from '../session'
import { notifyUser } from '../signaling'
import { BUCKET, s3 } from '../storage'

const PRESIGN_EXPIRY_SECONDS = 5 * 60

export const messagesRoute = new Hono<{ Variables: AuthedVariables }>()
messagesRoute.use('*', requireSession())

async function findUserByUsername(username: string) {
  const [user] = await db.select().from(users).where(eq(users.username, username))
  return user
}

messagesRoute.post('/', async (c) => {
  const { clientId, toUsername, text } = await c.req.json<{
    clientId?: string
    toUsername?: string
    text?: string
  }>()

  if (!clientId || !toUsername) {
    return c.json({ error: 'clientId and toUsername are required' }, 400)
  }

  const [fromUser, toUser] = await Promise.all([
    db.select().from(users).where(eq(users.id, c.var.userId)).then(([u]) => u),
    findUserByUsername(toUsername),
  ])
  if (!fromUser) return c.json({ error: 'session user no longer exists' }, 401)
  if (!toUser) return c.json({ error: 'toUsername does not exist' }, 400)

  const [row] = await db
    .insert(messagesTable)
    .values({ clientId, fromUserId: fromUser.id, toUserId: toUser.id, text })
    .returning()

  notifyUser(toUser.id, { type: 'new-message', message: row, fromUsername: fromUser.username })
  await notifyUserByPush(toUser.id, {
    title: 'Primssg',
    body: `New message from ${fromUser.username}`,
    url: `/chat?peer=${fromUser.id}`,
  })

  return c.json({ message: row })
})

messagesRoute.get('/', async (c) => {
  const peerUsername = c.req.query('peer')
  if (!peerUsername) return c.json({ error: 'peer query param is required' }, 400)

  const peerUser = await findUserByUsername(peerUsername)
  if (!peerUser) return c.json({ error: 'peer does not exist' }, 400)

  const rows = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.fromUserId, peerUser.id),
        eq(messagesTable.toUserId, c.var.userId),
        isNull(messagesTable.recipientAckedAt),
      ),
    )

  return c.json({ messages: rows })
})

messagesRoute.post('/:id/ack', async (c) => {
  const id = c.req.param('id')

  const [existing] = await db.select().from(messagesTable).where(eq(messagesTable.id, id))
  if (!existing) return c.json({ error: 'message not found' }, 404)
  if (existing.toUserId !== c.var.userId) return c.json({ error: 'not the recipient of this message' }, 403)

  const [row] = await db
    .update(messagesTable)
    .set({ recipientAckedAt: new Date() })
    .where(eq(messagesTable.id, id))
    .returning()

  const [fromUser, toUser] = await Promise.all([
    db.select().from(users).where(eq(users.id, row.fromUserId)).then(([u]) => u),
    db.select().from(users).where(eq(users.id, row.toUserId)).then(([u]) => u),
  ])

  if (fromUser && toUser) {
    notifyUser(fromUser.id, {
      type: 'message-acked',
      id: row.id,
      clientId: row.clientId,
      peerUsername: toUser.username,
    })
  }

  return c.json({ message: row })
})

messagesRoute.post('/:id/read', async (c) => {
  const id = c.req.param('id')

  const [existing] = await db.select().from(messagesTable).where(eq(messagesTable.id, id))
  if (!existing) return c.json({ ok: true })
  if (existing.toUserId !== c.var.userId) return c.json({ error: 'not the recipient of this message' }, 403)

  const [row] = await db
    .update(messagesTable)
    .set({ recipientReadAt: new Date() })
    .where(eq(messagesTable.id, id))
    .returning()

  const [fromUser, toUser] = await Promise.all([
    db.select().from(users).where(eq(users.id, row.fromUserId)).then(([u]) => u),
    db.select().from(users).where(eq(users.id, row.toUserId)).then(([u]) => u),
  ])

  if (fromUser && toUser) {
    notifyUser(fromUser.id, {
      type: 'message-read',
      id: row.id,
      clientId: row.clientId,
      peerUsername: toUser.username,
    })
  }

  // Once the recipient has read it the message is delivered, full stop — the
  // row's only job is failover delivery, so delete it here rather than trusting
  // the best-effort message-read push above to reach the sender's client and
  // have it DELETE (a stale/dead sender socket can swallow that push).
  await db.delete(messagesTable).where(eq(messagesTable.id, id))

  return c.json({ message: row })
})

messagesRoute.post('/attachment/presign', async (c) => {
  const { clientId, toUsername, fileName, fileType } = await c.req.json<{
    clientId?: string
    toUsername?: string
    fileName?: string
    fileType?: string
  }>()

  if (!clientId || !toUsername || !fileName || !fileType) {
    return c.json({ error: 'clientId, toUsername, fileName and fileType are required' }, 400)
  }

  const toUser = await findUserByUsername(toUsername)
  if (!toUser) return c.json({ error: 'toUsername does not exist' }, 400)

  const key = `${clientId}-${fileName}`
  const putUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: fileType }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS },
  )

  return c.json({ putUrl, key })
})

messagesRoute.post('/attachment/confirm', async (c) => {
  const { clientId, toUsername, fileName, fileType, key } = await c.req.json<{
    clientId?: string
    toUsername?: string
    fileName?: string
    fileType?: string
    key?: string
  }>()

  if (!clientId || !toUsername || !fileName || !fileType || !key) {
    return c.json({ error: 'clientId, toUsername, fileName, fileType and key are required' }, 400)
  }

  const [fromUser, toUser] = await Promise.all([
    db.select().from(users).where(eq(users.id, c.var.userId)).then(([u]) => u),
    findUserByUsername(toUsername),
  ])
  if (!fromUser) return c.json({ error: 'session user no longer exists' }, 401)
  if (!toUser) return c.json({ error: 'toUsername does not exist' }, 400)

  const fileUrl = `${process.env.RUSTFS_ENDPOINT}/${BUCKET}/${key}`
  const file = JSON.stringify({ name: fileName, type: fileType, url: fileUrl })

  const [row] = await db
    .insert(messagesTable)
    .values({ clientId, fromUserId: fromUser.id, toUserId: toUser.id, file })
    .returning()

  notifyUser(toUser.id, { type: 'new-message', message: row, fromUsername: fromUser.username })
  await notifyUserByPush(toUser.id, {
    title: 'Primssg',
    body: `New message from ${fromUser.username}`,
    url: `/chat?peer=${fromUser.id}`,
  })

  return c.json({ message: row })
})
