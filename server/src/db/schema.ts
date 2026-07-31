import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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
