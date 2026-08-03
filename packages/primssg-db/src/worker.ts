import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import { SCHEMA_SQL } from "./schema";
import type { Contact, Conversation, ConvoMessage, KeyBundle, LastMessage, Settings } from "./types";
import type { DebugQueryResult, WorkerRequest, WorkerResponse } from "./worker-protocol";

const DEFAULT_SETTINGS: Settings = { notificationSound: "unfocused", notificationSoundFile: "universfield-new-notification-012-363675.mp3" };

const DB_FILENAME = "/primssg.sqlite3";

// Runs inside the dedicated Worker PrimssgDBWasm (primssg-db-wasm.ts) spawns
// and owns. installOpfsSAHPoolVfs/OpfsSAHPoolDb both require a Worker context —
// this file is that context, never imported/run on the main thread directly.
// SAHPool over the standard OPFS VFS: no SharedArrayBuffer/COOP/COEP, which
// would otherwise break cross-origin map tile loading elsewhere in the app
// (plans/sqlite-migration Context). Trade-off: one tab can hold the DB at a
// time — second-tab detection via navigator.locks is separate, caller-side work.
class PrimssgDBWasmEngine {
  private db: Database | null = null;

  async connect(): Promise<void> {
    const sqlite3 = await sqlite3InitModule();
    const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: "primssg-db" });
    this.db = new poolUtil.OpfsSAHPoolDb(DB_FILENAME);
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  // CREATE TABLE IF NOT EXISTS in SCHEMA_SQL only creates missing tables, not
  // missing columns on tables that already existed pre-change — ad hoc column
  // migrations for existing local DBs go here, each guarded by its own check.
  private migrate(): void {
    const db = this.requireDb();

    const conversationsColumns = db.exec({
      sql: "PRAGMA table_info(conversations)",
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as { name: string }[];
    if (!conversationsColumns.some((c) => c.name === "unreadCount")) {
      db.exec("ALTER TABLE conversations ADD COLUMN unreadCount INTEGER NOT NULL DEFAULT 0");
    }

    const messagesColumns = db.exec({
      sql: "PRAGMA table_info(messages)",
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as { name: string }[];
    if (!messagesColumns.some((c) => c.name === "serverId")) {
      db.exec("ALTER TABLE messages ADD COLUMN serverId TEXT");
    }
    if (!messagesColumns.some((c) => c.name === "file")) {
      db.exec("ALTER TABLE messages ADD COLUMN file TEXT")
      if (messagesColumns.some((c) => c.name === "files")) {
        // Old rows stored a files JSON array (never more than one element in
        // practice — see plans/encryption's "wrong type" discussion) — carry
        // element 0 forward into the new singular column, then drop the old one.
        db.exec(`UPDATE messages SET file = json_extract(files, '$[0]') WHERE files != '[]'`)
        db.exec("ALTER TABLE messages DROP COLUMN files")
      }
    }
  }

  disconnect(): void {
    this.db?.close();
    this.db = null;
  }

  private requireDb(): Database {
    if (!this.db) throw new Error("PrimssgDBWasm: not connected — call connect() first");
    return this.db;
  }

  // keys

  storeKeys(id: string, bundle: KeyBundle): void {
    this.requireDb().exec({
      sql: `INSERT INTO keys (id, dsaPublicKey, dsaSecretKey, kemPublicKey, kemSecretKey)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              dsaPublicKey = excluded.dsaPublicKey,
              dsaSecretKey = excluded.dsaSecretKey,
              kemPublicKey = excluded.kemPublicKey,
              kemSecretKey = excluded.kemSecretKey`,
      bind: [id, bundle.dsaPublicKey, bundle.dsaSecretKey, bundle.kemPublicKey, bundle.kemSecretKey],
    });
  }

  loadKeys(id: string): KeyBundle | undefined {
    const rows = this.requireDb().exec({
      sql: "SELECT dsaPublicKey, dsaSecretKey, kemPublicKey, kemSecretKey FROM keys WHERE id = ?",
      bind: [id],
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as Record<string, Uint8Array>[];
    const row = rows[0];
    if (!row) return undefined;
    return {
      dsaPublicKey: row.dsaPublicKey,
      dsaSecretKey: row.dsaSecretKey,
      kemPublicKey: row.kemPublicKey,
      kemSecretKey: row.kemSecretKey,
    };
  }

  // contacts

  addContact(contact: Contact): void {
    this.requireDb().exec({
      sql: `INSERT INTO contacts (ownerId, id, username, mlKemPublicKey, acceptedAt)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(ownerId, id) DO UPDATE SET
              username = excluded.username,
              mlKemPublicKey = excluded.mlKemPublicKey,
              acceptedAt = excluded.acceptedAt`,
      bind: [contact.ownerId, contact.id, contact.username, contact.mlKemPublicKey, contact.acceptedAt],
    });
  }

  listContacts(ownerId: string): Contact[] {
    return this.requireDb().exec({
      sql: "SELECT ownerId, id, username, mlKemPublicKey, acceptedAt FROM contacts WHERE ownerId = ?",
      bind: [ownerId],
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as Contact[];
  }

  getContact(ownerId: string, id: string): Contact | undefined {
    const rows = this.requireDb().exec({
      sql: "SELECT ownerId, id, username, mlKemPublicKey, acceptedAt FROM contacts WHERE ownerId = ? AND id = ?",
      bind: [ownerId, id],
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as Contact[];
    return rows[0];
  }

  // chats

  listConversations(ownerId: string): Conversation[] {
    const rows = this.requireDb().exec({
      sql: `SELECT ownerId, contactId, lastMessageSender, lastMessageMessage, lastMessageStatus, unreadCount, createdAt
            FROM conversations WHERE ownerId = ?`,
      bind: [ownerId],
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as Record<string, string | number | null>[];
    return rows.map(rowToConversation);
  }

  getOrCreateConversation(ownerId: string, contactId: string): Conversation {
    const db = this.requireDb();
    const existingRows = db.exec({
      sql: `SELECT ownerId, contactId, lastMessageSender, lastMessageMessage, lastMessageStatus, unreadCount, createdAt
            FROM conversations WHERE ownerId = ? AND contactId = ?`,
      bind: [ownerId, contactId],
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as Record<string, string | number | null>[];
    if (existingRows[0]) return rowToConversation(existingRows[0]);

    const conversation: Conversation = {
      ownerId,
      contactId,
      lastMessage: null,
      unreadCount: 0,
      createdAt: new Date().toISOString(),
    };
    db.exec({
      sql: "INSERT INTO conversations (ownerId, contactId, createdAt) VALUES (?, ?, ?)",
      bind: [conversation.ownerId, conversation.contactId, conversation.createdAt],
    });
    return conversation;
  }

  setLastMessage(ownerId: string, contactId: string, lastMessage: LastMessage): void {
    this.requireDb().exec({
      sql: `INSERT INTO conversations (ownerId, contactId, lastMessageSender, lastMessageMessage, lastMessageStatus, createdAt)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(ownerId, contactId) DO UPDATE SET
              lastMessageSender = excluded.lastMessageSender,
              lastMessageMessage = excluded.lastMessageMessage,
              lastMessageStatus = excluded.lastMessageStatus`,
      bind: [
        ownerId,
        contactId,
        lastMessage.sender,
        lastMessage.message,
        lastMessage.status,
        new Date().toISOString(),
      ],
    });
  }

  incrementUnread(ownerId: string, contactId: string): void {
    this.requireDb().exec({
      sql: `INSERT INTO conversations (ownerId, contactId, unreadCount, createdAt)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(ownerId, contactId) DO UPDATE SET unreadCount = unreadCount + 1`,
      bind: [ownerId, contactId, new Date().toISOString()],
    });
  }

  clearUnread(ownerId: string, contactId: string): void {
    this.requireDb().exec({
      sql: "UPDATE conversations SET unreadCount = 0 WHERE ownerId = ? AND contactId = ?",
      bind: [ownerId, contactId],
    });
  }

  // convos

  addMessage(message: ConvoMessage): void {
    this.requireDb().exec({
      sql: `INSERT INTO messages (ownerId, threadId, messageId, serverId, senderId, senderUsername, text, file, status, createdAt, sentAt, deliveredAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ownerId, messageId) DO UPDATE SET
              threadId = excluded.threadId,
              serverId = excluded.serverId,
              senderId = excluded.senderId,
              senderUsername = excluded.senderUsername,
              text = excluded.text,
              file = excluded.file,
              status = excluded.status,
              createdAt = excluded.createdAt,
              sentAt = excluded.sentAt,
              deliveredAt = excluded.deliveredAt`,
      bind: [
        message.ownerId,
        message.threadId,
        message.messageId,
        message.serverId ?? null,
        message.sender.id,
        message.sender.username,
        message.text ?? null,
        message.file ? JSON.stringify(message.file) : null,
        message.status,
        message.createdAt,
        message.sentAt,
        message.deliveredAt,
      ],
    });
  }

  listMessages(ownerId: string, threadId: string): ConvoMessage[] {
    const rows = this.requireDb().exec({
      sql: `SELECT ownerId, threadId, messageId, serverId, senderId, senderUsername, text, file, status, createdAt, sentAt, deliveredAt
            FROM messages WHERE ownerId = ? AND threadId = ? ORDER BY createdAt`,
      bind: [ownerId, threadId],
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as Record<string, string | null>[];
    return rows.map(rowToConvoMessage);
  }

  // file blobs

  private async getFileBlobsDir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle("file-blobs", { create: true });
  }

  async storeFileBlob(key: string, blob: Blob): Promise<void> {
    const dir = await this.getFileBlobsDir();
    const fileHandle = await dir.getFileHandle(key, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async getFileBlob(key: string): Promise<Blob | undefined> {
    const dir = await this.getFileBlobsDir();
    try {
      const fileHandle = await dir.getFileHandle(key);
      return await fileHandle.getFile();
    } catch {
      return undefined;
    }
  }

  // settings

  getOrCreateSettings(id: string): Settings {
    const db = this.requireDb();
    const rows = db.exec({
      sql: "SELECT settings FROM settings WHERE id = ?",
      bind: [id],
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as { settings: string }[];
    if (rows[0]) return JSON.parse(rows[0].settings);

    db.exec({
      sql: "INSERT INTO settings (id, settings) VALUES (?, ?)",
      bind: [id, JSON.stringify(DEFAULT_SETTINGS)],
    });
    return DEFAULT_SETTINGS;
  }

  updateSettings(id: string, settings: Settings): void {
    this.requireDb().exec({
      sql: `INSERT INTO settings (id, settings) VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET settings = excluded.settings`,
      bind: [id, JSON.stringify(settings)],
    });
  }

  // Dev-only raw-SQL escape hatch for /dev/sqlite — see worker-protocol.ts.
  // Not exposed on PrimssgDB; real callers never reach this.
  debugQuery(sql: string): DebugQueryResult {
    const columns: string[] = [];
    const rows = this.requireDb().exec({
      sql,
      rowMode: "array",
      returnValue: "resultRows",
      columnNames: columns,
    }) as unknown as unknown[][];
    return { columns, rows };
  }
}

function rowToConversation(row: Record<string, string | number | null>): Conversation {
  return {
    ownerId: row.ownerId as string,
    contactId: row.contactId as string,
    lastMessage:
      row.lastMessageSender && row.lastMessageMessage && row.lastMessageStatus
        ? {
            sender: row.lastMessageSender as string,
            message: row.lastMessageMessage as string,
            status: row.lastMessageStatus as string,
          }
        : null,
    unreadCount: row.unreadCount as number,
    createdAt: row.createdAt as string,
  };
}

function rowToConvoMessage(row: Record<string, string | null>): ConvoMessage {
  return {
    ownerId: row.ownerId!,
    threadId: row.threadId!,
    messageId: row.messageId!,
    serverId: row.serverId ?? undefined,
    sender: { id: row.senderId!, username: row.senderUsername! },
    text: row.text ?? undefined,
    file: row.file ? JSON.parse(row.file) : undefined,
    status: row.status as ConvoMessage["status"],
    createdAt: row.createdAt!,
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt,
  };
}

const engine = new PrimssgDBWasmEngine();
const connectReady = engine.connect();

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = event.data;
  try {
    await connectReady;
    // biome-ignore lint: dispatch table, args shape is guaranteed by the caller-side proxy
    const result = await (engine[method] as (...a: unknown[]) => unknown)(...args);
    const response: WorkerResponse = { id, ok: true, result };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(response);
  }
};
