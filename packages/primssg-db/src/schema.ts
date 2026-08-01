// One table per PrimssgDB method group. Column names/types mirror the
// TS types in ./types.ts exactly — no renaming between the SQL layer
// and the interface layer.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS keys (
  id TEXT PRIMARY KEY,
  dsaPublicKey BLOB NOT NULL,
  dsaSecretKey BLOB NOT NULL,
  kemPublicKey BLOB NOT NULL,
  kemSecretKey BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  ownerId TEXT NOT NULL,
  id TEXT NOT NULL,
  username TEXT NOT NULL,
  mlKemPublicKey TEXT NOT NULL,
  acceptedAt TEXT NOT NULL,
  PRIMARY KEY (ownerId, id)
);

CREATE TABLE IF NOT EXISTS conversations (
  ownerId TEXT NOT NULL,
  contactId TEXT NOT NULL,
  lastMessageSender TEXT,
  lastMessageMessage TEXT,
  lastMessageStatus TEXT,
  unreadCount INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (ownerId, contactId)
);

CREATE TABLE IF NOT EXISTS messages (
  ownerId TEXT NOT NULL,
  threadId TEXT NOT NULL,
  messageId TEXT NOT NULL,
  senderId TEXT NOT NULL,
  senderUsername TEXT NOT NULL,
  text TEXT,
  files TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  sentAt TEXT,
  deliveredAt TEXT,
  PRIMARY KEY (ownerId, messageId)
);

CREATE INDEX IF NOT EXISTS messages_thread ON messages (ownerId, threadId);
`;
