# Phase 8 — Contacts UI

## Files

`client/components/contacts-popup.tsx` (new), `client/lib/chats.ts` (new, briefly named `convos.ts` before a rename), `client/app/chat/page.tsx` (new `Users` icon trigger; `FAKE_CONVERSATIONS` replaced with real state sourced from `chats.ts` + `contacts.ts`).

## Why this phase exists: `listContacts()`/`getContact()` had no caller

Phase 6 built the whole accept-and-persist pipeline — `webrtc-contacts` IndexedDB, `addContact`/`listContacts`/`getContact` — but nothing in the UI ever called `listContacts()` or `getContact()` after that. `/chat`'s sidebar was still `FAKE_CONVERSATIONS = []`, a hardcoded empty array left over from before any of the QR/push/accept work existed. An accepted contact was fully real and queryable, with genuinely nowhere to see it. This phase is the first thing to actually read from that store.

## Scope, decided upfront: a contact picker, not a chat screen

Chat/message UI has never been in scope for this plan (checklist.md's Context: "contacts are the prerequisite, not the conversation itself") — Phase 8 doesn't change that. What it delivers is narrower: a way to see and pick from accepted contacts, landing on the *existing* placeholder right-pane ("chat with X renders here") rather than building a new one. Confirmed directly before starting ("clicking the contact will open up the chat screen for that contact. but chat screen arre not designed yet.. so for now, just add it to cuurent chat list, as selected").

## `ContactsPopup`: same pattern as every other secondary UI in this app

```tsx
// client/components/contacts-popup.tsx
export function ContactsPopup({ open, onClose, user, onSelectContact }: {
  open: boolean; onClose: () => void; user: User; onSelectContact: (contact: Contact) => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    listContacts(user.username).then(setContacts);
  }, [open, user]);

  const filtered = contacts.filter((c) => c.username.toLowerCase().includes(query.toLowerCase()));
  // ...
}
```

A popup, not a route or a sidebar rewrite — this was an explicit design decision made mid-conversation ("actually.... i think a popup is better for this? better ui management"), matching Logout/QR-Code/Notifications, which are all `Popup`-based already. Fetches on `open`, same as `RequestsPopup` (Phase 5's reasoning still applies: avoid a query firing on every `/chat` mount regardless of whether the user ever opens it).

Search is entirely client-side (`Array.filter` on the already-fetched list) — the contact list is capped by however many QR handshakes a user has completed, nowhere near large enough to need server-side search, and there's still no searchable-user-database anywhere in this app by design (checklist.md Phase-1 decision) — this search is scoped to *already-accepted* contacts only, not a backdoor into that.

Clicking a row does two things and closes:

```tsx
onClick={() => {
  onSelectContact(c);
  onClose();
}}
```

## The Users icon: fourth trigger in the top bar

```tsx
<button onClick={() => setShowContacts(true)} aria-label="Contacts">
  <Users className="h-4 w-4" />
</button>
```

`Users` (lucide) chosen directly over a `Contact`/`BookUser` address-book-style icon — reads as "people," distinct at a glance from the existing `Bell` (Notifications) and `QrCode` icons already in the same row. No new layout pattern — same `h-9 w-9` rounded-full button style as its neighbors.

## `webrtc-chats`: a third IndexedDB, same scoping pattern as `webrtc-contacts`

```ts
// client/lib/chats.ts
export type LastMessage = { sender: string; message: string; status: string };

export type Conversation = {
  ownerUsername: string;
  contactId: string;
  lastMessage: LastMessage | null; // no messaging UI yet — always null until that's built
  createdAt: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('webrtc-chats', 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('chats', { keyPath: ['ownerUsername', 'contactId'] });
      store.createIndex('ownerUsername', 'ownerUsername');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

Third database following the exact shape `webrtc-keys` and `webrtc-contacts` already established: compound keyPath `[ownerUsername, ...]` for the same multi-identity-per-browser reason as `contacts.ts`, an `ownerUsername` index for listing. A fourth object store bolted onto `webrtc-contacts` was not the shape here — a conversation is a distinct concern from a contact (a contact can exist with no conversation; the UI needing a durable "this contact was selected/opened" record is new state, not an attribute of the contact itself), same Separation-of-Concerns reasoning `contacts.ts` itself was built with relative to `keys.ts`.

**Naming went through two rounds of correction.** First built as `client/lib/convos.ts` / `webrtc-convos` — flagged directly ("i guess webrtc-connvos is not a good name for it?") because `convos` is an abbreviation where `webrtc-keys`/`webrtc-contacts` are both full words, breaking the established naming convention. Renamed to `webrtc-chats` / `client/lib/chats.ts` (not `webrtc-conversations` — the shorter option was picked directly, also matching the sidebar's own visible "Chats" heading). Exported type/function names (`Conversation`, `listConversations`, `getOrCreateConversation`) were kept as-is through the rename — they were already accurate, only the file/DB/store names had drifted.

**`lastMessage: { sender, message, status } | null`, not a `messages` array.** The initial ask was for a `messages` array on the record — caught before building as real scope creep: an actual message log is what the whole plan has kept out of scope from the start (checklist.md Context, restated explicitly again this phase). Resolved directly ("oh i know... instead of messages array, it should be just lastMessage: { sender, message, status }") — a preview field for a future sidebar row (what Phase 5-era `FAKE_CONVERSATIONS` already had as a flat `lastMessage: string`, just typed as a real structured record now), not a place to actually store message history. Always `null` until real messaging is built; nothing in this phase ever writes to it.

`getOrCreateConversation` is the only write path, and it's idempotent:

```ts
export async function getOrCreateConversation(ownerUsername: string, contactId: string): Promise<Conversation> {
  const existing = /* get([ownerUsername, contactId]) */;
  if (existing) return existing;
  const conversation: Conversation = { ownerUsername, contactId, lastMessage: null, createdAt: new Date().toISOString() };
  /* put */
  return conversation;
}
```

Selecting the same contact twice never creates a duplicate row — same `put`-is-a-keyed-upsert pattern `addContact` already relies on in `contacts.ts`.

## Wiring: select → create/open → refresh → show

```tsx
// client/app/chat/page.tsx
async function handleSelectContact(contact: Contact) {
  if (!user) return;
  await getOrCreateConversation(user.username, contact.id);
  await refreshConversations();
  setSelected(contact.username);
}
```

`refreshConversations()` re-lists from `webrtc-chats` and joins each row against `getContact()` (from `contacts.ts`) to resolve a display username, since `Conversation` only stores `contactId`:

```tsx
async function refreshConversations() {
  if (!user) return;
  const convos = await listConversations(user.username);
  const joined = await Promise.all(
    convos.map(async (convo) => {
      const contact = await getContact(user.username, convo.contactId);
      return { ...convo, username: contact?.username ?? convo.contactId };
    }),
  );
  setConversations(joined);
}
```

Falls back to the raw `contactId` if `getContact` somehow returns nothing (shouldn't happen in practice — a conversation is only ever created from a contact that was just read from the same store — but keeps the row rendering something rather than silently vanishing if that invariant is ever violated). Runs once on mount (keyed on `user`) and again after every `handleSelectContact`, so the sidebar reflects a newly-created conversation immediately without a page reload.

`FAKE_CONVERSATIONS` is gone entirely — the sidebar `<ul>` now maps `conversations` (real state), and the existing empty-state block ("No chats yet" / `MessageCircle` icon) now gates on `conversations.length === 0` instead of the old hardcoded array's length, so it still shows correctly for a genuinely fresh account with zero conversations.

The sidebar row's second line changed from the old fake shape's three separate fields (`lastMessage`, `time`, `unread` badge) to just:

```tsx
<span className="truncate text-sm text-zinc-500">
  {c.lastMessage ? c.lastMessage.message : "No messages yet"}
</span>
```

`time`/`unread` were dropped, not carried forward as dead fields — nothing populates them yet (no messaging exists), and keeping unused UI for data that's always empty would just be inert scaffolding.

## Explicitly not done in this phase

- **No chat/message screen.** The right pane is completely unchanged — still `hidden md:flex` (desktop-only) rendering "chat with {selected} renders here." This phase only makes `selected` resolve to a real, persisted conversation instead of arbitrary transient state.
- **`lastMessage` is never written.** The field exists on `Conversation` and renders correctly when present, but nothing in this phase (or any prior phase) ever sets it to a non-null value. Wiring real messaging is unscoped future work, likely its own plan doc given the size of that surface (WebRTC data channel wiring, `messages-store.ts`/failover-message integration already exists elsewhere in this codebase — see `client/lib/api.ts`'s `sendFailoverMessage`/`fetchFailoverMessages` — but none of it is connected to `webrtc-chats` yet).
- **No delete/leave-conversation action.** Once created via `getOrCreateConversation`, a conversation row has no UI to remove it.
- **No mobile view for the selected chat.** The right pane's `hidden md:flex` means selecting a contact on a narrow viewport updates `selected` and the sidebar highlight, but there is still nothing to actually show — same limitation the sidebar/right-pane split already had before this phase, not introduced by it.
- **`ContactsPopup`'s search has no debounce/highlighting** — plain synchronous filter on every keystroke, fine at the scale a personal contact list realistically reaches.

## Verification

1. Register two users, complete a QR handshake and accept (Phases 1–6) so both have each other as an accepted contact in `webrtc-contacts`.
2. Open the Contacts popup (`Users` icon) — confirm the accepted contact's username appears.
3. Type a partial username into the search box — confirm the list filters live; clear it — confirm the full list returns.
4. Click a contact — confirm the popup closes, the sidebar now shows a row for that contact ("No messages yet"), and the row is visually selected (matches the existing `bg-black/5`/`dark:bg-white/5` highlight style).
5. Close and reopen `/chat` (simulating a fresh mount) — confirm the conversation still appears in the sidebar without needing to re-select the contact (`listConversations` correctly reads the persisted row).
6. Click the same contact a second time from the Contacts popup — confirm no duplicate row appears in the sidebar (`getOrCreateConversation`'s idempotency).
7. With zero conversations (fresh account, no contacts selected yet), confirm the "No chats yet" empty state still renders correctly.
8. `bunx tsc --noEmit` clean in `client/` (run from within the directory).
