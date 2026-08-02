import { PrimssgDB } from "./primssg-db";
import type { Contact, Conversation, ConvoMessage, KeyBundle, LastMessage } from "./types";
import type { DebugQueryResult, WorkerRequest, WorkerResponse } from "./worker-protocol";

const LOCK_NAME = "primssg-db";

// Thrown by connect() when another tab already holds the DB lock. SAHPool
// only allows one open Access Handle per file across the whole browser, so a
// second tab connecting would otherwise surface SAHPool's raw
// createSyncAccessHandle failure instead of a clean, catchable state.
export class PrimssgDBLockedError extends Error {
  constructor() {
    super("primssg-db is already open in another tab");
    this.name = "PrimssgDBLockedError";
  }
}

// Main-thread class — callers never know a Worker exists underneath. connect()
// spawns and owns worker.ts (which does the real sqlite3InitModule/SAHPool/SQL
// work, since that only runs in a Worker context); every method here just
// posts a request and awaits the matching response. disconnect() terminates it.
export class PrimssgDBWasm extends PrimssgDB {
  private worker: Worker | null = null;
  private nextRequestId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private releaseLock: (() => void) | null = null;
  private connecting: Promise<void> | null = null;

  // Guarded against concurrent calls with an in-flight promise, not just a
  // this.worker check — two connect() calls made back-to-back (e.g. React
  // effects firing twice under Strict Mode) would otherwise both see
  // this.worker === null and both try to acquire the lock, and the second
  // one would see the first as "another tab" holding it and fail.
  connect(): Promise<void> {
    if (this.worker) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    const acquired = await this.acquireLock();
    if (!acquired) throw new PrimssgDBLockedError();

    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (event.data.ok) pending.resolve(event.data.result);
      else pending.reject(new Error(event.data.error));
    };
  }

  // Web Locks are held for the lifetime of the promise passed to the
  // callback, and released automatically if the tab closes or crashes — so
  // this also clears out a stale lock left by a tab that never called
  // disconnect(). ifAvailable: true makes request() resolve immediately
  // (with null) instead of queuing when another tab already holds it.
  private acquireLock(): Promise<boolean> {
    return new Promise((resolveAcquired) => {
      navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolveAcquired(false);
          return Promise.resolve();
        }
        return new Promise<void>((releaseLock) => {
          this.releaseLock = releaseLock;
          resolveAcquired(true);
        });
      });
    });
  }

  async disconnect(): Promise<void> {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.releaseLock?.();
    this.releaseLock = null;
  }

  private call<T>(method: WorkerRequest["method"], args: unknown[]): Promise<T> {
    if (!this.worker) throw new Error("PrimssgDBWasm: not connected — call connect() first");
    const id = this.nextRequestId++;
    const request: WorkerRequest = { id, method, args };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker!.postMessage(request);
    });
  }

  // keys

  storeKeys(id: string, bundle: KeyBundle): Promise<void> {
    return this.call("storeKeys", [id, bundle]);
  }

  loadKeys(id: string): Promise<KeyBundle | undefined> {
    return this.call("loadKeys", [id]);
  }

  // contacts

  addContact(contact: Contact): Promise<void> {
    return this.call("addContact", [contact]);
  }

  listContacts(ownerId: string): Promise<Contact[]> {
    return this.call("listContacts", [ownerId]);
  }

  getContact(ownerId: string, id: string): Promise<Contact | undefined> {
    return this.call("getContact", [ownerId, id]);
  }

  // chats

  listConversations(ownerId: string): Promise<Conversation[]> {
    return this.call("listConversations", [ownerId]);
  }

  getOrCreateConversation(ownerId: string, contactId: string): Promise<Conversation> {
    return this.call("getOrCreateConversation", [ownerId, contactId]);
  }

  setLastMessage(ownerId: string, contactId: string, lastMessage: LastMessage): Promise<void> {
    return this.call("setLastMessage", [ownerId, contactId, lastMessage]);
  }

  incrementUnread(ownerId: string, contactId: string): Promise<void> {
    return this.call("incrementUnread", [ownerId, contactId]);
  }

  clearUnread(ownerId: string, contactId: string): Promise<void> {
    return this.call("clearUnread", [ownerId, contactId]);
  }

  // convos

  addMessage(message: ConvoMessage): Promise<void> {
    return this.call("addMessage", [message]);
  }

  listMessages(ownerId: string, threadId: string): Promise<ConvoMessage[]> {
    return this.call("listMessages", [ownerId, threadId]);
  }

  // file blobs

  storeFileBlob(key: string, blob: Blob): Promise<void> {
    return this.call("storeFileBlob", [key, blob]);
  }

  getFileBlob(key: string): Promise<Blob | undefined> {
    return this.call("getFileBlob", [key]);
  }

  // Dev-only raw-SQL escape hatch for /dev/sqlite. Not on PrimssgDB — only
  // reachable through a concrete PrimssgDBWasm reference, never through code
  // typed against the PrimssgDB interface real callers use.
  debugQuery(sql: string): Promise<DebugQueryResult> {
    return this.call("debugQuery", [sql]);
  }
}
