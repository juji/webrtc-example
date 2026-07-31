import webPush from 'web-push'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { pushSubscriptions } from './db/schema'

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? ''

webPush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

export { VAPID_PUBLIC_KEY }

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string }
export type PushPayload = {
  title: string
  body: string
  url?: string
  // Structured, event-specific data beyond the notification's visible chrome
  // — e.g. contact-accepted pushes carry enough to let the client re-verify
  // and persist the contact without a second round trip. Opaque to sw.js's
  // showNotification() call; only the app's own message handling reads it.
  data?: Record<string, unknown>
}

export async function sendPush(subscription: PushSubscriptionKeys, payload: PushPayload) {
  await webPush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify(payload),
  )
}

// Sends to every subscription a user owns (multiple devices), catching each
// failure individually so one dead/expired subscription doesn't block others.
export async function notifyUserByPush(userId: string, payload: PushPayload) {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  await Promise.all(
    subs.map((sub) =>
      sendPush(sub, payload).catch((err) => {
        console.error('push send failed:', err)
      }),
    ),
  )
}
