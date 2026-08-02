# Encrypting server-stored message content — discussion, not a plan

**TL;DR:** `messages.text` and attachment bytes in S3/RustFS are stored in plaintext today, despite the app calling itself "post-quantum encrypted messaging." The identity keys needed to bootstrap encryption already exist and are already distributed (no server round-trip needed) — nobody's wired them up yet. Since nothing's encrypted today, this should get real forward secrecy from the start: a ratchet built on top of the existing static keys, not just static-key hybrid encryption. This doc captures the gap, the fix's shape, and the real open questions. Nothing here is scoped into an implementation plan.

## What already exists, unused for this purpose

- **Keys**: every user gets a real ML-KEM-768 keypair + an ML-DSA-65 signing keypair at registration (`client/lib/keys.ts`'s `generateKeys()`). Public keys go to the server (`users.mlDsaPublicKey` / `mlKemPublicKey`); secret keys stay local (`storeKeys`/`loadKeys`, `packages/primssg-db`'s `keys` table).
- **Key distribution is already solved**: contacts pin a verified copy of the peer's `mlKemPublicKey` at accept time (`Contact.mlKemPublicKey`, `client/lib/contacts.ts`'s `syncAcceptedContact`), checked against a QR-scanned fingerprint, never re-fetched. Encrypting to an existing contact needs **zero server round-trip** — `getContact(ownerId, peerId)` returns the key straight from local SQLite.
- **None of it is used to encrypt anything today.** It exists purely for identity verification (the QR/fingerprint handshake). Message text and attachments go over the wire and into storage as-is.
- **Transport protection differs by path today:**
  - P2P (`RTCDataChannel`): DTLS-encrypted in transit between the two peers. A `relay`-policy TURN server forwards the encrypted UDP but can't read it.
  - Server-relay (`sendFailoverMessage`/`sendFailoverFile`): plain HTTPS to the server, then stored as **plaintext** rows/objects. This is the actual gap.

## The fix, in shape: hybrid encryption + a ratchet for forward secrecy

Encrypted-but-not-forward-secret was the first framing here, then corrected: since messages sit unencrypted today, this should get real forward secrecy from the start, not bolt it on later. That changes the shape — `mlKemPublicKey` (the permanent identity key, pinned at contact-accept time, verified via QR fingerprint) **never changes and is never touched again** after that verification step. It's used for exactly one thing: bootstrapping a session. Everything that provides forward secrecy is new evolving state layered on top of it, not a modification to it.

**Bootstrap (once per conversation).** `ml_kem768.encapsulate(contact.mlKemPublicKey)` → a root shared secret. This is the only time the static identity key encrypts anything directly.

**Ratchet forward from there (new, persistent per-conversation state — not the identity key):**
- **Symmetric chain**: derive a chain key from the root secret via HKDF. Every message advances it (`nextChainKey, messageKey = HKDF(chainKey)`); the old chain key is deleted immediately after deriving the next one. One-way derivation means holding `messageKey #5` doesn't let you recover `messageKey #4` — forward secrecy within a session, cheap, no new PQ primitive needed.
- **Asymmetric/KEM ratchet**: generate a fresh *ephemeral* ML-KEM keypair (thrown away after use, not the permanent `keys` table bundle), encapsulate a new shared secret against the peer's latest ephemeral public key, mix it into the chain. This is what recovers security going forward even after a brief compromise, not just protects the past. **Interval — decided, Signal's rule**: not every message, but every time a party sends the *first* message after receiving one, i.e. whenever the conversation's direction flips. That sender generates the new ephemeral keypair, includes its public key with the message, and ratchets the root key forward using it. A reply-heavy back-and-forth ratchets on nearly every message; a one-sided burst in the same direction doesn't re-ratchet until the other side replies.
- **Where this lives — decided.** Two different kinds of ratchet data, two different homes:
  - **Per-conversation state** (chain key, peer's latest ephemeral public key) → a new dedicated column on `Contact` (`packages/primssg-db/src/types.ts` / `schema.ts`), e.g. `ratchetState: string | null` (JSON-encoded, nullable until a session exists) — separate from and never overwriting `mlKemPublicKey`. This is mutable, read/written on nearly every message, so it gets its own column and its own read/write path (`addContact`/`getContact` in `packages/primssg-db`, same pattern as this session's `unreadCount`/`serverId` additions — including a `migrate()` entry for existing local DBs). Not a blob buried in another field: hiding frequently-touched state inside another column's payload would mean deserializing something unrelated just to read it.
  - **Per-message metadata** (this message's ratchet-step public key when present, message counter, AES-GCM nonce) → packed into one opaque blob inside the existing `text` column, *not* new `messages` columns. This is per-message, write-once, and irrelevant to any query the server runs — `text` is already becoming an opaque ciphertext envelope under this design, so the ratchet metadata belongs inside that envelope, not as separate server-schema columns that only exist to serve client-side decryption the server has no reason to understand. Keeps "add a new ratchet parameter later" a client-only change, no migration.

Standard hybrid pattern for actually encrypting a payload once a message key is derived (from the ratchet, not directly from the static key):

1. Derive/advance the chain key → get this message's symmetric key (see ratchet above).
2. Encrypt the payload with AES-GCM (`crypto.subtle.encrypt` — already in-browser, no new dependency).
3. Send/store: whatever ratchet-step metadata the recipient needs to advance their own chain (e.g. the sender's current ephemeral public key, a message counter) + the AES-GCM ciphertext + nonce. Server only ever sees opaque bytes.
4. Recipient: advances their chain the same way, derives the same message key, decrypts.

**Text.** Applies before `POST /messages` and before the P2P `dc.send({kind: "text", ...})` frame — see "Both transports, not staged" below. `server/src/routes/messages.ts`'s `text` column holds the whole envelope (AES-GCM ciphertext + packed ratchet metadata + nonce) verbatim, per the "Where this lives" decision above.

**Attachments.** The presign → PUT → confirm flow already exists (`server/src/routes/messages.ts`). Encrypt client-side before the presigned PUT and RustFS never sees plaintext; decrypt client-side after download. The server doesn't need to know the bytes are encrypted. Open tradeoff: `fileName`/`fileType` sent alongside are currently visible to the server (used for `Content-Type` + shown in the UI) — encrypting file contents while leaving name/type visible is the cheap first step; hiding those too needs a placeholder-then-decrypt approach.

**Both transports, not staged.** DTLS already protects P2P in transit, which made it look safe to defer. But the key lookup is free and the crypto call is the same helper regardless of transport — there's no actual cost saved by staging it. `dispatchTextViaServer`/`dispatchFileViaServer` (server-relay) and the direct `dc.send(...)` calls (P2P) should both go through one shared encrypt-before-send / decrypt-after-receive helper, in the same first slice. Otherwise P2P is left on a weaker guarantee (DTLS wire protection only) than server-relay for no real reason.

**Multi-device — decided, deferred (not built now).** Keys are stored per-`id`, client-side only, never synced (`storeKeys`/`loadKeys`, `packages/primssg-db`'s `keys` table) — a second device logging in today has no way to get the same secret key, so it can't decrypt existing history and might not even receive new messages correctly. Resolved shape: **P2P device sync, no master — every device just needs to know about the others.** No single device is privileged; each device in the set can propagate key/ratchet-state updates to any other device it's connected to (mesh, not hub-and-spoke), over an authenticated, encrypted P2P channel — same primitives as everything else here, not a new mechanism. This needs a new **Config menu** for the user to view/manage which devices are part of the set and approve new ones joining. Not building this now — this app stays effectively single-device until it's picked up — but the shape is decided so it doesn't block the ratchet/schema design above (multi-device sync layers on top of whatever per-conversation ratchet state exists, it doesn't change it).

## Open questions

**1. What metadata stays visible** — *bigger than first written, not fully resolved*
Encrypting `text` and attachment bytes only protects content. Everything else on the `messages` row (`server/src/db/schema.ts`) stays server-visible under this design as currently scoped:
- `fromUserId` / `toUserId` — **the social graph itself**: who talks to whom, and (via `createdAt`) when. Structurally required for server-relay routing/delivery (`notifyUser`, `GET /messages?peer=&self=`) — not optional metadata, the server can't deliver what it can't address. The real question is whether it needs to sit in cleartext on a *persisted* row long-term, not whether the server ever sees it. A true fix (sealed sender, onion routing) is a materially bigger, separate project — not addressed here, just named as a known gap.
- `fileName` / `fileType` — visible today (used for the presigned PUT's `Content-Type` and shown in the chat UI). Hiding them is possible but adds complexity: a placeholder value at upload time, real value decrypted client-side after download.
- `recipientAckedAt` / `recipientReadAt` — delivery/read-receipt timestamps, inherently server-visible since the server is the one recording them.
- **Push notification body — fixed.** `notifyUserByPush`'s body (`server/src/routes/messages.ts`, both `POST /` and `POST /attachment/confirm`) used to send actual message content / filename to a third-party push provider (`` `${fromUsername}: ${text ?? ''}` ``, `` `${fromUsername} sent a file: ${fileName}` ``). Changed to a fixed `` `New message from ${fromUsername}` `` for both — username only, no content, independent of whether `text` is ciphertext or plaintext.

**2. Signing** — *not even raised until now*
ML-DSA-65 keys exist and are registered but completely unused — not even for the identity handshake (which relies on KEM-key fingerprint matching, not a DSA signature). Whether encrypted messages should also be signed (authenticity, not just confidentiality) is a separate question nobody's asked yet.

## Status

Nothing above is scoped into an implementation plan. This is a snapshot of the gap and the realistic shape of a fix given what's already in the codebase, for whenever it gets picked up.
