import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'

export const auth = new Hono()

auth.post('/login', async (c) => {
  const { username } = await c.req.json<{ username?: string }>()

  if (!username || !username.trim()) {
    return c.json({ error: 'username is required' }, 400)
  }

  const trimmed = username.trim()

  const [existing] = await db.select().from(users).where(eq(users.username, trimmed))
  if (existing) {
    return c.json({ user: existing })
  }

  const [created] = await db.insert(users).values({ username: trimmed }).returning()
  return c.json({ user: created })
})
