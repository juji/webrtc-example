import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { messages as messagesTable, users } from '../db/schema'
import { notifyUser } from '../signaling'
import { BUCKET, s3 } from '../storage'

const PRESIGN_EXPIRY_SECONDS = 5 * 60

export const messagesRoute = new Hono()

async function findUserByUsername(username: string) {
  const [user] = await db.select().from(users).where(eq(users.username, username))
  return user
}

messagesRoute.post('/', async (c) => {
  const { clientId, fromUsername, toUsername, text } = await c.req.json<{
    clientId?: string
    fromUsername?: string
    toUsername?: string
    text?: string
  }>()

  if (!clientId || !fromUsername || !toUsername) {
    return c.json({ error: 'clientId, fromUsername and toUsername are required' }, 400)
  }

  const [fromUser, toUser] = await Promise.all([
    findUserByUsername(fromUsername),
    findUserByUsername(toUsername),
  ])
  if (!fromUser || !toUser) {
    return c.json({ error: 'fromUsername or toUsername does not exist' }, 400)
  }

  const [row] = await db
    .insert(messagesTable)
    .values({ clientId, fromUserId: fromUser.id, toUserId: toUser.id, text })
    .returning()

  notifyUser(toUsername, { type: 'new-message', message: row, fromUsername })

  return c.json({ message: row })
})

messagesRoute.get('/', async (c) => {
  const peerUsername = c.req.query('peer')
  const selfUsername = c.req.query('self')

  if (!peerUsername || !selfUsername) {
    return c.json({ error: 'peer and self query params are required' }, 400)
  }

  const [peerUser, selfUser] = await Promise.all([
    findUserByUsername(peerUsername),
    findUserByUsername(selfUsername),
  ])
  if (!peerUser || !selfUser) {
    return c.json({ error: 'peer or self does not exist' }, 400)
  }

  const rows = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.fromUserId, peerUser.id),
        eq(messagesTable.toUserId, selfUser.id),
        isNull(messagesTable.recipientAckedAt),
      ),
    )

  return c.json({ messages: rows })
})

messagesRoute.post('/:id/ack', async (c) => {
  const id = Number(c.req.param('id'))

  const [row] = await db
    .update(messagesTable)
    .set({ recipientAckedAt: new Date() })
    .where(eq(messagesTable.id, id))
    .returning()

  if (!row) return c.json({ error: 'message not found' }, 404)

  const [fromUser, toUser] = await Promise.all([
    db.select().from(users).where(eq(users.id, row.fromUserId)).then(([u]) => u),
    db.select().from(users).where(eq(users.id, row.toUserId)).then(([u]) => u),
  ])

  if (fromUser && toUser) {
    notifyUser(fromUser.username, {
      type: 'message-acked',
      id: row.id,
      clientId: row.clientId,
      peerUsername: toUser.username,
    })
  }

  return c.json({ message: row })
})

messagesRoute.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))

  const [row] = await db.select().from(messagesTable).where(eq(messagesTable.id, id))
  if (!row) return c.json({ error: 'message not found' }, 404)
  if (!row.recipientAckedAt) return c.json({ error: 'message not yet acked by recipient' }, 409)

  await db.delete(messagesTable).where(eq(messagesTable.id, id))

  return c.json({ ok: true })
})

messagesRoute.post('/attachment/presign', async (c) => {
  const { clientId, fromUsername, toUsername, fileName, fileType } = await c.req.json<{
    clientId?: string
    fromUsername?: string
    toUsername?: string
    fileName?: string
    fileType?: string
  }>()

  if (!clientId || !fromUsername || !toUsername || !fileName || !fileType) {
    return c.json({ error: 'clientId, fromUsername, toUsername, fileName and fileType are required' }, 400)
  }

  const [fromUser, toUser] = await Promise.all([
    findUserByUsername(fromUsername),
    findUserByUsername(toUsername),
  ])
  if (!fromUser || !toUser) {
    return c.json({ error: 'fromUsername or toUsername does not exist' }, 400)
  }

  const key = `${clientId}-${fileName}`
  const putUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: fileType }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS },
  )

  return c.json({ putUrl, key })
})

messagesRoute.post('/attachment/confirm', async (c) => {
  const { clientId, fromUsername, toUsername, fileName, fileType, key } = await c.req.json<{
    clientId?: string
    fromUsername?: string
    toUsername?: string
    fileName?: string
    fileType?: string
    key?: string
  }>()

  if (!clientId || !fromUsername || !toUsername || !fileName || !fileType || !key) {
    return c.json(
      { error: 'clientId, fromUsername, toUsername, fileName, fileType and key are required' },
      400,
    )
  }

  const [fromUser, toUser] = await Promise.all([
    findUserByUsername(fromUsername),
    findUserByUsername(toUsername),
  ])
  if (!fromUser || !toUser) {
    return c.json({ error: 'fromUsername or toUsername does not exist' }, 400)
  }

  const fileUrl = `${process.env.RUSTFS_ENDPOINT}/${BUCKET}/${key}`

  const [row] = await db
    .insert(messagesTable)
    .values({ clientId, fromUserId: fromUser.id, toUserId: toUser.id, fileName, fileType, fileUrl })
    .returning()

  notifyUser(toUsername, { type: 'new-message', message: row, fromUsername })

  return c.json({ message: row })
})
