# Phase 1 — Schema + key generation on registration

## Files

`server/src/db/schema.ts` (modified), `client/lib/keys.ts` (new), `client/lib/api.ts` (modified), `client/app/page.tsx` (modified)

## Dependency

`bun add @noble/post-quantum` in both `client/` and `server/` — same package, both sides. Server only needs it for verifying signatures in Phase 2; key *generation* happens exclusively in the browser.

## Schema changes

`server/src/db/schema.ts`:

```ts
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  mlDsaPublicKey: text('ml_dsa_public_key').notNull(),   // base64, verify key for login challenges
  mlKemPublicKey: text('ml_kem_public_key').notNull(),   // base64, encryption key for messages
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  clientId: text('client_id').notNull(),
  fromUserId: integer('from_user_id').notNull().references(() => users.id),
  toUserId: integer('to_user_id').notNull().references(() => users.id),
  kemCiphertext: text('kem_ciphertext'),   // base64, ML-KEM ciphertext — null when there's no text (file-only message)
  cipherIv: text('cipher_iv'),             // base64, AES-GCM nonce
  cipherText: text('cipher_text'),         // base64, AES-GCM ciphertext (replaces plaintext `text`)
  fileName: text('file_name'),
  fileType: text('file_type'),
  fileUrl: text('file_url'),
  recipientAckedAt: timestamp('recipient_acked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

`text` is dropped entirely, not kept alongside the encrypted columns — a plaintext fallback column would defeat the point. `kemCiphertext`/`cipherIv`/`cipherText` are all nullable together (a file-only message with no text body has none of them set); Phase 3 enforces "all three or none" at the application layer, not a DB constraint (matches how `fileName`/`fileType`/`fileUrl` already work as a nullable trio in the existing schema).

AES-GCM's auth tag doesn't need its own column — the `@noble` / WebCrypto AES-GCM implementations append the tag to the ciphertext output automatically; `cipherText` already contains it.

Run `bun run db:push` (existing `server/package.json` script, drizzle-kit) after editing the schema — no separate migration-file step in this project's current setup.

## Client: key generation module

`client/lib/keys.ts` (new):

```ts
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa";
import { ml_kem768 } from "@noble/post-quantum/ml-kem";

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
```

Keyed by `username` in the object store (not a single fixed key) — this device may have generated keys for more than one username over time (each `POST /auth/login` in the current flow can register a brand new username), and Phase 2's login flow needs to look up "do I already hold keys for *this* username" specifically, not just "do I hold any keys at all."

ML-DSA-65 and ML-KEM-768 (the "768"/"65" parameter sets) chosen as the mid-tier (~192-bit) security level — matches what `@noble/post-quantum`'s own docs recommend as the general-purpose default, not the low (44/512) or high (87/1024) tiers.

## Registration flow change

`client/lib/api.ts`'s `loginOrRegister` currently just POSTs `{ username }`. It now needs to distinguish "registering a new username" (generate keys, send both public keys) from "logging into an existing one" (Phase 2's challenge flow) — this phase only handles the registration half; Phase 2 replaces the rest of `loginOrRegister`.

```ts
// client/lib/api.ts — registration half only, login half rewritten in Phase 2
export async function register(username: string): Promise<User> {
  const { dsaPublicKey, kemPublicKey } = await generateAndStoreKeys(username);
  const res = await fetch(`${SERVER_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      mlDsaPublicKey: toBase64(dsaPublicKey),
      mlKemPublicKey: toBase64(kemPublicKey),
    }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "registration failed");
  const { user } = await res.json();
  return user;
}
```

`server/src/routes/auth.ts` splits `POST /auth/login` (currently register-or-login) into `POST /auth/register` (fails with 409 if the username already exists — registration is no longer implicit) and a login path that Phase 2 defines. This is the one behavior change users will notice: today, submitting an existing username silently logs in as it; after this phase, that path requires proving key possession (Phase 2), and a brand new username must go through explicit registration first.

`client/app/page.tsx`'s single form currently can't tell the two cases apart before submitting — Phase 2 covers the UI/flow change (check-if-exists, then branch to register vs. challenge-login) since it depends on the login endpoint that doesn't exist until then. This phase only needs `register()` itself to exist and work in isolation.

## Verification

1. `bunx tsc --noEmit` clean in both `client/` and `server/` after the schema + `keys.ts` changes.
2. `bun run db:push` succeeds, `psql` (or drizzle studio) shows `users.ml_dsa_public_key`/`ml_kem_public_key` as populated, non-null, base64-looking strings after calling `register()` from a scratch script or browser console.
3. Confirm the private keys never appear in any network request — inspect the actual POST body sent to `/auth/register` (browser devtools Network tab), confirm only `mlDsaPublicKey`/`mlKemPublicKey` are present, no secret-key fields anywhere in the payload.
4. Confirm `indexedDB.databases()` (or Application tab in devtools) shows the `webrtc-keys` store populated after registering, and that the stored secret keys round-trip: call `loadKeys(username)` and confirm the returned `dsaSecretKey`/`kemSecretKey` match what `generateAndStoreKeys` originally produced (byte-for-byte).
