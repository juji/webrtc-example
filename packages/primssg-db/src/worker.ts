import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import { SCHEMA_SQL } from "./schema";
import type { Contact, Conversation, KeyBundle } from "./types";
import type { DebugQueryResult, WorkerRequest, WorkerResponse } from "./worker-protocol";

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
      sql: `SELECT ownerId, contactId, lastMessageSender, lastMessageMessage, lastMessageStatus, createdAt
            FROM conversations WHERE ownerId = ?`,
      bind: [ownerId],
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as Record<string, string | null>[];
    return rows.map(rowToConversation);
  }

  getOrCreateConversation(ownerId: string, contactId: string): Conversation {
    const db = this.requireDb();
    const existingRows = db.exec({
      sql: `SELECT ownerId, contactId, lastMessageSender, lastMessageMessage, lastMessageStatus, createdAt
            FROM conversations WHERE ownerId = ? AND contactId = ?`,
      bind: [ownerId, contactId],
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown as Record<string, string | null>[];
    if (existingRows[0]) return rowToConversation(existingRows[0]);

    const conversation: Conversation = {
      ownerId,
      contactId,
      lastMessage: null,
      createdAt: new Date().toISOString(),
    };
    db.exec({
      sql: "INSERT INTO conversations (ownerId, contactId, createdAt) VALUES (?, ?, ?)",
      bind: [conversation.ownerId, conversation.contactId, conversation.createdAt],
    });
    return conversation;
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

function rowToConversation(row: Record<string, string | null>): Conversation {
  return {
    ownerId: row.ownerId!,
    contactId: row.contactId!,
    lastMessage:
      row.lastMessageSender && row.lastMessageMessage && row.lastMessageStatus
        ? { sender: row.lastMessageSender, message: row.lastMessageMessage, status: row.lastMessageStatus }
        : null,
    createdAt: row.createdAt!,
  };
}

const engine = new PrimssgDBWasmEngine();
const connectReady = engine.connect();

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = event.data;
  try {
    await connectReady;
    // biome-ignore lint: dispatch table, args shape is guaranteed by the caller-side proxy
    const result = (engine[method] as (...a: unknown[]) => unknown)(...args);
    const response: WorkerResponse = { id, ok: true, result };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(response);
  }
};
