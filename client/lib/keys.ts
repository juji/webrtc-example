import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Short, QR-friendly stand-in for a public key: the ML-KEM-768 key itself
// (~1184 bytes) is too large to encode directly into a scannable QR code.
export async function fingerprint(publicKey: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(publicKey).buffer as ArrayBuffer);
  return toBase64(new Uint8Array(digest)).slice(0, 16);
}

const DB_NAME = "webrtc-keys";
const STORE_NAME = "keys";

// IndexedDB, not localStorage: private key material is Uint8Array, and keeping it
// out of the same storage/devtools surface as ordinary session state (session-store.ts
// uses localStorage) is deliberate, not just a technical necessity.
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export type KeyBundle = {
  dsaPublicKey: Uint8Array;
  dsaSecretKey: Uint8Array;
  kemPublicKey: Uint8Array;
  kemSecretKey: Uint8Array;
};

export async function generateAndStoreKeys(username: string): Promise<KeyBundle> {
  const dsa = ml_dsa65.keygen();
  const kem = ml_kem768.keygen();
  const bundle: KeyBundle = {
    dsaPublicKey: dsa.publicKey,
    dsaSecretKey: dsa.secretKey,
    kemPublicKey: kem.publicKey,
    kemSecretKey: kem.secretKey,
  };

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(bundle, username);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return bundle;
}

export async function loadKeys(username: string): Promise<KeyBundle | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(username);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
