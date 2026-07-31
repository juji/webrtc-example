## Context

Today there is no way for two users to start a conversation

Decided:
- **No searchable contact database.** Users cannot look each other up by username or any other query. The only way to become contacts is the live QR handshake below.
- **QR content is `{ id, keyFingerprint, username }` of the user showing the code, not the raw `mlKemPublicKey`.** The ML-KEM-768 public key is ~1184 bytes (~1580 base64 chars) — encoding it directly forces the QR to its largest, barely-scannable version. Instead the QR carries a short hash (`keyFingerprint`, e.g. truncated SHA-256) of the key. The scanning side fetches the actual public key from the server by `id`, then verifies it hashes to the fingerprint from the QR — same trust-on-first-use guarantee (server can't swap the key without the hash mismatching) with a small, cleanly-scannable payload. `id` + `keyFingerprint` are required; `username` is optional, display-only.
- **Superseded: the handshake is no longer "both parties live at the same moment."** Earlier in this plan's discussion, acceptance required AA to be actively connected when BB scanned, with a dropped connection voiding the attempt (retry required). That's replaced now that the app gets real Web Push: BB's request becomes a durable, persisted record (not an in-memory/TTL'd one) — AA gets notified via push whenever they next see it, seconds or days later, and accepts from the notification/notification screen whenever that is. This is the actual point of adding push; without it the liveness rule would still stand.
- **The app becomes a real installable PWA for this** — manifest, icons, service worker — because push notifications need a service worker regardless, and an installable app with its own icon/name is what makes a push notification feel like it's coming from a real app rather than a browser tab. App name **"Primssg"**, icon **"P"**.
- **The handshake result is intentionally inert.** Accepting only (a) notifies BB it was accepted and (b) adds the contact-bind row for both. It does not open a chat, does not send a first message, does not do anything else — it purely makes future conversation *possible*, matching this plan's Context: contacts are the prerequisite, not the conversation itself.

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
- [ ] **Not yet wired**: a "Verified" result doesn't do anything yet (no add-contact action) — that's Phase 6

## Phase 3 — App identity + installable PWA

detail: [phase-3-app-identity.md](phase-3-app-identity.md)
- [x] **Icon**: generated from a single SVG (`client/public/icon.svg` — dark square, white "P") via `rsvg-convert`, exported to `icon-192.png`, `icon-512.png`, and a padded `icon-maskable-512.png` for OS icon masks
- [x] **`manifest.json`** (`client/public/`): name/short_name "Primssg", `display: standalone`, theme/background colors, all three icon variants
- [x] **`app/layout.tsx` metadata**: title/description updated from the create-next-app defaults, `manifest` + `icons` wired into Next's `Metadata` export, `viewport.themeColor` added
- [x] **`favicon.ico`** regenerated from the same icon (was still the default Next.js favicon)
- [x] **Minimal service worker** (`client/public/sw.js`): install/activate/fetch-passthrough only — no caching strategy yet, just enough for Chrome/Android's installability check; push handling deferred to Phase 4
- [x] **`ServiceWorkerRegistration`** (`client/app/service-worker-registration.tsx`): root-mounted no-UI component registering the SW, matching the existing pattern of `SignalingConnection`/`MessageStatusListener`

## Phase 4 — Push notification infrastructure

detail: [phase-4-push-notifications.md](phase-4-push-notifications.md)
- [x] **VAPID keypair** generated via `bunx web-push generate-vapid-keys`, stored in `server/.env` (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`); public key exposed to the client via `GET /push/vapid-public-key` (not duplicated into a client env var — one source of truth)
- [x] **`push_subscriptions` table** (`server/src/db/schema.ts`): `userId`, `endpoint` (unique), `p256dh`, `auth` — one row per browser subscription, supports multiple devices per user; `POST /push/subscribe` upserts on `endpoint` conflict
- [x] **`server/src/push.ts`**: `sendPush()` wrapping the `web-push` package, `POST /push/unsubscribe`, `POST /push/test` (sends to the caller's own subscriptions only — exists purely to verify the pipeline before Phase 5 has a real event to trigger it)
- [x] **`sw.js` extended**: `push` handler calls `showNotification()`, `notificationclick` opens/focuses the app to the notification's `url`
- [x] **`client/lib/push.ts`**: `enablePushForUser()` — requests `Notification.requestPermission()`, subscribes via `PushManager` (VAPID key base64url-decoded to the `Uint8Array` the API needs), posts the subscription to the server
- [x] **Bell button on `/chat`** (temporary, for this phase's verification only): enables push + fires `POST /push/test` — not the real notification trigger, that's Phase 5
- [x] Verified server-side end-to-end (`vapid-public-key`, `subscribe` upsert, `test` send/catch) via curl; real browser permission-prompt → notification-appears flow verified manually

## Phase 5 — Contact request + notification screen

detail: [phase-5-contact-request.md](phase-5-contact-request.md)
- [ ] TBD

## Phase 6 — Accept flow + contact persistence

detail: [phase-6-accept-and-persist.md](phase-6-accept-and-persist.md)
- [ ] TBD
