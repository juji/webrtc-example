import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  username: text('username').notNull().unique(),
  mlDsaPublicKey: text('ml_dsa_public_key').notNull(),
  mlKemPublicKey: text('ml_kem_public_key').notNull(),
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
  fileName: text('file_name'),
  fileType: text('file_type'),
  fileUrl: text('file_url'),
  recipientAckedAt: timestamp('recipient_acked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
