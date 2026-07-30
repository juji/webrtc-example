import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  clientId: text('client_id').notNull(),
  fromUserId: integer('from_user_id').notNull().references(() => users.id),
  toUserId: integer('to_user_id').notNull().references(() => users.id),
  text: text('text'),
  fileName: text('file_name'),
  fileType: text('file_type'),
  fileUrl: text('file_url'),
  recipientAckedAt: timestamp('recipient_acked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
