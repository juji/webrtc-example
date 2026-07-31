## Context

Today there is no way for two users to start a conversation

Decided:
- **No searchable contact database.** Users cannot look each other up by username or any other query. The only way to become contacts is the live QR handshake below.
- **QR content is `{ id, keyFingerprint, username }` of the user showing the code, not the raw `mlKemPublicKey`.** The ML-KEM-768 public key is ~1184 bytes (~1580 base64 chars) — encoding it directly forces the QR to its largest, barely-scannable version. Instead the QR carries a short hash (`keyFingerprint`, e.g. truncated SHA-256) of the key. The scanning side fetches the actual public key from the server by `id`, then verifies it hashes to the fingerprint from the QR — same trust-on-first-use guarantee (server can't swap the key without the hash mismatching) with a small, cleanly-scannable payload. `id` + `keyFingerprint` are required; `username` is optional, display-only.

## Phase 1 — QR code creation

detail: [phase-1-qr-creation.md](phase-1-qr-creation.md)
- [x] **`fingerprint()` helper** (`client/lib/keys.ts`): SHA-256 of the local ML-KEM public key, truncated to 16 base64 chars
- [x] **QR trigger + render**: header icon button on `/chat` opens a `Popup` showing a QR (via the `qrcode` package) encoding `{ id, username, keyFingerprint }`, generated from the locally-stored key bundle
- [x] **Download button**: single, full-width, right-aligned footer button on the QR popup saves the code as `{username}-qr-code.png`
- [x] Responsive: QR image scales with the popup (`w-full max-w-sm`, `aspect-square`) instead of a fixed pixel size

## Phase 2 — QR code scan

## Phase 3 — The handshake

## Phase 4 — Contact persistence
