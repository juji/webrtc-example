export type Contact = {
  ownerUsername: string; // which locally-registered identity this contact belongs to
  id: string; // the contact's user id
  username: string;
  mlKemPublicKey: string; // base64, pinned at accept time — never re-fetched
  acceptedAt: string;
};

const DB_NAME = "webrtc-contacts";
const STORE_NAME = "contacts";
const OWNER_INDEX = "ownerUsername";

// Scoped per local identity (compound keyPath) since a single browser can hold
// multiple registered accounts — see client/lib/keys.ts's same username-keyed
// pattern. The server never stores this list at all (see plans/contacts'
// Context): once a request is accepted, the contact only exists here.
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE_NAME, { keyPath: ["ownerUsername", "id"] });
      store.createIndex(OWNER_INDEX, "ownerUsername");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addContact(contact: Contact): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(contact);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listContacts(ownerUsername: string): Promise<Contact[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).index(OWNER_INDEX).getAll(ownerUsername);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getContact(ownerUsername: string, id: string): Promise<Contact | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get([ownerUsername, id]);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
