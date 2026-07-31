# Phase 8 — Contacts UI

## Files

`client/components/contacts-popup.tsx` (new), `client/lib/chats.ts` (new, briefly named `convos.ts` before a rename), `client/components/chat-pane.tsx` (new — mockup chat UI), `client/app/chat/page.tsx` (new `Users` icon trigger; `FAKE_CONVERSATIONS` replaced with real state sourced from `chats.ts` + `contacts.ts`; mobile layout reworked so selecting a contact swaps the sidebar for `ChatPane` instead of nothing rendering).

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

## Bug found after initial build: selecting a contact did nothing visible on mobile

The right pane was `hidden flex-1 items-center justify-center md:flex` — `display: none` below the `md` breakpoint unconditionally, regardless of `selected`. On mobile, clicking a contact updated state correctly but there was nothing to show for it: reported directly ("on small screen, the message area is not opened. when a chat is selected").

Fixed by making both panes' visibility depend on `selected`, not just the breakpoint — the standard list↔detail mobile pattern, confirmed directly before building (chose "selecting a contact swaps sidebar for the chat pane" over "just unhide the chat pane and stack it below"):

```tsx
// client/app/chat/page.tsx — sidebar
<div className={`w-full flex-col ... md:flex md:w-sm ... ${selected ? "hidden" : "flex"}`}>

// right pane
<div className={`min-h-0 flex-1 flex-col ${selected ? "flex" : "hidden md:flex"}`}>
```

On desktop (`md:flex` on both), `selected` has no effect on visibility — both panes always show side-by-side, matching the original design. On mobile, exactly one of the two is visible at a time. A back arrow (see below) is what returns to the sidebar.

## `ChatPane`: a UI mockup, not a wired chat screen

Once the right pane could actually show something on any screen size, the placeholder text ("chat with {selected} renders here") was replaced with a real-looking mockup — explicitly scoped as UI only, not functionality: "let's create a chat ui... just a mockup... learn from the one already done in chat-old (the functionality, not the ui)."

`client/app/chat-old/[username]/page.tsx` (a pre-existing, still-present WebRTC chat implementation predating this whole contacts plan) was read for its *shape*, not copied: connection status text, message bubbles aligned by `fromSelf`, a four-state status label on own messages only (`sending`/`in-transit`/`sent`/`read` — `client/lib/messages-store.ts`'s `MessageStatus`), file attachments rendered distinctly from text, an attach button + input + send button row. `ChatPane` (`client/components/chat-pane.tsx`) reproduces that same set of visual states against `MOCK_MESSAGES` (a hardcoded array covering every status and both a text and a file message in each direction) — no `useWebRtcChat`, no data channel, no real send/receive. The header's "Connected"/"Connecting…" toggle is likewise hardcoded (`const connected = true`), not read from any real connection.

Visual language deliberately matches this app's actual current styling rather than `chat-old`'s (which predates `Popup`, the icon-button top-bar pattern, and the orange accent): sticky blurred header identical in structure to the sidebar's own, `rounded-full` icon buttons, message bubbles at `rounded-2xl` (softer than `chat-old`'s plain `rounded`), and the same `#ea580c` orange used for the QR-download and send buttons.

**Message input is a `<textarea>`, not the original `<input>`** — chat-old's single-line input was explicitly upgraded ("multi line, with max height"): auto-grows on input up to `MAX_TEXTAREA_HEIGHT` (160px) via a manual `scrollHeight` read in `onChange`, then scrolls internally past that; Enter submits, Shift+Enter inserts a newline; border-radius matches the message bubbles (`rounded-2xl`) rather than the pill (`rounded-full`) originally used for the trigger buttons around it.

**Back navigation lives inside `ChatPane`'s own header, not as a separate bar above it.** First built as a standalone `md:hidden` bar with an arrow + "Back" label sitting above the pane; corrected twice in direct succession ("back button should be inline with name. Just the arrow.") — moved into `ChatPane`'s existing header row next to the username, icon-only, still `md:hidden` (irrelevant on desktop, where both panes always show and there's nothing to "back" out of):

```tsx
export function ChatPane({ username, onBack }: { username: string; onBack?: () => void }) {
  // ...
  {onBack && (
    <button onClick={onBack} aria-label="Back to chats" className="... md:hidden ...">
      <ArrowLeft className="h-4 w-4" />
    </button>
  )}
  <h1 className="text-base font-semibold ...">{username}</h1>
```

`chat/page.tsx` passes `onBack={() => setSelected(null)}` — clearing `selected` is what flips both panes' visibility back (the same conditional classes from the mobile-layout fix above), so `ChatPane` itself has no navigation logic, just a callback.

**Own-message bubble color went through several rounds of live tuning**, purely aesthetic, no functional stakes: started as `bg-foreground text-background` (inherited from `chat-old`, i.e. solid black/white depending on theme) → changed to a solid `#ea580c` fill with white text (too much contrast, reverted) → `bg-orange-500` at decreasing then increasing opacity fractions (`/15` → `/8`, called "too dark" each time — opacity was being read as darkness/murkiness at low values, not lightness) → settled at `bg-orange-500/64` after being told to go the opposite direction ("higher.. like 70", then "50", then "64"). Final value: a semi-transparent orange tint over the background, dark/light text depending on theme (not white) — much closer to the peer bubble's existing subtle-background treatment than a solid brand-color fill.

Header padding was also reduced across all three sections (header, message list, input form) from the sidebar-inherited `px-8` down to `px-4`, and the header's vertical padding/font-size shrunk (`py-6`→`py-3`, `text-xl`→`text-base`) after direct feedback that the copied sidebar-header sizing read as oversized for a per-conversation header.

## Explicitly not done in this phase

- **No real chat functionality.** `ChatPane` is a pure UI mockup — no `useWebRtcChat`, no signaling, no data channel, no send/receive. The form's `onSubmit` just clears the draft locally. Wiring this to `chat-old`'s actual WebRTC logic (or a rewritten version of it) is unscoped future work.
- **`lastMessage` is never written.** The field exists on `Conversation` and renders correctly when present, but nothing in this phase (or any prior phase) ever sets it to a non-null value — the sidebar always shows "No messages yet" for now. Wiring real messaging is unscoped future work, likely its own plan doc given the size of that surface (WebRTC data channel wiring, `messages-store.ts`/failover-message integration already exists in `chat-old` and `client/lib/api.ts`'s `sendFailoverMessage`/`fetchFailoverMessages`, but none of it is connected to `webrtc-chats` or `ChatPane` yet).
- **No delete/leave-conversation action.** Once created via `getOrCreateConversation`, a conversation row has no UI to remove it.
- **`ContactsPopup`'s search has no debounce/highlighting** — plain synchronous filter on every keystroke, fine at the scale a personal contact list realistically reaches.

## Verification

1. Register two users, complete a QR handshake and accept (Phases 1–6) so both have each other as an accepted contact in `webrtc-contacts`.
2. Open the Contacts popup (`Users` icon) — confirm the accepted contact's username appears.
3. Type a partial username into the search box — confirm the list filters live; clear it — confirm the full list returns.
4. Click a contact — confirm the popup closes, the sidebar now shows a row for that contact ("No messages yet"), and the row is visually selected (matches the existing `bg-black/5`/`dark:bg-white/5` highlight style).
5. Close and reopen `/chat` (simulating a fresh mount) — confirm the conversation still appears in the sidebar without needing to re-select the contact (`listConversations` correctly reads the persisted row).
6. Click the same contact a second time from the Contacts popup — confirm no duplicate row appears in the sidebar (`getOrCreateConversation`'s idempotency).
7. With zero conversations (fresh account, no contacts selected yet), confirm the "No chats yet" empty state still renders correctly.
8. At a mobile viewport width, select a contact — confirm the sidebar hides and `ChatPane` shows full-width with the mock messages, connection status, and input row; click the back arrow next to the username — confirm it returns to the sidebar with the conversation still selected/highlighted in the list.
9. At a desktop viewport width, select a contact — confirm both the sidebar and `ChatPane` are visible side-by-side simultaneously, and no back arrow is shown.
10. In `ChatPane`, type a multi-line message (or a long single line) — confirm the textarea grows with content up to the max height, then scrolls internally; press Shift+Enter — confirm it inserts a newline instead of submitting; press Enter alone — confirm it submits (clears the draft).
11. `bunx tsc --noEmit` clean in `client/` (run from within the directory).
