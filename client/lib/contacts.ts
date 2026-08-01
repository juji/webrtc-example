import type { Contact } from "primssg-db";
import { fetchUserById } from "./api";
import { useDbStore } from "./db-store";
import { fingerprint, fromBase64 } from "./keys";

export type { Contact } from "primssg-db";

export async function addContact(contact: Contact): Promise<void> {
  await useDbStore.getState().connect();
  await useDbStore.getState().db.addContact(contact);
}

export async function listContacts(ownerId: string): Promise<Contact[]> {
  await useDbStore.getState().connect();
  return useDbStore.getState().db.listContacts(ownerId);
}

export async function getContact(ownerId: string, id: string): Promise<Contact | undefined> {
  await useDbStore.getState().connect();
  return useDbStore.getState().db.getContact(ownerId, id);
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
