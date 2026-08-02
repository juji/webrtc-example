import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { CookieOptions } from 'hono/utils/cookie'
import type { Context, MiddlewareHandler } from 'hono'
import { eq } from 'drizzle-orm'
import { Jwt } from 'hono/utils/jwt'
import { db } from './db'
import { userSessions } from './db/schema'

const COOKIE_NAME = 'session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const RENEW_AFTER_MS = 15 * 24 * 60 * 60 * 1000 // re-issue past this age

// secure:true cookies are silently refused by browsers over plain http:// —
// local dev runs the server on http://localhost:4000, so this can't be a
// hardcoded true or login breaks with no visible error. NODE_ENV doesn't
// answer the actual question either: behind a reverse proxy that terminates
// TLS, the app itself sees a plain-HTTP request even in production. Check
// the real scheme the client connected with, via X-Forwarded-Proto when
// present (set by the proxy) and the request URL's own protocol otherwise.
function cookieOptions(c: Context): CookieOptions {
  const forwardedProto = c.req.header('x-forwarded-proto')
  const isHttps = forwardedProto ? forwardedProto === 'https' : new URL(c.req.url).protocol === 'https:'
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  }
}

function secret(): string {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error('JWT_SECRET is not configured')
  return value
}

async function issueToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const token = await Jwt.sign({ sub: userId, exp: Math.floor(expiresAt.getTime() / 1000) }, secret())
  return { token, expiresAt }
}

// Called at login/register. Creates the DB row (for later revocation/renewal
// tracking) and sets the httpOnly cookie — the client never sees or handles
// the token directly.
export async function createSession(c: Context, userId: string): Promise<void> {
  const { token, expiresAt } = await issueToken(userId)
  await db.insert(userSessions).values({ token, userId, expiresAt })
  setCookie(c, COOKIE_NAME, token, cookieOptions(c))
}

export async function destroySession(c: Context): Promise<void> {
  const token = getCookie(c, COOKIE_NAME)
  if (token) await db.delete(userSessions).where(eq(userSessions.token, token))
  deleteCookie(c, COOKIE_NAME, { path: '/' })
}

export type AuthedVariables = { userId: string }

// Resolves the session cookie into c.var.userId for every route behind it —
// the one source of truth for "who is this request from" (see
// plans/encryption's auth discussion: routes previously trusted a
// client-supplied username field directly, with nothing stopping a request
// from claiming to be anyone). Rejects with 401 if the cookie is missing,
// the JWT fails verification, or the DB row was revoked (logout/deleted).
export function requireSession(): MiddlewareHandler<{ Variables: AuthedVariables }> {
  return async (c, next) => {
    const token = getCookie(c, COOKIE_NAME)
    if (!token) return c.json({ error: 'not authenticated' }, 401)

    let sub: unknown
    try {
      sub = (await Jwt.verify(token, secret(), 'HS256')).sub
    } catch {
      return c.json({ error: 'invalid or expired session' }, 401)
    }
    if (typeof sub !== 'string') return c.json({ error: 'invalid session' }, 401)

    const [row] = await db.select().from(userSessions).where(eq(userSessions.token, token))
    if (!row) return c.json({ error: 'session revoked' }, 401)

    c.set('userId', sub)
    await next()

    // Rolling renewal: past RENEW_AFTER_MS since last renewal, issue a fresh
    // JWT (new 30-day expiry) and swap the cookie/row rather than forcing
    // re-login at the 30-day mark. Runs after the handler so it never delays
    // the actual response.
    if (Date.now() - row.lastUpdatedAt.getTime() > RENEW_AFTER_MS) {
      const { token: nextToken, expiresAt } = await issueToken(sub)
      await db
        .update(userSessions)
        .set({ token: nextToken, expiresAt, lastUpdatedAt: new Date() })
        .where(eq(userSessions.id, row.id))
      setCookie(c, COOKIE_NAME, nextToken, cookieOptions(c))
    }
  }
}
