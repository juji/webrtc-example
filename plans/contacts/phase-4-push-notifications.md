# Phase 4 — Push notification infrastructure

## Files

`server/.env` (VAPID keys added), `server/src/push.ts` (new), `server/src/routes/push.ts` (new), `server/src/db/schema.ts` (added `pushSubscriptions` table), `server/src/index.ts` (mounted the route), `client/public/sw.js` (extended with `push`/`notificationclick`), `client/lib/push.ts` (new), `client/lib/api.ts` (added `fetchVapidPublicKey`/`subscribeToPush`/`unsubscribeFromPush`/`sendTestPush`), `client/app/chat/page.tsx` (temporary Bell button), `server/package.json` (added `web-push` + `@types/web-push`).

## Why infrastructure-only, with a test trigger

Phase 5 (the actual contact-request notification) doesn't exist yet, so this phase has nothing real to fire a push *for*. Rather than leave the pipeline unverifiable until Phase 5 lands, `POST /push/test` exists purely so the full chain — VAPID handshake, subscribe, `web-push` send, service worker `push` event, OS notification — can be proven working end-to-end now, isolated from any contact-request logic. It only ever pushes to the caller's own subscriptions (never a general "notify anyone" endpoint), and the Bell button that triggers it in `/chat` is explicitly temporary scaffolding for this phase, not a feature.

## VAPID keys: one keypair, public half shared via endpoint not env duplication

```
bunx web-push generate-vapid-keys
```

Stored in `server/.env` as `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (private key is sensitive — server-only, never sent to the client). The public key does need to reach the browser (it's how `PushManager.subscribe()` proves to the push service which server is allowed to send to that subscription), but rather than also putting it in a `NEXT_PUBLIC_*` client env var — which would mean two copies of the same value that could silently drift if ever rotated — the client fetches it live from `GET /push/vapid-public-key`. One source of truth.

```ts
// server/src/push.ts
webPush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
export { VAPID_PUBLIC_KEY }
```

The `mailto:` contact is a required field of the VAPID spec (push services can use it to reach the sender about problems) — a placeholder address, not tied to anything real yet.

## Storage: a table, not a column, because a user can have multiple devices

```ts
// server/src/db/schema.ts
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  userId: uuid('user_id').notNull().references(() => users.id),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

A single subscription-on-`users` column was considered and rejected: it would mean registering push on a second device/browser silently replaces the first, with no way to notify both. `endpoint` (the push-service-assigned URL identifying a specific browser subscription) is unique — re-subscribing the same browser upserts rather than creating a duplicate row.

```ts
// server/src/routes/push.ts
pushRoute.post('/subscribe', async (c) => {
  // ...
  await db.insert(pushSubscriptions).values({ userId: user.id, endpoint, p256dh, auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, p256dh, auth } })
  return c.json({ ok: true })
})
```

`POST /push/unsubscribe` (delete by `endpoint`) exists alongside subscribe but isn't wired to any UI yet — no "disable notifications" button built in this phase, just the server-side capability.

## Sending: `web-push` package, failures caught per-subscription

```ts
// server/src/push.ts
export async function sendPush(subscription: PushSubscriptionKeys, payload: { title: string; body: string; url?: string }) {
  await webPush.sendNotification(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    JSON.stringify(payload),
  )
}
```

`web-push` (npm, portable — no Bun-specific API) is the standard library for this; hand-rolling the Web Push protocol (VAPID JWT signing, aes128gcm payload encryption per RFC 8291) would be substantial, error-prone work for something a well-audited library already does correctly.

`POST /push/test` sends to every subscription the requester owns and catches each failure individually (`.catch(err => console.error(...))` inside a `Promise.all`) rather than letting one dead/expired subscription fail the whole batch — the same reasoning `sendFailoverMessage`-style code elsewhere in this codebase already follows for "one recipient's problem shouldn't block others."

## Client: subscribe flow

```ts
// client/lib/push.ts
export async function enablePushForUser(username: string): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const publicKey = await fetchVapidPublicKey();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });
  }
  // ... posts subscription.toJSON()'s endpoint/keys to POST /push/subscribe
}
```

`urlBase64ToUint8Array` converts the VAPID public key from the URL-safe base64 format push services expect into the raw bytes `PushManager.subscribe()`'s `applicationServerKey` needs. `.buffer as ArrayBuffer` works around the same `Uint8Array<ArrayBufferLike>` vs. `BufferSource` TypeScript quirk already hit in `client/lib/keys.ts`'s `fingerprint()` (Phase 1) — `ArrayBufferLike` includes `SharedArrayBuffer`, which the Push/WebCrypto APIs don't accept, so re-asserting the type after wrapping in a fresh `Uint8Array` satisfies the compiler.

Checks for existing subscription (`getSubscription()`) before creating a new one — re-clicking the Bell button doesn't create duplicate push-service subscriptions, it reuses the existing one (and re-POSTs it, which the server's upsert handles idempotently).

**Deliberately does not auto-run on login.** Requesting notification permission unprompted on every login would be poor UX (the exact pattern browsers now actively discourage/block by default) — it only fires from an explicit user action (the Bell button this phase, a real "enable notifications" affordance in a later phase).

## Service worker: push + notificationclick

```js
// client/public/sw.js
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Primssg", body: "" };
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: "/icon-192.png", data: { url: data.url ?? "/" } }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url ?? "/"));
});
```

Additive to the minimal `sw.js` from Phase 3, not a rewrite — Phase 3's install/activate/fetch handlers are untouched. Uses the Phase 3 icon (`/icon-192.png`) as the notification's icon, so a push notification visually matches the app identity work from that phase. `notificationclick`'s `openWindow` currently always targets `/` when no `url` is set in the payload — Phase 5 will set a real `url` (e.g. straight to the notification screen) once there's a real event driving this.

## Explicitly not done in this phase

- No real trigger — `POST /push/test` only, no contact-request event exists yet (Phase 5).
- No "disable notifications" UI, despite `unsubscribeFromPush`/`POST /push/unsubscribe` existing server-side.
- No handling of expired/invalidated subscriptions (a push service returning 404/410 should ideally prune that row from `push_subscriptions` — not built; a dead subscription just fails silently on every future send).
- No iOS Safari-specific handling — iOS Web Push has additional requirements (must be installed to home screen first, iOS 16.4+) not addressed here.
- The Bell button is temporary phase-verification scaffolding, expected to be removed/replaced once Phase 5's real trigger exists.

## Verification

1. `curl http://localhost:4000/push/vapid-public-key` returns a real base64url public key.
2. `curl -X POST http://localhost:4000/push/subscribe` with a fake endpoint/keys for a real username returns `{"ok":true}`, and a second identical call upserts rather than erroring/duplicating (confirmed via `onConflictDoUpdate`).
3. `curl -X POST http://localhost:4000/push/test` for a user with a subscription returns `{"ok":true,"sent":N}` even when the underlying `web-push` send fails (fake endpoint) — confirms per-subscription failures are caught, not propagated as a route-level error.
4. In a real browser: click the Bell button on `/chat`, grant the permission prompt, confirm a real OS-level notification appears titled "Primssg" with body "Test push notification."
5. Click the notification — confirms `notificationclick` opens/focuses the app.
6. `bunx tsc --noEmit` clean in both `client/` and `server/`.
