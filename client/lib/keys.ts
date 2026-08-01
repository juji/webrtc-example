import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import type { KeyBundle } from "primssg-db";
import { useDbStore } from "./db-store";

export type { KeyBundle } from "primssg-db";

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

export function generateKeys(): KeyBundle {
  const dsa = ml_dsa65.keygen();
  const kem = ml_kem768.keygen();
  return {
    dsaPublicKey: dsa.publicKey,
    dsaSecretKey: dsa.secretKey,
    kemPublicKey: kem.publicKey,
    kemSecretKey: kem.secretKey,
  };
}

// Split from generateKeys() because registration needs the public keys
// before the server round-trip (to send them), but can only store the
// bundle under the server-issued id after that round-trip completes.
export async function storeKeys(id: string, bundle: KeyBundle): Promise<void> {
  await useDbStore.getState().connect();
  await useDbStore.getState().db.storeKeys(id, bundle);
}

export async function loadKeys(id: string): Promise<KeyBundle | undefined> {
  await useDbStore.getState().connect();
  return useDbStore.getState().db.loadKeys(id);
}
