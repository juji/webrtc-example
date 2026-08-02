import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  username: text('username').notNull().unique(),
  mlDsaPublicKey: text('ml_dsa_public_key').notNull(),
  mlKemPublicKey: text('ml_kem_public_key').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// One row per logged-in session. `token` is the signed JWT stored in the
// httpOnly session cookie — the JWT itself is self-verifying (signature +
// its own exp claim), this row exists so a session can be revoked early
// (logout) and so lastUpdatedAt can drive rolling renewal: past 15 days
// since lastUpdatedAt, a request gets issued a fresh JWT (new expiresAt,
// lastUpdatedAt reset) instead of requiring re-login at the 30-day mark.
export const userSessions = pgTable('user_sessions', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  token: text('token').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at').notNull(),
  lastUpdatedAt: timestamp('last_updated_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  userId: uuid('user_id').notNull().references(() => users.id),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Generic per-recipient notification feed. `type` picks the shape of `data`;
// currently only 'contact_request' exists. One row per recipient per event —
// a single contact-request handshake produces two rows (one for the sender,
// one for the recipient), each independently updated in place as the
// underlying event's status changes (see plans/contacts).
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  userId: uuid('user_id').notNull().references(() => users.id), // recipient of this notification
  type: text('type').notNull(), // 'contact_request'
  data: jsonb('data').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'accepted'
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// contact_request notification `data` shape (not enforced at the DB level):
//   direction: 'incoming' | 'outgoing'
//   otherUserId, otherUsername: string
//   pairId: the counterpart row's own id (sender row <-> recipient row), so
//     accepting one can jump straight to updating the other.
//   scannedFingerprint: the fingerprint the sender scanned off the
//     recipient's QR when sending the request. Stored on both rows (the
//     sender already has it at send time; the recipient's row carries it so
//     accept can hand it back to the sender's client for a push). Opaque to
//     the server — never checked here, only used by clients to re-verify a
//     key before writing a local contact entry.

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  clientId: text('client_id').notNull(),
  fromUserId: uuid('from_user_id').notNull().references(() => users.id),
  toUserId: uuid('to_user_id').notNull().references(() => users.id),
  text: text('text'),
  // Opaque JSON blob ({name, type, url}) — the server never reads/validates its
  // contents (see plans/encryption's discussion: extension checks moved
  // client-only, server doesn't know anything about the file). Plain text
  // column, not jsonb, so it stays a drop-in target for ciphertext later.
  file: text('file'),
  recipientAckedAt: timestamp('recipient_acked_at'),
  recipientReadAt: timestamp('recipient_read_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
