import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { notifications } from '../db/schema'
import { requireSession, type AuthedVariables } from '../session'

export const notificationsRoute = new Hono<{ Variables: AuthedVariables }>()
notificationsRoute.use('*', requireSession())

// Full notification feed for the authenticated user — both directions, any
// status. What the Bell popup renders.
notificationsRoute.get('/', async (c) => {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, c.var.userId), eq(notifications.type, 'contact_request')))
    .orderBy(desc(notifications.createdAt))

  return c.json({ notifications: rows })
})
