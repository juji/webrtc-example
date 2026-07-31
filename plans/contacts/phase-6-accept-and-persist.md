# Phase 6 — Accept flow + contact persistence

## Files

`client/lib/contacts.ts` (new; later gained `syncAcceptedContact`), `server/src/routes/contacts.ts` (added `POST /requests/:id/accept`, `POST /request` now requires `keyFingerprint`; later rewritten around `notifications`; accept push's `url` fixed to deep-link), `server/src/db/schema.ts` (`contact_requests` gained `fromScannedFingerprint`; later replaced by `notifications`), `server/src/push.ts` (`PushPayload` gained optional `data`), `client/lib/api.ts` (added `acceptContactRequest`/`AcceptedContact`, `sendContactRequest` now takes `keyFingerprint`; later `ContactRequest` replaced by `ContactRequestNotification`), `client/components/qr-code-popup.tsx` (passes `scanned.keyFingerprint` through to `sendContactRequest`), `client/components/requests-popup.tsx` (Accept button wired; later rewritten as a flat notification list, briefly tried as Received/Sent tabs and reverted), `client/public/sw.js` (`push` handler broadcasts structured `data` to open tabs), `client/app/service-worker-registration.tsx` (re-verifies and persists on a `contact-accepted` push; later delegates to `syncAcceptedContact`), `client/app/chat/page.tsx` (notification count badge — preamble, not the accept flow itself; later badge counts only pending-incoming; `?open=requests` renamed `?open=notifications`).

## The core design decision: contacts live only in IndexedDB, never on the server

Before writing any code, this needed settling: does the server also keep a durable `contacts` table (source of truth, survives a lost device, sets up future multi-device support), or does IndexedDB hold the *only* copy? Explicitly chosen: **IndexedDB only.** The server facilitates the handshake — receives the request, notifies AA, marks acceptance — and then forgets the relationship entirely. It can never answer "who are X's contacts," not even for X.

This is "no searchable contact database" (checklist.md's Phase-1-era decision) taken one step further, applied consistently: if the server can't be trusted/allowed to reveal who's connected to whom via search, it shouldn't durably know that either, once the handshake completes. Real, accepted tradeoffs that follow directly from this:
- **No multi-device contact sync.** A contact accepted on one browser doesn't exist on a second device logged into the same username — same limitation this app already has for private keys ([[encryption-at-rest]]'s Context: "no multi-device linking").
- **Losing IndexedDB loses the contact list, with no recovery path.** Same risk class as losing the ML-KEM/ML-DSA keypairs already stored there — this phase doesn't introduce a new failure mode, it adds a second thing that can be lost the same way.

`contact_requests.status` still flips to `'accepted'` server-side (not deleted) — that's not a contradiction of "server forgets": the row change exists purely to make `POST /contacts/request` idempotent going forward (a re-scan/re-request against an already-accepted pair shouldn't spam a new pending row or a duplicate push), not to record the relationship as a queryable fact. The server never joins that row against anything to answer "are X and Y contacts."

## `webrtc-contacts`: a second IndexedDB, scoped per local identity

```ts
// client/lib/contacts.ts
export type Contact = {
  ownerUsername: string; // which locally-registered identity this contact belongs to
  id: string;
  username: string;
  mlKemPublicKey: string; // base64, pinned at accept time — never re-fetched
  acceptedAt: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('webrtc-contacts', 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('contacts', { keyPath: ['ownerUsername', 'id'] });
      store.createIndex('ownerUsername', 'ownerUsername');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

A separate database from `webrtc-keys` (`client/lib/keys.ts`), not a second object store bolted onto it — different concern (a per-user *list*, not a single keyed record), same reasoning as this codebase's Separation-of-Concerns convention elsewhere.

**Compound keyPath `[ownerUsername, id]`, not a flat list**, because a single browser can hold multiple registered identities (`generateAndStoreKeys` in `keys.ts` is already keyed by username, and nothing stops registering several accounts in one browser). Scoping contacts per owner means switching between locally-registered accounts doesn't leak one identity's contacts into another's list. An index on `ownerUsername` supports `listContacts(ownerUsername)` without a full table scan.

`mlKemPublicKey` is stored **exactly as fingerprint-verified at scan/accept time, never re-fetched afterward** — re-fetching later would silently reopen the trust-on-first-use gap Phase 1/2's whole fingerprint design existed to close (a compromised server could swap the key on a later fetch; it can't swap what's already pinned locally).

## Server: accept is scoped, idempotent, and returns just enough to persist locally

```ts
// server/src/routes/contacts.ts
contactsRoute.post('/requests/:id/accept', async (c) => {
  const id = c.req.param('id')
  const { username } = await c.req.json<{ username?: string }>()
  // ...
  const [request] = await db.select().from(contactRequests)
    .where(and(eq(contactRequests.id, id), eq(contactRequests.toUserId, user.id)))
  if (!request) return c.json({ error: 'request not found' }, 404)
  if (request.status !== 'pending') return c.json({ error: 'request is not pending' }, 409)
  // ...
  await db.update(contactRequests).set({ status: 'accepted' }).where(eq(contactRequests.id, id))
  await notifyUserByPush(fromUser.id, { title: 'Primssg', body: `${user.username} accepted your contact request`, url: '/chat' })
  return c.json({ contact: { id: fromUser.id, username: fromUser.username, mlKemPublicKey: fromUser.mlKemPublicKey } })
})
```

The `WHERE ... AND toUserId = user.id` clause is what makes this scoped, not just an id lookup — the original *requester* (BB) can never accept their own outgoing request by hitting this endpoint with their own username, because the query only matches rows where the caller is the recipient. Verified directly: BB attempting to accept the request they themselves sent gets 404 "request not found," not a permissions error that would leak whether the id exists at all.

`if (request.status !== 'pending')` rejects a second accept attempt with 409, not a silent success — verified by accepting the same request twice and confirming the second call fails rather than re-notifying/re-returning as if nothing had changed.

Response shape (`{ id, username, mlKemPublicKey }`) is deliberately just what the client needs to construct a `Contact` row — no `createdAt`, no `mlDsaPublicKey`, nothing beyond what Phase 6's actual job (persist a usable contact) requires.

## Client: accept, then write, then remove from the visible list

```tsx
// client/components/requests-popup.tsx
async function handleAccept(request: ContactRequest) {
  setAcceptingId(request.id);
  try {
    const contact = await acceptContactRequest(request.id, user.username);
    await addContact({
      ownerUsername: user.username,
      id: contact.id,
      username: contact.username,
      mlKemPublicKey: contact.mlKemPublicKey,
      acceptedAt: new Date().toISOString(),
    });
    setRequests((prev) => prev.filter((r) => r.id !== request.id));
  } catch (err) {
    console.error("failed to accept contact request:", err);
  } finally {
    setAcceptingId(null);
  }
}
```

Sequenced deliberately: server accept succeeds first, *then* the local IndexedDB write happens, *then* the request disappears from the popup's list. If the server call fails, nothing local changes and the request stays visible to retry — there's no state where the UI shows a request as gone but the server still considers it pending (or vice versa where a local contact was written without the server ever confirming acceptance).

`acceptingId` (rather than a single boolean) tracks which specific request is mid-accept, so accepting one request in a list of several doesn't disable/spin every row's button — only the one actually being processed.

The requests-count badge on `/chat` (this phase's preamble item) isn't explicitly refreshed by `handleAccept` — it relies on the existing effect that refetches whenever `RequestsPopup`'s `open` prop goes back to `false` (closing the popup), so the badge count catches up the next time the popup is closed, not instantly as each request is accepted.

## Bug found after initial build: the bind was one-sided, not mutual

The first version of this phase only had AA (the accepter) write a local `Contact` row. BB — the person who originally sent the request and receives the "accepted" push — never wrote anything. Caught by directly asking "does BB's IndexedDB get updated?" and confirming it didn't: after acceptance, only AA had BB as a contact; BB had nothing. That's not a mutual bind, which the whole plan assumes ("the handshake result... adds the contact-bind row for both," checklist.md's Context).

The fix has a real trust subtlety, not just "also write on BB's side." The obvious naive fix — have the accept-notification push carry AA's `mlKemPublicKey` directly, and have BB's client trust and store it — would have quietly reopened the exact gap Phase 1/2's fingerprint design exists to close: a compromised server could hand BB a substituted key at accept-time with nothing catching it, since accepting a push payload's key at face value is precisely what fingerprint verification was built to avoid.

**Resolution: carry the fingerprint through, not the key.** BB already fingerprint-verified AA's real key once, at scan/send time (Phase 2's flow, reused in Phase 5's Send-request button) — that verification shouldn't need to happen with weaker guarantees a second time.

1. `sendContactRequest` (`client/lib/api.ts`) now requires `keyFingerprint` — the same value `qr-code-popup.tsx` already had in `scanned.keyFingerprint` from the original scan, just not previously sent to the server:
   ```ts
   export async function sendContactRequest(fromUsername: string, toId: string, keyFingerprint: string): Promise<void> { ... }
   ```
2. `contact_requests` gained a `fromScannedFingerprint` column — the server stores this opaquely; it's never checked or interpreted server-side, only carried forward:
   ```ts
   fromScannedFingerprint: text('from_scanned_fingerprint').notNull(),
   ```
3. On accept, the server echoes it back to BB inside the push's new structured `data` field — critically, **without** the key itself:
   ```ts
   await notifyUserByPush(fromUser.id, {
     title: 'Primssg', body: `${user.username} accepted your contact request`, url: '/chat',
     data: { type: 'contact-accepted', contact: { id: user.id, username: user.username }, keyFingerprint: request.fromScannedFingerprint },
   })
   ```
4. BB's client (`client/app/service-worker-registration.tsx`) receives this — via `sw.js`'s `push` handler broadcasting `data` to any open tab immediately (`postMessage`), or via `notificationclick` if the app wasn't open — and re-runs the *exact same* verification Phase 2 already does: fetch the real key fresh via `GET /users/:id`, hash it, compare to the echoed fingerprint, only then persist:
   ```ts
   async function handleContactAccepted(data: ContactAcceptedData) {
     const found = await fetchUserById(data.contact.id);
     if (!found) return;
     const actualFingerprint = await fingerprint(fromBase64(found.mlKemPublicKey));
     if (actualFingerprint !== data.keyFingerprint) {
       console.error("contact-accepted push failed key verification, not persisting:", found.username);
       return;
     }
     await addContact({ ownerUsername: user.username, id: found.id, username: found.username, mlKemPublicKey: found.mlKemPublicKey, acceptedAt: new Date().toISOString() });
   }
   ```

The server's role in this exchange stays exactly what Context already committed to: it moves opaque data (a fingerprint string) between two clients and never itself makes a trust decision. The only thing that ever compares a fetched key against a fingerprint is client code that already existed for this purpose (Phase 2), reused rather than duplicated with weaker guarantees.

`push.ts`'s `PushPayload` type gained an optional `data: Record<string, unknown>` field for this — structured, event-specific data distinct from the notification's visible `title`/`body`/`url`. `sw.js`'s `push` handler now does two things instead of one: shows the OS notification (as before) *and* broadcasts `data` via `postMessage` to every open client immediately, not gated behind the user actually clicking the notification — so an already-open tab reacts to a contact-accepted event right away rather than only on click. `notificationclick`'s existing message also carries `data` now, covering the case where the app wasn't open when the push arrived.

## Redesign: `contact_requests` → generic `notifications`, and closing the "push-only delivery" gap

Two more real gaps surfaced after the mutual-bind fix above, both reported directly by testing the actual UX rather than found by inspection:

1. **Clicking the accept notification "did nothing" visible.** The push correctly triggered `handleContactAccepted` in the background, but there was no notification *entry* anywhere for BB to look at — the whole "accepted" event was invisible except for the OS-level push toast itself, which vanishes once dismissed or clicked.
2. **Dismissing the notification lost it permanently.** Because `contact-accepted` data only ever traveled through a live `postMessage` (from `sw.js`'s `push` handler or `notificationclick`), a tab that wasn't open when the push fired never received the data at all, with no way to recover it later — not on next login, not ever. The server-side `contact_requests` row did flip to `'accepted'`, but nothing on BB's side ever read that row again after the initial `POST /contacts/request` call.

Root cause of both: **BB never had a persistent, queryable notification of their own.** `contact_requests` was modeled as one row per handshake, visible only to AA (`GET /contacts/requests` filtered on `toUserId`) — BB had no symmetrical view, so BB's side of the flow depended entirely on a live push arriving and being handled at that exact moment. There was no durable fallback.

**Fix: replace the single-purpose `contact_requests` table with a generic `notifications` table, and give BB their own row.**

```ts
// server/src/db/schema.ts
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  userId: uuid('user_id').notNull().references(() => users.id), // recipient of this notification
  type: text('type').notNull(), // 'contact_request'
  data: jsonb('data').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'accepted'
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

`type` + `data` (jsonb) makes this reusable for any future notification kind, not just contact requests — chosen directly over "keep `contact_requests`, bolt a thin `notifications` read-log on top" because a second table just to track read/shown state would have meant two sources of truth for the same event instead of one row per side.

One handshake now produces **two rows, paired by `pairId`** — one for each party, each independently queryable and independently updated:

```ts
// server/src/routes/contacts.ts — POST /contacts/request
const [outgoingRow] = await db.insert(notifications).values({
  userId: fromUser.id, // BB
  type: 'contact_request',
  data: { direction: 'outgoing', otherUserId: toUser.id, otherUsername: toUser.username, scannedFingerprint: keyFingerprint },
}).returning()

const [incomingRow] = await db.insert(notifications).values({
  userId: toUser.id, // AA
  type: 'contact_request',
  data: { direction: 'incoming', otherUserId: fromUser.id, otherUsername: fromUser.username, pairId: outgoingRow.id, scannedFingerprint: keyFingerprint },
}).returning()

await db.update(notifications).set({ data: { ...outgoingRow.data, pairId: incomingRow.id } }).where(eq(notifications.id, outgoingRow.id))
```

`scannedFingerprint` is stored on **both** rows now, not just the incoming one — BB already has it at send time (it's what `qr-code-popup.tsx` scanned), so there's no reason BB's own row shouldn't carry it too; it's what lets `RequestsPopup` re-verify and sync a contact directly from BB's own notification list, independent of whether a push ever arrived.

`GET /contacts/requests?username=` now returns **every** `contact_request` notification for that user, both directions, any status — not just pending-incoming:

```ts
const rows = await db.select().from(notifications)
  .where(and(eq(notifications.userId, user.id), eq(notifications.type, 'contact_request')))
  .orderBy(desc(notifications.createdAt))
```

Accepting flips **both** paired rows to `'accepted'` in one call, not just the recipient's:

```ts
// POST /contacts/requests/:id/accept
await db.update(notifications).set({ status: 'accepted' }).where(eq(notifications.id, incoming.id))
await db.update(notifications).set({ status: 'accepted' }).where(eq(notifications.id, data.pairId))
```

This is the actual fix for gap 2: BB's own row now durably reflects `'accepted'` on the server regardless of whether any push was ever delivered. Push becomes an optimization (fast, live update) rather than the only path to the truth.

### Client: `RequestsPopup` becomes a flat notification list, and is now a sync path in its own right

A tabbed Received/Sent layout was tried first and rejected on direct feedback: the popup's title is "Notifications," and splitting it into two tabs re-created "contact requests" (with a direction filter) under a name that promised something more general. The actual fix: **one flat list**, where each row is self-describing — a title (the other person), a description sentence that already encodes direction and status, and a trailing status/action:

```tsx
// client/components/requests-popup.tsx
function description(n: ContactRequestNotification): string {
  if (n.data.direction === "incoming") {
    return n.status === "accepted"
      ? `You added ${n.data.otherUsername} as a contact.`
      : `${n.data.otherUsername} wants to add you as a contact.`;
  }
  return n.status === "accepted"
    ? `${n.data.otherUsername} accepted your contact request.`
    : `Contact request sent to ${n.data.otherUsername}.`;
}
```

Each row shows an Accept button only when `direction === "incoming" && status === "pending"` (the one actionable case); every other row just shows its status text (Pending/Accepted). This shape also scales to future notification `type`s without needing a new tab per type — a flat list keyed by a per-row `description()` function stays correct as more types are added, where a tab-per-category layout wouldn't.

The sync-on-open effect is unchanged by the tab removal — it's not a tab-scoped concern, it runs over the whole fetched list regardless of how it's rendered:

```tsx
useEffect(() => {
  if (!open) return;
  fetchContactRequests(user.username).then((rows) => {
    setNotifications(rows);
    for (const n of rows) {
      if (n.data.direction === "outgoing" && n.status === "accepted") {
        syncAcceptedContact(user.username, { id: n.data.otherUserId, username: n.data.otherUsername }, n.data.scannedFingerprint);
      }
    }
  });
}, [open, user]);
```

Every time BB opens the popup, any outgoing (`Sent`) row already marked `accepted` gets re-synced. This directly closes gap 1 and 2 together: opening the popup *is* the visible confirmation ("Contact request sent to testaa" flips to "testaa accepted your contact request" once fetched), and it's also the durable delivery path that doesn't depend on push having fired while a tab was open.

`syncAcceptedContact` was extracted into `client/lib/contacts.ts` — it's the exact fingerprint-re-verify-then-`addContact` logic `service-worker-registration.tsx`'s `handleContactAccepted` already had, now needed in a second call site (the popup), so it was pulled out rather than duplicated a second time:

```ts
// client/lib/contacts.ts
export async function syncAcceptedContact(ownerUsername: string, contact: { id: string; username: string }, scannedFingerprint: string): Promise<void> {
  const found = await fetchUserById(contact.id);
  if (!found) return;
  const actualFingerprint = await fingerprint(fromBase64(found.mlKemPublicKey));
  if (actualFingerprint !== scannedFingerprint) {
    console.error("contact-accepted verification failed, not persisting:", found.username);
    return;
  }
  await addContact({ ownerUsername, id: found.id, username: found.username, mlKemPublicKey: found.mlKemPublicKey, acceptedAt: new Date().toISOString() });
}
```

`service-worker-registration.tsx`'s live-push handler now just calls this same function instead of re-implementing the check — the live path and the popup-sync path share one verification implementation, not two that could drift.

Safe to call redundantly (every popup-open re-syncs every already-accepted outgoing row, not just newly-accepted ones) because `addContact` is a keyed `put`/upsert on `[ownerUsername, id]` — re-writing an already-known contact is a no-op overwrite, not a duplicate or an error. This does mean a redundant `GET /users/:id` + fingerprint recompute per accepted row per popup-open; acceptable at this scale, flagged below rather than optimized away.

The badge-count logic on `/chat` was narrowed to match the now-broader feed: `fetchContactRequests` returns every notification (both directions, any status), so the badge filters to `direction === "incoming" && status === "pending"` specifically — otherwise accepted/sent rows would inflate a count that's supposed to mean "things needing your action."

### Migration note

The old `contact_requests` table was dropped directly (`DROP TABLE contact_requests`) rather than migrated — `drizzle-kit push`'s interactive rename-vs-recreate prompt can't run non-interactively (same recurring issue as earlier phases), and the only row present was leftover curl test data, not real user data. `notifications` was then created fresh via `drizzle-kit push`.

## Bug found after the redesign: BB's accept-notification push didn't deep-link to the popup

Clicking AA's own request-sent notification worked (`POST /contacts/request`'s push already used a `?open=...` deep link), but clicking BB's accept notification just navigated to a bare `/chat` — the popup never opened. Root cause: the accept push (`POST /contacts/requests/:id/accept` in `server/src/routes/contacts.ts`) still used `url: '/chat'`, left over from before the redesign gave BB a real notification worth deep-linking to. One-line fix (shown here with the query param's later-renamed value — see next section):

```ts
await notifyUserByPush(fromUser.id, {
  title: 'Primssg',
  body: `${user.username} accepted your contact request`,
  url: '/chat?open=notifications', // was '/chat'
  data: { /* ... */ },
})
```

Both contact-request push sites now consistently deep-link into the Notifications popup, matching the pattern already established for the initial request push.

## `?open=requests` renamed to `?open=notifications`

The query param that deep-links a push into the popup was still named after the old "contact requests" framing even after the popup itself became a generic "Notifications" list. Renamed for consistency, three call sites:

```ts
// client/app/chat/page.tsx
if (searchParams.get("open") === "notifications") { onOpenRequests(); router.replace("/chat"); }
```

```ts
// server/src/routes/contacts.ts — both POST /request and POST /requests/:id/accept
url: '/chat?open=notifications',
```

Purely a naming fix — no behavior change, no schema/data involved. `OpenRequestsFromQuery`'s own function/component name was left as-is (still reads as "opens the requests popup," which is accurate — it's the popup component's name, `RequestsPopup`, that didn't get renamed either, only its rendered title).

## Explicitly not done in this phase

- **No UI surfaces the resulting contacts list anywhere.** `listContacts()`/`getContact()` exist in `client/lib/contacts.ts` but nothing calls them yet — `/chat`'s conversation sidebar is still `FAKE_CONVERSATIONS = []`. Wiring accepted contacts into a real conversation list is separate, not-yet-scoped work.
- **No success confirmation beyond the row's status text changing** — no toast/checkmark, just "Pending" flipping to "Accepted" the next time the notification list is fetched.
- **No handling of a contact being accepted while `requestCount`'s badge is mid-transition** — a minor UI-freshness gap, not a data-correctness one (the badge just briefly under/over-counts by one until the popup closes and refetches).
- **No live-updating notification list** — like Phase 5, still fetched once per popup-open, no WebSocket/live push of new rows into an already-open popup. Redesign fixes staleness *across* opens (nothing is lost once seen), not live updates *within* one.
- **Redundant re-verification work on every popup-open** — every accepted outgoing row triggers a fresh `GET /users/:id` + fingerprint recompute each time the popup opens, not just the first time it's newly accepted. Harmless (upsert, no duplicate writes) but wasteful at any real scale; no attempt made to track "already synced" client-side.
- **If BB's `GET /users/:id` re-fetch fails or the fingerprint mismatches, the failure is silent** (`console.error` only) — BB never finds out their contact wasn't saved, beyond an easily-missed console message. This is now recoverable (next popup-open retries), but still gives no visible feedback if it keeps failing.
- **No decline/reject action** — still Phase 7, unchanged by this redesign.

## Verification

1. Register two users, send a contact request from one to the other's `id` including a `keyFingerprint` — confirm the response's `notification.data.scannedFingerprint` matches what was sent.
2. Confirm `POST /contacts/request` without `keyFingerprint` is rejected with 400.
3. `GET /contacts/requests?username=<sender>` immediately after sending — confirm an `outgoing`, `pending` row appears without needing any push (this is BB's "request is pending" notification, delivered by the send call itself).
4. `GET /contacts/requests?username=<recipient>` — confirm the paired `incoming`, `pending` row appears, with `data.pairId` pointing at the sender's row id and vice versa.
5. `POST /contacts/requests/:id/accept` as the recipient — confirm `{ contact: { id, username, mlKemPublicKey } }` is returned matching the requester's real data.
6. Re-fetch both users' `GET /contacts/requests` — confirm **both** paired rows flipped to `status: 'accepted'`, not just the recipient's.
7. Repeat the same accept call — confirm 409 `"request is not pending"`, not a silent success or duplicate push.
8. As the original requester (not the recipient), attempt to accept the same request id — confirm 404 `"request not found"`.
9. In the browser, with both AA and BB logged in (two profiles/browsers): AA accepts BB's request via `RequestsPopup` — confirm AA's IndexedDB (`webrtc-contacts`) gets a row for BB immediately, and BB's IndexedDB gets a row for AA either via the live push (`handleContactAccepted`) *or*, simulating a missed push (BB's tab closed at accept time, or notification dismissed unclicked), by BB simply opening the Notifications popup afterward — confirm BB's outgoing row now reads "accepted your contact request" and `webrtc-contacts` now has the entry, proving the sync doesn't depend on the push having been delivered.
9b. Click both the request-sent push (AA's side) and the accept push (BB's side) — confirm both deep-link via `?open=notifications` and actually open the popup, not just navigate to a bare `/chat`.
10. Tamper with the echoed fingerprint (e.g. temporarily change what the server sends) and confirm BB's client logs the verification failure and does *not* write a contact — proves the re-verification is actually enforced, not just present in code.
11. `bunx tsc --noEmit` clean in both `client/` and `server/` (run from within each directory).
