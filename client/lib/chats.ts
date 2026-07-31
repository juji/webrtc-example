export type LastMessage = { sender: string; message: string; status: string };

export type Conversation = {
  ownerId: string; // which locally-registered identity this conversation belongs to
  contactId: string; // the other party's user id
  lastMessage: LastMessage | null; // no messaging UI yet — always null until that's built
  createdAt: string;
};

const DB_NAME = "webrtc-chats";
const STORE_NAME = "chats";
const OWNER_INDEX = "ownerId";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE_NAME, { keyPath: ["ownerId", "contactId"] });
      store.createIndex(OWNER_INDEX, "ownerId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listConversations(ownerId: string): Promise<Conversation[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).index(OWNER_INDEX).getAll(ownerId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Idempotent: returns the existing conversation if one's already there,
// otherwise creates an empty one. Selecting a contact always resolves to
// exactly one conversation record, never a duplicate.
export async function getOrCreateConversation(ownerId: string, contactId: string): Promise<Conversation> {
  const db = await openDb();
  const existing = await new Promise<Conversation | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get([ownerId, contactId]);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (existing) return existing;

  const conversation: Conversation = {
    ownerId,
    contactId,
    lastMessage: null,
    createdAt: new Date().toISOString(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(conversation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return conversation;
}
