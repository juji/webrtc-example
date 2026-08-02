import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { messages as messagesTable, users } from '../db/schema'
import { notifyUserByPush } from '../push'
import { notifyUser } from '../signaling'
import { BUCKET, s3 } from '../storage'

const PRESIGN_EXPIRY_SECONDS = 5 * 60

const DEFAULT_BLACKLIST_EXTENSIONS =
  'exe,msi,bat,cmd,com,scr,pif,vbs,vbe,js,jse,wsf,wsh,ps1,ps1xml,psc1,sh,bash,zsh,csh,ksh,run,app,apk,ipa,dmg,pkg,dll,so,dylib,sys,drv,jar,deb,rpm'

export const messagesRoute = new Hono()

async function findUserByUsername(username: string) {
  const [user] = await db.select().from(users).where(eq(users.username, username))
  return user
}

function isExtensionAllowed(fileName: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''

  const whitelist = process.env.ATTACHMENT_WHITELIST_EXTENSIONS
  if (whitelist) {
    const allowed = whitelist.split(',').map((e) => e.trim().toLowerCase())
    return allowed.includes(extension)
  }

  const blacklist = process.env.ATTACHMENT_BLACKLIST_EXTENSIONS ?? DEFAULT_BLACKLIST_EXTENSIONS
  const blocked = blacklist
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return !blocked.includes(extension)
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

  notifyUser(toUser.id, { type: 'new-message', message: row, fromUsername })
  await notifyUserByPush(toUser.id, {
    title: 'Primssg',
    body: `New message from ${fromUsername}`,
    url: `/chat?peer=${fromUser.id}`,
  })

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
  const id = c.req.param('id')

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

  const [row] = await db
    .update(messagesTable)
    .set({ recipientReadAt: new Date() })
    .where(eq(messagesTable.id, id))
    .returning()

  if (!row) return c.json({ error: 'message not found' }, 404)

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

  return c.json({ message: row })
})

messagesRoute.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const [row] = await db.select().from(messagesTable).where(eq(messagesTable.id, id))
  if (!row) return c.json({ error: 'message not found' }, 404)
  if (!row.recipientReadAt) return c.json({ error: 'message not yet read by recipient' }, 409)

  if (row.fileUrl) {
    const key = row.fileUrl.split(`/${BUCKET}/`).pop()
    if (key) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  }

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

  if (!isExtensionAllowed(fileName)) {
    return c.json({ error: 'file extension not allowed' }, 400)
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

  notifyUser(toUser.id, { type: 'new-message', message: row, fromUsername })
  await notifyUserByPush(toUser.id, {
    title: 'Primssg',
    body: `New message from ${fromUsername}`,
    url: `/chat?peer=${fromUser.id}`,
  })

  return c.json({ message: row })
})
