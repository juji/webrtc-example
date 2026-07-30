import { Hono } from 'hono'
import { and, ilike, ne } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'

export const usersRoute = new Hono()

usersRoute.get('/', async (c) => {
  const q = c.req.query('q')?.trim() ?? ''
  const excludeUsername = c.req.query('exclude')?.trim() ?? ''

  const results = await db
    .select()
    .from(users)
    .where(and(ilike(users.username, `%${q}%`), ne(users.username, excludeUsername)))

  return c.json({ users: results })
})
