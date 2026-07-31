import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { notifications, users } from '../db/schema'

export const notificationsRoute = new Hono()

// Full notification feed for a user — both directions, any status. What the
// Bell popup renders.
notificationsRoute.get('/', async (c) => {
  const username = c.req.query('username')
  if (!username) return c.json({ error: 'username is required' }, 400)

  const [user] = await db.select().from(users).where(eq(users.username, username))
  if (!user) return c.json({ error: 'unknown username' }, 404)

  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.type, 'contact_request')))
    .orderBy(desc(notifications.createdAt))

  return c.json({ notifications: rows })
})
