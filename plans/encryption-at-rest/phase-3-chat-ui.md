# Phase 3 — Chat UI (the readiness gate for message encryption)

## Files

`client/app/chat/page.tsx` (new — was prototyped at `client/app/mockup/page.tsx`, then promoted), `client/app/chat-old/[username]/page.tsx` (old real chat page, moved here as reference, not routed), `client/app/users/page.tsx` (stripped down), `client/app/page.tsx` (modified), `client/lib/api.ts` (`searchUsers` removed), `client/components/popup.tsx` (new), `client/app/globals.css` (modified), `client/app/layout.tsx` (modified), `dev.sh` (new), root `package.json` (modified).

## Why this exists as its own phase

Phase 2 (challenge-based login) left `/users` as the post-login landing page — a bare username-search box, "not a normal chat app at all." Message encryption (Phase 4) needs a real place to send/receive messages from; building it against the old search-only page would mean building it twice. So the chat UI had to exist first, as a real (not throwaway) route, before Phase 4's send/receive wiring makes sense to attach to it. This phase is UI shell only — no new crypto, no new backend data model — but it's the concrete "UI is ready" condition Phase 4 was gated on.

## Approach: mockup-first, then promote

Built at `client/app/mockup/page.tsx` against fake in-file data (`FAKE_CONVERSATIONS: [] `), iterated purely visually with no backend calls, then moved wholesale to become the real `client/app/chat/page.tsx` once the layout was accepted — `mv` of the file, not a rewrite. The component function is still named `MockupPage` (not renamed during the move — a follow-up cleanup item, not yet done).

## Layout: two-column on desktop, single column on mobile

```
client/app/chat/page.tsx
  <div className="flex w-full flex-1 min-h-0">          // row, fills remaining viewport height
    <div className="... md:w-sm md:shrink-0 md:border-r ...">  // sidebar: full width on mobile, fixed md:w-sm on desktop
      sticky header ("Chats")
      <ul> of conversations (from FAKE_CONVERSATIONS, currently always empty)
      empty state (MessageCircle icon + "No chats yet") when the list is empty
      sticky bottom bar with the logout button
    </div>
    <div className="hidden ... md:flex">                 // chat pane: hidden on mobile, flex on desktop
      placeholder text ("Select a conversation" / "chat with {selected} renders here")
    </div>
  </div>
```

No conversation-detail view exists on mobile yet (the right pane is `hidden` below `md`) — selecting a conversation only changes `selected` state and the (still-placeholder) desktop pane. A mobile drill-down view is unbuilt; not needed until real conversation data exists.

## The scroll-container bug (structural, not a CSS-value bug)

`overflow-y-auto` lives on the *outer* sidebar `<div>`, not on the `<ul>` — the sticky header, the `<ul>`, and the sticky logout bar are all direct children of that one scrolling container. Putting `overflow-y-auto` on the `<ul>` instead (a natural-looking nesting: header outside, scrollable list inside) breaks the sticky header entirely, because then the header and the scrolling content are no longer in the same scroll/stacking context — nothing the header is "sticky" *within* is actually scrolling. This cost significant debugging time before the fix, because the visible symptom (glassmorphic header not showing a blur effect against scrolled content) looked like a `backdrop-filter`/Tailwind opacity-modifier problem, not a structural one — several rounds of checking compiled CSS output confirmed the *value* was fine before the real cause (scroll-context mismatch) was found. **Lesson for any future sticky-header-over-scrolling-content layout in this codebase: verify header and scrollable content are direct siblings under the same `overflow-y-auto` element before suspecting the CSS property itself.**

Related global fixes, needed for the sticky/scroll layout to have a bounded height to work within at all:
- `client/app/layout.tsx`: `<body>` changed from `min-h-full` to `h-full` — flex children need a true bounded ancestor height to compute their own `min-h-0`/scroll behavior against; `min-h-full` doesn't provide that bound.
- `client/app/globals.css`: added `color-scheme: light` / `color-scheme: dark` (in `:root` and the dark media query) so native browser UI (scrollbars, form controls) respects the app's dark mode instead of defaulting to light.
- `client/app/globals.css`: added `button:not(:disabled) { cursor: pointer; }` — Tailwind v4's preflight resets buttons to `cursor: default`, which read as "nothing is clickable" during review.

## Glassmorphic sticky header

```
bg-background/30 backdrop-blur-lg shadow-xl
```
Requires: the `--background` CSS variable that Tailwind's `bg-background/<opacity>` modifier resolves via `color-mix()` must not be a plain unsupported value — confirmed working once the scroll-context bug (above) was fixed; the glass effect itself was never actually broken, it just had nothing correctly-scrolling beneath it to be visible against. Do not use inline `style={{ backgroundColor: ... }}` for this — Tailwind utility classes only, matching the rest of the codebase's styling approach.

## Popup component

`client/components/popup.tsx` (new, generic — not chat-specific) — built for the logout confirmation but designed reusable:
- Full-width/height on mobile; centered card with backdrop blur (`md:bg-black/10 md:backdrop-blur-md`) + click-outside-to-close on desktop.
- Header: title + close (X) button. Content: `children` (arbitrary). Footer: first button left-aligned, remaining buttons right-aligned (`buttons` prop overrides the default `[Cancel, Confirm]` pair entirely).
- Default footer buttons are colored by convention: Cancel/Close defaults to red (`#dc2626`), Confirm defaults to green (`#16a34a`), both overridable per-button via `bgColor`/`fgColor` props (inline `style`, since these are arbitrary runtime values Tailwind can't generate classes for ahead of time — the one deliberate exception to "Tailwind classes only" in this codebase, scoped to just this dynamic-color case).
- Open/close animation via the `tw-animate-css` package (added as a dependency; Tailwind v4 core has no `animate-in`/`animate-out` utilities on its own). Exit animation requires delaying unmount: the component keeps `rendered=true` for `ANIMATION_MS` (200ms) after `open` flips to `false`, swapping `animate-in`→`animate-out` classes during that window, matching a `setTimeout` to the CSS transition duration — a plain `if (!open) return null` unmounts instantly and never gives the exit animation a chance to play.

Wired into `client/app/chat/page.tsx`: the logout button (bottom of the sidebar) opens the Popup instead of calling `logout()` directly; `onConfirm` performs the actual `logout()` + redirect to `/`.

## Removed: user search, everywhere

`client/lib/api.ts`'s `searchUsers()` deleted entirely (was `GET /users?q=...&exclude=...`). `client/app/users/page.tsx` stripped down to just a greeting + logout button — no search input, no results list. This leaves `/users` with no way to reach a chat and no inbound links from anywhere in the app; an accepted, known gap (real conversation list data — Phase 4+ or later — is what's meant to replace it, not a rebuilt search).

## Routing: `/chat` is the new landing page

`client/app/page.tsx`: both post-login redirect points (`useEffect` auto-redirect for an already-hydrated session, and the `handleSubmit` success path) changed from `/users` to `/chat`.

The old real WebRTC chat implementation (`useWebRtcChat` hook, message bubbles, file attach) was moved from `client/app/chat/[username]/page.tsx` to `client/app/chat-old/[username]/page.tsx` — kept only as reference for wiring Phase 4/conversation-detail work, not routed to, and marked for deletion once no longer needed.

## Dev workflow fixes (unblocking iteration on this phase, not UI code itself)

Building/reloading this page repeatedly surfaced two local-dev reliability problems, fixed alongside:
- `dev.sh` (new, root): runs `docker compose up -d`, polls `pg_isready` until Postgres accepts connections, polls `curl` against RustFS until it responds, *then* runs `bun run --cwd server db:push`, *then* starts both dev servers (`bun run --filter '*' dev`). Root `package.json`'s `dev` script now calls this instead of running dev servers directly — the prior direct approach raced against Postgres/RustFS startup and produced intermittent 500s.
- `bun run wipe` (root `package.json`, new): `docker compose down -v` — full local Postgres+RustFS volume reset on demand.
- `server/src/index.ts`: `ensureAttachmentsBucket()` changed from blocking the server's `Bun.serve()` startup to fire-and-forget (`.catch()` logged, not awaited) — RustFS being slow no longer delays the backend binding its port, same race-condition class as the Postgres fix above.

## Still fake / not yet wired (carried into Phase 4 and beyond)

- `FAKE_CONVERSATIONS` is a hardcoded empty array — no `/messages/conversations` backend endpoint exists yet. Building it is separate work, not yet scoped as its own phase.
- The right-hand chat pane is placeholder text only (`"chat with {selected} renders here"`) — not wired to `useWebRtcChat` or any real message list.
- `MockupPage` function name not yet updated to reflect its promoted, non-mockup status.
- `client/app/chat-old/[username]/page.tsx` still exists on disk, marked for deletion once Phase 4 work no longer needs it as reference.

## Verification

1. `bunx tsc --noEmit` clean in `client/`.
2. Login/register redirects to `/chat`, not `/users`.
3. Resize to mobile width: sidebar takes full width, chat pane is hidden. Resize to desktop width: two columns, sidebar fixed-width, chat pane visible.
4. Scroll the conversation list (once non-empty test data is present) and confirm the header stays visibly glassmorphic (blurred, translucent) against scrolled-under content, not just visually static.
5. Click the logout button: confirmation popup opens (mobile: full-screen; desktop: centered card, backdrop blurred, click-outside closes it). Confirm closes the popup, logs out, and redirects to `/`.
6. `bun run dev` from a fully wiped state (`bun run wipe` first) comes up without any manual retry — confirms the Postgres/RustFS readiness gating actually holds.
