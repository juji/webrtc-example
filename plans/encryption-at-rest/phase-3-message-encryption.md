# Phase 3 — Message encryption / decryption

## Files

`client/lib/crypto.ts` (new), `client/lib/api.ts` (modified), `client/lib/use-webrtc-chat.ts` (modified), `server/src/routes/messages.ts` (modified)

## Scope: only the failover (server-relayed) path gets this encryption

The P2P data-channel path (`use-webrtc-chat.ts`'s `sendMessage`/`onmessage`) already gets transport encryption for free — every `RTCDataChannel` is mandatorily DTLS-wrapped by the browser, covered in the earlier encryption-at-rest discussion. Encrypting the P2P payload *again* with the ML-KEM/AES scheme below would be redundant for that transport and isn't what this plan is for (this plan is specifically about the `messages` table no longer holding plaintext — see checklist.md's Context).

What this phase actually changes: `dispatchTextViaServer` (the function `use-webrtc-chat.ts` calls when the data channel isn't open) now encrypts before calling `sendFailoverMessage`, and the receiving side needs to decrypt failover-delivered messages — both the one-shot catch-up fetch (`fetchFailoverMessages`) and the live push (`new-message` over the signaling WebSocket, handled in `message-status-listener.tsx`) go through the same decrypt path, since a message can arrive via either.

## Client: encrypt/decrypt module

`client/lib/crypto.ts` (new):

```ts
import { ml_kem768 } from "@noble/post-quantum/ml-kem";
import { loadKeys } from "./keys";

export type EncryptedPayload = { kemCiphertext: string; cipherIv: string; cipherText: string };

export async function encryptForRecipient(
  recipientKemPublicKey: Uint8Array,
  plaintext: string,
): Promise<EncryptedPayload> {
  const { cipherText: kemCiphertext, sharedSecret } = ml_kem768.encapsulate(recipientKemPublicKey);

  const aesKey = await crypto.subtle.importKey("raw", sharedSecret, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: kemCiphertext },
    aesKey,
    new TextEncoder().encode(plaintext),
  );

  return {
    kemCiphertext: toBase64(kemCiphertext),
    cipherIv: toBase64(iv),
    cipherText: toBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptFromSender(
  selfUsername: string,
  payload: EncryptedPayload,
): Promise<string> {
  const keys = await loadKeys(selfUsername);
  if (!keys) throw new Error("no local key to decrypt with");

  const kemCiphertext = fromBase64(payload.kemCiphertext);
  const sharedSecret = ml_kem768.decapsulate(kemCiphertext, keys.kemSecretKey);

  const aesKey = await crypto.subtle.importKey("raw", sharedSecret, "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(payload.cipherIv), additionalData: kemCiphertext },
    aesKey,
    fromBase64(payload.cipherText),
  );

  return new TextDecoder().decode(decrypted);
}
```

AES-GCM itself uses the browser's native WebCrypto (`crypto.subtle`), not `@noble` — WebCrypto's AES-GCM is a standard, hardware-accelerated primitive; `@noble/post-quantum` is only needed for the parts WebCrypto doesn't support (ML-KEM, ML-DSA). `additionalData: kemCiphertext` binds the KEM ciphertext to the AES ciphertext per checklist.md's AEAD-associated-data decision — decryption fails closed if either is swapped independently.

## Client: wiring into the send/receive paths

`client/lib/api.ts`'s `sendFailoverMessage` needs the recipient's ML-KEM public key before it can encrypt — this means fetching `toUser`'s public key first (a new small endpoint or piggybacked onto the existing `searchUsers`/user lookup — `GET /users` already returns full `User` rows per the users route, so adding `mlKemPublicKey` to that response is the smaller change over adding a new endpoint):

```ts
export async function sendFailoverMessage(args: {
  clientId: string;
  fromUsername: string;
  toUsername: string;
  toKemPublicKey: Uint8Array; // caller already has this from the users list / chat page load
  text: string;
}): Promise<MessageRow> {
  const encrypted = await encryptForRecipient(args.toKemPublicKey, args.text);
  const res = await fetch(`${SERVER_URL}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: args.clientId,
      fromUsername: args.fromUsername,
      toUsername: args.toUsername,
      ...encrypted,
    }),
  });
  const { message } = await res.json();
  return message;
}
```

`use-webrtc-chat.ts`'s `dispatchTextViaServer` needs the peer's `mlKemPublicKey` in scope — the chat page already fetches/knows the peer (it's the route param), so this is threaded through as an extra piece of state alongside what's already loaded, not a new fetch on every send.

On the receiving side, both `fetchFailoverMessages`'s results and the `new-message` WebSocket push carry `{ kemCiphertext, cipherIv, cipherText }` instead of `text` — call `decryptFromSender(selfUsername, row)` before handing the row to `addMessage` in both places (`use-webrtc-chat.ts`'s catch-up effect, and `message-status-listener.tsx`'s live-push handler), so the two delivery paths converge on the same decrypted `ChatMessage` shape the UI already renders. `messages-store.ts`'s `ChatMessage`/`MessageRow` types keep `text?: string` as the decrypted plaintext — encryption is purely a wire/storage concern, never visible past the decrypt call.

## Server: pass encrypted fields through unchanged

`server/src/routes/messages.ts`'s `POST /` handler stops accepting `text` and instead accepts `kemCiphertext`/`cipherIv`/`cipherText`, storing them as opaque strings — no server-side validation of their contents beyond presence, since the server has no way to decrypt them and shouldn't try. `GET /` returns the same fields back unchanged (no transformation) for the client to decrypt.

```ts
messagesRoute.post('/', async (c) => {
  const { clientId, fromUsername, toUsername, kemCiphertext, cipherIv, cipherText } = await c.req.json<{
    clientId?: string
    fromUsername?: string
    toUsername?: string
    kemCiphertext?: string
    cipherIv?: string
    cipherText?: string
  }>()
  // ... existing validation, then:
  const [row] = await db
    .insert(messagesTable)
    .values({ clientId, fromUserId: fromUser.id, toUserId: toUser.id, kemCiphertext, cipherIv, cipherText })
    .returning()
  // ... unchanged from here
})
```

File attachments (`fileUrl`/`fileName`/`fileType`) are unaffected by this phase — those already live in RustFS, not as row content, and encrypting file bytes is a separate, larger piece of work (would need the same KEM-wrap-a-symmetric-key approach applied to the upload, out of scope here per checklist.md's deliberate scoping to "auth + at-rest encryption" of the `messages` table specifically).

## Verification

1. Send a message through the failover path (data channel deliberately not open — e.g. one peer's chat page not mounted) and confirm the recipient's UI shows the correct decrypted text.
2. **Inspect the actual Postgres row directly** (`psql` or drizzle studio) for that message and confirm `cipher_text`/`kem_ciphertext` are base64 blobs with no relation to the plaintext — this is the phase's core claim (checklist.md: "encrypted at rest means the server cannot decrypt it") and must be checked against the real stored bytes, not just inferred from the app round-tripping correctly.
3. Confirm a message sent while both peers are online (P2P data channel open, failover never invoked) still works exactly as before — this phase must not change P2P-path behavior at all.
4. Confirm `decryptFromSender` throws (not silently returns garbage) if fed a `cipherText` that was tampered with (flip a byte) — proves the AEAD auth tag is actually being checked, not just carried along uselessly.
5. `bunx tsc --noEmit` clean in both `client/` and `server/`.
