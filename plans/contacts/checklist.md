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

detail: [phase-2-qr-scan.md](phase-2-qr-scan.md)
- [x] **`GET /users/:id`** (`server/src/routes/users.ts`): looked up by id only (not search), returns `{ id, username, mlKemPublicKey }` — needed to fetch a scanned contact's real key
- [x] **Popup merged into one, tabbed component** (`client/components/qr-code-popup.tsx`): "QR Code" title, "My QR Code" / "Scan QR Code" tabs; the old inline QR-generation code from `/chat` moved here unchanged
- [x] **Scan tab**: live camera (`getUserMedia`, rear camera preferred) decoded frame-by-frame via `jsQR`, plus an upload-image fallback for when the camera is unavailable/denied — both decode to the same `{ id, username?, keyFingerprint }` shape
- [x] **Fetch + verify**: on a successful scan, fetches the real `mlKemPublicKey` by `id` from the new endpoint, hashes it locally with the existing `fingerprint()` helper, and only reports "Verified" if it matches the scanned `keyFingerprint` — Verified / Mismatch / Not-found states shown to the user
- [ ] **Not yet wired**: a "Verified" result doesn't do anything yet (no add-contact action) — that's Phase 3

## Phase 3 — The handshake

## Phase 4 — Contact persistence
