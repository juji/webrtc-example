import { PrimssgDB } from "./primssg-db";
import type { Contact, Conversation, KeyBundle } from "./types";
import type { DebugQueryResult, WorkerRequest, WorkerResponse } from "./worker-protocol";

// Main-thread class — callers never know a Worker exists underneath. connect()
// spawns and owns worker.ts (which does the real sqlite3InitModule/SAHPool/SQL
// work, since that only runs in a Worker context); every method here just
// posts a request and awaits the matching response. disconnect() terminates it.
export class PrimssgDBWasm extends PrimssgDB {
  private worker: Worker | null = null;
  private nextRequestId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  async connect(): Promise<void> {
    if (this.worker) return; // already connected — don't spawn a second worker
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

  async disconnect(): Promise<void> {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
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

  // Dev-only raw-SQL escape hatch for /dev/sqlite. Not on PrimssgDB — only
  // reachable through a concrete PrimssgDBWasm reference, never through code
  // typed against the PrimssgDB interface real callers use.
  debugQuery(sql: string): Promise<DebugQueryResult> {
    return this.call("debugQuery", [sql]);
  }
}
