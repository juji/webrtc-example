# Phase 6 — Accept flow + contact persistence

## Files

`client/lib/contacts.ts` (new), `server/src/routes/contacts.ts` (added `POST /requests/:id/accept`), `client/lib/api.ts` (added `acceptContactRequest`/`AcceptedContact`), `client/components/requests-popup.tsx` (Accept button wired), `client/app/chat/page.tsx` (notification count badge — preamble, not the accept flow itself).

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

## Explicitly not done in this phase

- **No UI surfaces the resulting contacts list anywhere.** `listContacts()`/`getContact()` exist in `client/lib/contacts.ts` but nothing calls them yet — `/chat`'s conversation sidebar is still `FAKE_CONVERSATIONS = []`. Wiring accepted contacts into a real conversation list is separate, not-yet-scoped work.
- **No success confirmation beyond the row disappearing** — no toast/checkmark, just the list re-rendering without that entry.
- **No handling of a contact being accepted while `requestCount`'s badge is mid-transition** — a minor UI-freshness gap, not a data-correctness one (the badge just briefly under/over-counts by one until the popup closes and refetches).
- **BB (the requester) has no UI feedback that AA accepted** beyond the push notification itself — no unread/pending-outgoing-request indicator on BB's side.

## Verification

1. Register two users, send a contact request from one to the other's `id`, confirm it appears in the recipient's `GET /contacts/requests`.
2. `POST /contacts/requests/:id/accept` as the recipient — confirm `{ contact: { id, username, mlKemPublicKey } }` is returned matching the requester's real data.
3. `SELECT status FROM contact_requests WHERE id = ...` — confirm it flipped to `'accepted'`.
4. Repeat the same accept call — confirm 409 `"request is not pending"`, not a silent success or duplicate push.
5. As the original requester (not the recipient), attempt to accept the same request id — confirm 404 `"request not found"`.
6. `GET /contacts/requests?username=<recipient>` after acceptance — confirm the accepted request no longer appears (query filters on `status = 'pending'`).
7. In the browser: accept a real request via `RequestsPopup`'s Accept button — confirm the button shows "Accepting…" then the row disappears, and (via DevTools → Application → IndexedDB → `webrtc-contacts`) confirm a row was written with the correct `ownerUsername`/`id`/`username`/`mlKemPublicKey`/`acceptedAt`.
8. `bunx tsc --noEmit` clean in both `client/` and `server/` (run from within each directory).
