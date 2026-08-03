import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'
import { requireSession, type AuthedVariables } from '../session'

export const usersRoute = new Hono<{ Variables: AuthedVariables }>()
usersRoute.use('*', requireSession())

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Looked up by id (from a scanned QR payload) to verify a contact's key
// fingerprint — see plans/contacts. Not a search/discovery endpoint: the id
// must already be known, e.g. scanned off someone's screen.
usersRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'user not found' }, 404)

  const [user] = await db
    .select({ id: users.id, username: users.username, mlKemPublicKey: users.mlKemPublicKey })
    .from(users)
    .where(eq(users.id, id))

  if (!user) return c.json({ error: 'user not found' }, 404)

  return c.json({ user })
})
