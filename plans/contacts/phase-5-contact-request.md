# Phase 5 — Contact request + notification screen

## Files

`server/src/db/schema.ts` (added `contactRequests`), `server/src/routes/contacts.ts` (new), `server/src/push.ts` (extracted `notifyUserByPush()`), `server/src/routes/push.ts` (`/test` updated to use the extracted helper), `server/src/index.ts` (mounted the route), `client/lib/api.ts` (added `sendContactRequest`/`fetchContactRequests`/`ContactRequest` type), `client/components/qr-code-popup.tsx` (Send-request button on the Verified state), `client/components/requests-popup.tsx` (new — replaced an initial `/requests` route), `client/app/chat/page.tsx` (Bell button opens the popup, notification banner, `?open=requests` handling), `client/public/sw.js` (`notificationclick` reworked twice post-build), `client/app/service-worker-registration.tsx` (listens for the service worker's `postMessage`).

## Why this phase creates the request, not just the screen

Originally scoped as "notification screen only, using fake data" was considered and rejected before building: a notification screen with nothing real to notify about can't actually be verified end-to-end, and the button to trigger a request (on the QR-scan Verified state) needs *some* durable thing to create. So this phase does both — the trigger (Send-request button) and the destination (the `/requests` screen) — leaving only the accept *action* itself for Phase 6, matching Context's decision that acceptance is a separate, narrowly-scoped step ("notify BB, write the contacts row, nothing else").

## Schema: durable, not the earlier in-memory/TTL design

```ts
// server/src/db/schema.ts
export const contactRequests = pgTable('contact_requests', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  fromUserId: uuid('from_user_id').notNull().references(() => users.id),
  toUserId: uuid('to_user_id').notNull().references(() => users.id),
  status: text('status').notNull().default('pending'), // 'pending' | 'accepted'
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

This is the concrete implementation of Context's "Superseded" decision — the plan originally called for an ephemeral, in-memory, TTL'd handshake (matching Phase 2 encryption-at-rest's login-challenge `Map` pattern) that voided if either party wasn't simultaneously connected. Once Web Push (Phase 4) entered the picture, that shape stopped making sense: a request now needs to survive until AA next opens the app, which could be days later, so it has to be a real row, not memory that dies on server restart or after a TTL. `status` is plain `text` with app-level values (`'pending'`/`'accepted'`), matching every other table in this schema — no `pgEnum` used anywhere in this codebase, so introducing one here would be an inconsistent one-off.

## `POST /contacts/request`: idempotent on repeat scans, self-request rejected

```ts
// server/src/routes/contacts.ts
const [existing] = await db.select().from(contactRequests)
  .where(and(eq(contactRequests.fromUserId, fromUser.id), eq(contactRequests.toUserId, toUser.id)))

const request = existing ?? (await db.insert(contactRequests).values({ fromUserId: fromUser.id, toUserId: toUser.id }).returning())[0]

await notifyUserByPush(toUser.id, {
  title: 'Primssg',
  body: `${fromUser.username} wants to add you as a contact`,
  url: '/chat?open=requests',
})
```

Reuses an existing pending request rather than inserting a duplicate row if BB scans/sends again (e.g. re-opening the scan popup after closing it) — but still re-sends the push either way, since a nudge on a second attempt is reasonable and costs nothing extra. `fromUser.id === toUser.id` is explicitly rejected (400) — scanning your own QR code (e.g. testing, or two tabs of the same account) shouldn't create a self-referential request.

Verified via curl: sending the same request twice returned the identical `request.id` both times (confirmed against real UUIDs, not just "didn't error") — proves the dedup actually works, not just that duplicates are silently allowed to pile up unnoticed.

## Push payload reuses Phase 4's infrastructure via an extracted helper

`server/src/push.ts` gained `notifyUserByPush(userId, payload)` — pulled out of what was inline in `routes/push.ts`'s `/test` handler (fetch all of a user's subscriptions, send to each, catch failures individually). Both `/push/test` and `/contacts/request` now call the same function; `/test`'s own handler shrank to just the subscription-existence check plus the call. This is the first real consumer of Phase 4's infra beyond its own self-test — proof the abstraction (send-to-a-user-by-id, not send-to-a-specific-subscription) was the right shape to have built.

The push payload's `url: '/chat?open=requests'` carries intent, not just a destination — `/chat` alone can't tell "opened normally" from "opened because of a contact-request notification," so the query param is what the client checks to auto-open the requests popup (see the `OpenRequestsFromQuery` section below). This is a deliberate change from an earlier version that just used `/requests` as a plain route target, made obsolete once `/requests` was converted from a route into a popup (see below).

## Client: Send-request button lives on the already-verified state, not a new screen

```tsx
// client/components/qr-code-popup.tsx — inside the existing "verified" branch
{requestState === "sent" ? (
  <p>Contact request sent.</p>
) : (
  <button onClick={handleSendRequest} disabled={requestState === "sending"}>
    {requestState === "sending" ? "Sending…" : "Send contact request"}
  </button>
)}
```

Deliberately not a separate popup/step — the button only appears once `verifyResult.status === "verified"`, so it's structurally impossible to send a request for a scan that failed fingerprint verification. `requestState` (`idle`/`sending`/`sent`/`error`) is reset alongside the popup's other scan state whenever it closes, same as `scanned`/`verifyResult`/`uploadError` already were (Phase 2) — reopening the popup always starts fresh, no stale "sent" banner from a previous scan.

## `RequestsPopup`: built as a route first, converted to a popup

```tsx
// client/components/requests-popup.tsx
export function RequestsPopup({ open, onClose, user }: { open: boolean; onClose: () => void; user: User }) {
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  useEffect(() => {
    if (!open) return;
    fetchContactRequests(user.username).then(setRequests);
  }, [open, user]);
  return (
    <Popup open={open} onClose={onClose} title="Contact requests" buttons={[]}>
      {/* ...list, Accept button disabled... */}
    </Popup>
  );
}
```

Originally built as a real route (`client/app/requests/page.tsx`, `useRequireSession()`-gated, matching `/users`' shape) and reached via a `<Link href="/requests">` in `/chat`'s header. Changed to a popup after explicit feedback ("i think it should be a popup instead") to match the existing pattern every other secondary UI in this app already uses (Logout confirmation, QR Code) — a full page navigation was inconsistent with that. The route directory was deleted; `/chat`'s Bell icon now opens `showRequests` state instead of navigating.

Fetches on `open`, not on mount — since the component is now always mounted (just conditionally rendered by `Popup`'s own `open` prop), fetching only when actually opened avoids a request firing every time `/chat` loads regardless of whether the user ever looks at requests.

The Accept button is present and styled but `disabled` with no `onClick` — a comment points at Phase 6 rather than leaving it unexplained. This mirrors how Phase 2 left the QR-scan "Verified" result inert until this phase gave it a real action; the same pattern continues one phase further; each phase builds up to the point where its own trigger exists and stops there, rather than reaching ahead into the next phase's scope.

No polling/live-refresh — the list is fetched once per popup-open. A user with the popup open when a new request arrives won't see it appear without closing and reopening it; acceptable for now since the primary path to seeing a new request is the push notification itself.

## Notification click: two follow-up bugs, both found via manual testing after the initial build

**Bug 1 — always opened a new tab.** The original `notificationclick` handler (Phase 4) unconditionally called `self.clients.openWindow(url)`. Fixed by checking `self.clients.matchAll()` for an existing window matching the app's origin first, focusing/reusing it instead of opening a duplicate tab, falling back to `openWindow` only when nothing's open.

**Bug 2 — reused the tab but forced a full page reload.** The fix for Bug 1 used `existing.navigate(url)` to redirect the found tab. `WindowClient.navigate()` is a service-worker-level browser API with no awareness of Next.js's client-side router — it always performs a real document navigation (full reload), which defeats the point of "reuse the existing tab" from a UX standpoint (the whole app remounts). Fixed by having the service worker `postMessage` the client instead of navigating it directly:

```js
// client/public/sw.js
if (existing) {
  existing.postMessage({ type: "notification-click", url });
  return existing.focus();
}
return self.clients.openWindow(url);
```

```tsx
// client/app/service-worker-registration.tsx
useEffect(() => {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js");
  function handleMessage(event: MessageEvent) {
    if (event.data?.type === "notification-click" && event.data.url) router.push(event.data.url);
  }
  navigator.serviceWorker.addEventListener("message", handleMessage);
  return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
}, [router]);
```

The already-running tab's own `ServiceWorkerRegistration` component listens for the message and calls Next's `router.push()` — a real client-side transition. This is the correct general pattern for "make a push notification click feel like in-app navigation, not a reload" in any Next.js PWA, not specific to this feature.

## `?open=requests`: carrying intent through the URL, and the Suspense requirement it triggered

A bare `/chat` URL can't distinguish "opened normally" from "opened because of a contact-request notification" — so the push payload's `url` became `/chat?open=requests`, and `/chat` needed to read that param and react to it.

```tsx
// client/app/chat/page.tsx
function OpenRequestsFromQuery({ onOpenRequests }: { onOpenRequests: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("open") === "requests") {
      onOpenRequests();
      router.replace("/chat");
    }
  }, [searchParams, router, onOpenRequests]);
  return null;
}
```

`useSearchParams()` opts a page out of Next's static prerendering unless it's isolated behind its own `<Suspense>` boundary — this was not obvious from `tsc --noEmit` (which stayed clean) and only surfaced as a real `next build` failure ("useSearchParams() should be wrapped in a suspense boundary at page \"/chat\""), confirming the fix was actually necessary rather than precautionary. `OpenRequestsFromQuery` was extracted as its own component specifically so only *it* (not all of `/chat`) needs the Suspense wrapper:

```tsx
<Suspense fallback={null}>
  <OpenRequestsFromQuery onOpenRequests={() => setShowRequests(true)} />
</Suspense>
```

`router.replace("/chat")` strips the query param immediately after opening the popup, so refreshing the page doesn't re-trigger the auto-open on every load.

## Explicitly not done in this phase

- **No accept action** — the whole point of Phase 6 existing separately. Clicking Accept currently does nothing (button is disabled).
- **No decline/reject action** — a request can only ever be pending or (eventually, Phase 6) accepted; no way to dismiss an unwanted request yet.
- **No live-updating request list** — fetched once per popup-open, no WebSocket push of new requests into an already-open popup.
- **No de-duplication of the notification itself** — sending the same request twice (see above) sends two separate push notifications, even though it's the same underlying row.
- **The `postMessage` navigation fix only helps when a tab is already open.** If the app isn't open anywhere, `openWindow(url)` still does a normal fresh navigation (unavoidable — there's no existing page to message) and the `?open=requests` handling on load takes it from there.

## Verification

1. Register two users, `POST /contacts/request` from one to the other's `id` — confirm a real row is created and returned.
2. Repeat the identical request — confirm the same `request.id` is returned (not a new row), via `GET /contacts/requests?username=<recipient>` still showing exactly one entry.
3. Attempt a self-request (`fromUsername`'s own `id` as `toId`) — confirm 400 `"cannot request yourself"`.
4. `GET /contacts/requests?username=<recipient>` returns the pending request with the correct `fromUsername`.
5. In the browser: scan a real QR code (Phase 1/2) to a Verified state, click "Send contact request," confirm the button shows "Sending…" then "Contact request sent." and a real push notification arrives (if push was enabled) with the requester's username in the body.
6. With the app already open in a tab, click the push notification — confirms the existing tab is focused and client-side-routes to the requests popup, without a full page reload (check Network tab / absence of a document reload).
7. With the app *not* open anywhere, click the push notification — confirms a new tab opens directly to `/chat` with the requests popup already showing.
8. Refresh `/chat` after the popup auto-opened — confirms the `?open=requests` param was stripped and the popup doesn't reopen on its own.
9. `bunx tsc --noEmit` clean in both `client/` and `server/` (run from within each directory, not the repo root); `bun run build` (from `client/`) completes without the Suspense-boundary error.
