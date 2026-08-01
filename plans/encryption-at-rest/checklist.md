## Context

The server is not, and should not become, the primary store for message content. WebRTC P2P (see [[message-delivery-status]]) is the primary transport; the `messages` table (`server/src/db/schema.ts`) exists only as a dead-letter queue for delivering to a recipient who's currently offline — a row is meant to be transient, deleted once both sides are confirmed caught up (see message-delivery-status's two-step-ack design). Today, for however long a row does sit there, its `text`/`fileUrl` content is plaintext — readable by anything with DB access, including this app's own server code. Goal: that window of persistence should be encrypted, not plaintext, without changing the store's role from "temporary relay" to "message archive."

This is not a novel shape — it's the same pattern Signal/WhatsApp/iMessage already use: P2P (or a server that only ever forwards ciphertext) is the happy path, and a server-held mailbox exists purely for offline delivery, holding data the server operator cannot read.

Decided:
- **"Encrypted at rest" here means the *stored row* is ciphertext the server cannot decrypt** — not disk-level/volume encryption (Postgres's own at-rest disk encryption, if enabled, is a different and unrelated concern; it protects against someone stealing the physical disk, not against the server process itself reading a row it's serving). What's being addressed is server-side plaintext visibility, i.e., real end-to-end encryption of the failover path — the one place identified in [[message-delivery-status]] that currently has no DTLS-equivalent protection, unlike the P2P data-channel path which already gets transport encryption for free from WebRTC's mandatory DTLS.
- **Post-quantum is a hard requirement.** Symmetric encryption (AES-256, whatever actually encrypts the message bytes) is already considered quantum-resistant — Grover's algorithm only halves its effective strength (256→128-bit), which stays infeasible — so the requirement lands specifically on *key exchange/establishment*: the mechanism by which two devices agree on the key that encrypts a given message/row must itself be PQ (or hybrid), not classical-only (e.g. plain ECDH), so a recorded exchange can't be broken retroactively once a cryptographically-relevant quantum computer exists ("harvest now, decrypt later"). Signal's own protocol (PQXDH) takes exactly this hybrid approach — classical + PQ key exchange, classical symmetric cipher for the bulk data — rather than inventing a PQ block cipher that doesn't need to exist. This project follows the same shape: PQ/hybrid key exchange, standard AES-256 for the actual row ciphertext.
- **Key custody: the private key is generated client-side and never leaves the device.** For the server to be unable to read a row, the key that decrypts it must never reach the server — so the PQ keypair is generated in the browser at registration time, the public key is sent to and stored by the server (it's meant to be shared — that's what lets others encrypt *to* this user), and the private key is persisted locally only, never transmitted. This app currently has no per-user asymmetric identity at all (`users` table is just `id`/`username`/`created_at` — no keys, no auth beyond "type a username"), so this is new surface area on both the schema and the registration flow, not a tweak to the existing `messages` table.
- **This doubles as the auth mechanism — registration and key generation are the same event, not two separate steps.** Today `POST /auth/login` (`server/src/routes/auth.ts`) is register-or-login-by-username with no identity proof at all: submit any existing username and the server logs you in as it, no check performed. That gap gets closed as a side effect of this design, not as separate work: the client-held private key becomes the thing that proves "this session really is this username" (by signing a server-issued challenge), and "logged in" on a return visit means the browser still holds that key in local storage. **Scoped down deliberately: no passphrase-based recovery, no multi-device linking.** A lost/cleared browser means that identity's queued messages are permanently undecryptable and that username can't be logged back into from that device — an accepted gap for now, not solved here.
- **Contact discovery/verification (QR-code handshake, MITM-resistant key verification, first-message-to-an-offline-user pre-keys) is explicitly out of scope for this phase of work.** Those are real follow-on problems (see below) but are being deliberately deferred so auth + at-rest encryption can be scoped and built as a self-contained unit first.
- **Library: `@noble/post-quantum`** — a single, audited package covering both ML-KEM (FIPS 203, encryption) and ML-DSA (FIPS 204, signatures), runs identically in the browser and in Bun (no separate client/server implementations to keep in sync). Also ships a `hybrid` submodule (PQ + classical ECC combined), matching the hybrid shape decided above.
- **Two separate keypairs per user, not one reused for both jobs**: an ML-DSA keypair for signing (proves identity at login) and an ML-KEM keypair for encryption (lets others encrypt messages *to* this user). This mirrors Signal's separation of identity keys from encryption keys — a KEM keypair isn't meant to sign things, and reusing one primitive for both jobs would be a deviation needing its own justification, not the default.
- **Login is a signed-challenge exchange, not a password.** Server generates a random nonce, client signs it with the ML-DSA private key (which never leaves the browser), server verifies the signature against the ML-DSA public key already on file for that username. This is what actually closes today's `/auth/login` gap — replacing "no check" with "must hold the private key."
- **Message encryption is hybrid KEM+AEAD, not a single static shared key.** ML-KEM's `encap(recipientPublicKey)` produces a *fresh* KEM ciphertext + shared secret on every call — it is not a reusable Diffie-Hellman-style shared key. So each encrypted row stores its own KEM ciphertext alongside the AES-256-GCM ciphertext (KEM ciphertext used as AEAD associated data, binding the two together so neither can be swapped independently). The recipient's `decap(kemCiphertext, recipientPrivateKey)` reproduces the same shared secret, which becomes the AES key.

## Related, deliberately deferred (not part of this scoped-down phase)

Scaling this from "auth + encrypted-at-rest storage" to a genuinely trustworthy E2E system surfaces more design work, noted here so it isn't lost, but explicitly not part of the current scope:
- **User discovery today has zero access control** (`GET /users?q=` is an open username search — anyone can find and message anyone). A future contact/handshake model (e.g. QR-code-based, as raised in conversation) would change this.
- **Key verification / trust-on-first-use** — exchanging a public key doesn't by itself defend against a MITM (including a compromised server) handing out a substituted key. Needs an out-of-band verification step (Signal's safety numbers, WhatsApp's QR scan) — which is a different job than contact *discovery*, even if the same QR code ends up serving both.
- **Forward secrecy** — a single long-lived keypair per user (this phase's scope) does not provide it; that needs per-message key ratcheting (Signal's Double Ratchet), a materially bigger mechanism than a one-time handshake.
- **First-message-to-a-never-online-before recipient** — needs a pre-key-bundle scheme (Signal's X3DH) so a sender can encrypt to someone who has no active session yet; without it, messaging someone for the first time while they're offline (which works trivially today) breaks once messages are encrypted-to-a-key.
- **Multi-device** — "user" and "browser session" are the same thing today; once a private key lives in one browser's local storage, using the same username from a second device is an open question (separate keypair + fan-out per device, vs. a device-linking scheme).

## Phase 1 — Schema + key generation on registration

detail: [phase-1-schema-and-keygen.md](phase-1-schema-and-keygen.md)
- [x] **`users` table**: add columns for both public keys (ML-DSA verify key, ML-KEM encryption key)
- [x] **Client-side keypair generation at registration** — both keypairs generated in-browser via `@noble/post-quantum`, public halves sent to the server, private halves persisted locally and never transmitted
- [ ] **`messages` table**: replace plaintext `text` with the encrypted-row shape (KEM ciphertext, AES-GCM ciphertext, nonce/IV, auth tag) — deferred to Phase 5, not done in this pass (scoped down deliberately to land the login mechanism first)

## Phase 2 — Challenge-based login

detail: [phase-2-challenge-login.md](phase-2-challenge-login.md)
- [x] **`POST /auth/challenge`** — server issues a random nonce for a given username, short-lived
- [x] **`POST /auth/login` rewritten** — client signs the nonce with its ML-DSA private key; server verifies against the stored public key instead of trusting the username alone
- [x] **Client-side**: read the locally-stored ML-DSA private key on app load, use it to complete the challenge automatically when a session already exists on this device — no private key ever leaves the browser

## Phase 3 — Chat UI (readiness gate for message encryption)

detail: [phase-3-chat-ui.md](phase-3-chat-ui.md)
- [x] **Two-column chat layout**: conversation-list sidebar (glassmorphic sticky header, sticky bottom logout bar, empty state) + chat pane, single-column on mobile — prototyped at `/mockup` against fake data, then promoted to the real `/chat` route
- [x] **`/chat` is the new post-login landing page**, replacing `/users` — both redirect points in `client/app/page.tsx` updated; old real WebRTC chat page moved to `/chat-old/[username]` as reference, not routed
- [x] **User search removed everywhere** (`searchUsers()` deleted from `client/lib/api.ts`, `/users` stripped to a bare greeting + logout) — `/users` is currently unreachable from the app, an accepted gap until real conversation data replaces it
- [x] **Reusable `Popup` component** (`client/components/popup.tsx`): full-screen on mobile / centered+blurred-backdrop on desktop, header/content/footer slots, default Cancel-red/Confirm-green buttons, open/close animation via `tw-animate-css` — wired into the chat page's logout flow
- [x] **Dev workflow fixes**: `dev.sh` gates `db:push` and server startup behind real Postgres/RustFS readiness checks (was racing before), `bun run wipe` added for full local volume reset
- [x] **Real conversation data, real chat pane, and `chat-old` deletion all resolved by later plans** — real conversation data wired in `plans/contacts`, the chat pane's real UI/functionality built out across `plans/contacts` and `plans/convo`, `chat-old` deleted in `plans/convo` Phase 9

## Phase 4 — Adding contacts

detail: [phase-4-contacts.md](phase-4-contacts.md)
- [ ] TBD

## Phase 5 — Message encryption / decryption

detail: [phase-5-message-encryption.md](phase-5-message-encryption.md)
- [ ] **Sender path**: fetch recipient's ML-KEM public key, `encap()`, AES-256-GCM encrypt the message text using the shared secret, KEM ciphertext as AAD, send the encrypted bundle instead of plaintext `text`
- [ ] **Recipient path**: `decap()` using the locally-stored ML-KEM private key to recover the shared secret, AES-GCM decrypt
- [ ] **Verified**: a message sent through the failover path (`POST /messages`) is stored as ciphertext in Postgres — confirm by inspecting the row directly, not just through the app's own decrypt path
