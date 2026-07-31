## Context

Today there is no way for two users to start a conversation

Decided:
- **No searchable contact database.** Users cannot look each other up by username or any other query. The only way to become contacts is the live QR handshake below.
- **QR content is `{ id, keyFingerprint, username }` of the user showing the code, not the raw `mlKemPublicKey`.** The ML-KEM-768 public key is ~1184 bytes (~1580 base64 chars) — encoding it directly forces the QR to its largest, barely-scannable version. Instead the QR carries a short hash (`keyFingerprint`, e.g. truncated SHA-256) of the key. The scanning side fetches the actual public key from the server by `id`, then verifies it hashes to the fingerprint from the QR — same trust-on-first-use guarantee (server can't swap the key without the hash mismatching) with a small, cleanly-scannable payload. `id` + `keyFingerprint` are required; `username` is optional, display-only.
- **Superseded: the handshake is no longer "both parties live at the same moment."** Earlier in this plan's discussion, acceptance required AA to be actively connected when BB scanned, with a dropped connection voiding the attempt (retry required). That's replaced now that the app gets real Web Push: BB's request becomes a durable, persisted record (not an in-memory/TTL'd one) — AA gets notified via push whenever they next see it, seconds or days later, and accepts from the notification/notification screen whenever that is. This is the actual point of adding push; without it the liveness rule would still stand.
- **The app becomes a real installable PWA for this** — manifest, icons, service worker — because push notifications need a service worker regardless, and an installable app with its own icon/name is what makes a push notification feel like it's coming from a real app rather than a browser tab. App name **"Primssg"**, icon **"P"**.
- **The handshake result is intentionally inert.** Accepting only (a) notifies BB it was accepted and (b) writes a local contact entry for AA (the accepter). It does not open a chat, does not send a first message, does not do anything else — it purely makes future conversation *possible*, matching this plan's Context: contacts are the prerequisite, not the conversation itself.
- **Contacts live only in IndexedDB, never on the server.** Once a request is accepted, the server marks both paired `notifications` rows `'accepted'` (so a repeat request/scan doesn't spam a new pending row, and so each side can see the transition durably) and forgets — it never stores "these two users are contacts" as its own durable fact. This extends "no searchable contact database" one step further: the server can't even answer "who are X's contacts" for anyone, including X. Accepted deliberately, with real consequences: no multi-device contact sync, and clearing IndexedDB (or losing the device) loses the contact list with no server-side recovery — same accepted tradeoff as the ML-KEM/ML-DSA private keys already living client-side only ([[encryption-at-rest]]).
- **Superseded: `contact_requests` (one row per handshake, visible only to the recipient) replaced by a generic `notifications` table (one row per recipient per event, `type`+`data` jsonb).** Found necessary after real testing showed BB (the sender) had no persistent view of their own request's lifecycle — only a live push could ever tell BB "accepted," and a dismissed notification or closed tab lost that information permanently, with no way to recover it later. Each contact-request handshake now creates two paired `notifications` rows (`pairId` linking them, one per party), both updated together on accept — push stays as a fast live-update path, but the durable source of truth either side can always re-check is the row itself. See phase-6-accept-and-persist.md's "Redesign" section.

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
- [x] **`contact_requests` table** (`server/src/db/schema.ts`): `fromUserId`, `toUserId`, `status` (`'pending'`/`'accepted'` text, matches the schema's no-pg-enum style elsewhere), durable — this is what replaced the earlier "both parties live" in-memory design
- [x] **`POST /contacts/request`** (`server/src/routes/contacts.ts`): creates the row (reuses an existing pending request rather than duplicating on a repeat scan) and pushes AA via the shared `notifyUserByPush()` helper (extracted from Phase 4's `/push/test` logic), payload's `url` set to `/chat?open=requests` — the query param is what tells `/chat` to auto-open the requests popup on arrival
- [x] **`GET /contacts/requests?username=`**: lists a user's pending incoming requests (`fromUsername`, `createdAt`) — join on `users` for the display name
- [x] **"Send contact request" button** added to the QR-scan popup's Verified state (`client/components/qr-code-popup.tsx`) — idle/sending/sent/error states, only shown once a scan is cryptographically verified
- [x] **`RequestsPopup`** (`client/components/requests-popup.tsx`): lists pending incoming requests, opened via a Bell icon in `/chat`'s header — built first as a `/requests` route, then converted to a popup to match the existing Logout/QR-code popup pattern; Accept button present but disabled/no-op — wiring the actual accept action is Phase 6
- [x] **Notification banner on `/chat`**: shown only when `Notification.permission === "default"`, an explicit "Enable" button (green) is the real user-gesture that triggers the permission prompt — automatic/silent prompting isn't possible (browsers require a genuine click) and wasn't attempted
- [x] **`notificationclick` fixed twice, post-build**: first pass (`self.clients.openWindow()`) always opened a *new* tab even when the app was already open; second pass (`existing.navigate(url)`) fixed that but caused a full page reload, bypassing Next's client-side router; final version has the service worker `postMessage` the existing tab instead, and `ServiceWorkerRegistration` (`client/app/service-worker-registration.tsx`) listens for that message and calls `router.push()` — a real client-side transition, no reload
- [x] **`?open=requests` query param**: `/chat` reads it via a `useSearchParams()`-based `OpenRequestsFromQuery` sub-component (isolated behind its own `<Suspense>` boundary — required for `next build` to statically prerender `/chat`, confirmed by a real build failure before this was added) and auto-opens `RequestsPopup`, then strips the param via `router.replace("/chat")` so a refresh doesn't re-trigger it
- [x] Verified server-side via curl: request creation, duplicate-request reuse (same `id` returned, not a new row), self-request rejection (400), and the request correctly appearing in the recipient's `GET /contacts/requests`

## Phase 6 — Accept flow + contact persistence

detail: [phase-6-accept-and-persist.md](phase-6-accept-and-persist.md)
- [x] **Preamble — notification count badge**: `/chat` fetches `fetchContactRequests(user.username)` on mount and whenever `RequestsPopup` closes (so the count refreshes after any future accept/decline action), showing a red circular badge with a white number (`9+` past 9) on the Bell icon's corner when `requestCount > 0`
- [x] **`webrtc-contacts` IndexedDB store** (`client/lib/contacts.ts`, new): compound keyPath `[ownerUsername, id]` scoped per locally-registered identity (matches `keys.ts`'s username-keyed pattern), index on `ownerUsername` for listing; `addContact`/`listContacts`/`getContact`
- [x] **`POST /contacts/requests/:id/accept`** (`server/src/routes/contacts.ts`): scoped to the actual recipient (wrong user or an already-`accepted` request both rejected — 404/409), flips `status` to `'accepted'`, notifies the original requester via push, returns the requester's `id`/`username`/`mlKemPublicKey` for the client to persist locally — server never writes a durable contacts row of its own
- [x] **`acceptContactRequest()`** (`client/lib/api.ts`)
- [x] **`RequestsPopup`'s Accept button wired**: calls the endpoint, writes the returned contact into IndexedDB via `addContact`, removes the row from the visible pending list on success
- [x] **Bug found and fixed: only the accepter's side got a local contact.** The original design only had AA (the accepter) write to IndexedDB — BB (the original requester) never did, so the bind was one-sided instead of mutual. Fixed by carrying the fingerprint BB scanned all the way through: `contact_requests` gained `fromScannedFingerprint` (set at request-send time from `sendContactRequest`'s new required `keyFingerprint` param), echoed back — never trusted directly — in the accept push's `data.keyFingerprint`. BB's client (`service-worker-registration.tsx`) re-fetches AA's real key via `GET /users/:id` and re-verifies the fingerprint match before writing its own contact entry, same verification Phase 2 already does — the push payload is never trusted as a source of key material on its own.
- [x] **`push.ts`'s `PushPayload` gained an optional `data` field** for structured, event-specific payloads beyond the visible notification chrome; `sw.js`'s `push` handler now also broadcasts `data` to any already-open tab via `postMessage` immediately (not gated on a notification click), so an open app reacts right away
- [x] **Bug found and fixed: BB had no persistent notification, only a transient push.** Clicking the accept push "did nothing visible," and dismissing it lost the acceptance event permanently — nothing on BB's side was ever queryable again after the initial request. Root cause: `contact_requests` had no row BB could see at all. Fixed by replacing it with a generic `notifications` table (`userId`, `type`, `data` jsonb, `status`) — one row per recipient, so a single handshake creates two paired rows (`pairId`-linked). `GET /contacts/requests` now returns both directions, any status; accept flips both paired rows to `accepted`, not just the recipient's.
- [x] **`RequestsPopup` renamed "Notifications," split into Received/Sent sections** — Received keeps the existing Accept-button UX; Sent shows status text (Pending/Accepted) for requests BB sent. Opening the popup re-syncs any `Sent` row already `accepted` via the new `syncAcceptedContact()` (`client/lib/contacts.ts`, extracted from `service-worker-registration.tsx`'s push handler so both call sites share one verify-then-persist implementation) — this is what makes the fix durable: push is now an optimization, not the only delivery path
- [x] **Bell badge narrowed** to `direction === "incoming" && status === "pending"` only, since the feed now includes sent/accepted rows that shouldn't inflate an "needs your action" count
- [x] **Bug found and fixed: BB's accept-notification click didn't open the popup.** The accept push's `url` was still `/chat` (pre-redesign, before BB had a real notification to deep-link to) instead of `/chat?open=requests`. One-line fix in `server/src/routes/contacts.ts`'s accept handler.
- [x] Verified server-side via curl: accept succeeds and returns the right contact, both paired notification rows flip to `accepted`, repeat accept rejected (409), non-recipient accept attempt rejected (404), `scannedFingerprint` round-trips correctly through both rows; manually verified BB's contact syncs via the Notifications popup even when simulating a missed push

## Phase 7 — Decline flow

detail: [phase-7-decline-flow.md](phase-7-decline-flow.md)
- [ ] TBD
