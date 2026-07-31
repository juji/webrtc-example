import { fetchUserById } from "./api";
import { fingerprint, fromBase64 } from "./keys";

export type Contact = {
  ownerId: string; // which locally-registered identity this contact belongs to
  id: string; // the contact's user id
  username: string;
  mlKemPublicKey: string; // base64, pinned at accept time — never re-fetched
  acceptedAt: string;
};

const DB_NAME = "webrtc-contacts";
const STORE_NAME = "contacts";
const OWNER_INDEX = "ownerId";

// Scoped per local identity (compound keyPath) since a single browser can hold
// multiple registered accounts — see client/lib/keys.ts's same id-keyed
// pattern. The server never stores this list at all (see plans/contacts'
// Context): once a request is accepted, the contact only exists here.
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE_NAME, { keyPath: ["ownerId", "id"] });
      store.createIndex(OWNER_INDEX, "ownerId");
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

export async function listContacts(ownerId: string): Promise<Contact[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).index(OWNER_INDEX).getAll(ownerId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getContact(ownerId: string, id: string): Promise<Contact | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get([ownerId, id]);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Re-fetches the accepted contact's real public key and checks it against the
// fingerprint scanned at request time before persisting — never trusts a push
// payload's key claim directly. Shared by the live push handler and the
// notification list (an accepted request seen either way goes through the
// same verification). No-op-safe to call more than once: addContact() is a
// keyed upsert, so re-syncing an already-known contact just overwrites it.
export async function syncAcceptedContact(
  ownerId: string,
  contact: { id: string; username: string },
  scannedFingerprint: string,
): Promise<void> {
  const found = await fetchUserById(contact.id);
  if (!found) return;
  const actualFingerprint = await fingerprint(fromBase64(found.mlKemPublicKey));
  if (actualFingerprint !== scannedFingerprint) {
    console.error("contact-accepted verification failed, not persisting:", found.username);
    return;
  }
  await addContact({
    ownerId,
    id: found.id,
    username: found.username,
    mlKemPublicKey: found.mlKemPublicKey,
    acceptedAt: new Date().toISOString(),
  });
}
