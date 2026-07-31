# Phase 7 — Decline flow

**Deliberately left unfinished.** This is not a placeholder waiting to be scoped later — it's a scope call made on purpose: a pending contact request can be accepted, but there is no way to decline/reject one. An unwanted incoming request just sits in the recipient's Notifications list as pending indefinitely (or the recipient ignores it and never accepts).

What this means concretely: `notifications.status` only ever has `'pending'`/`'accepted'` (see `server/src/db/schema.ts`), with no `'declined'` value; `RequestsPopup` (`client/components/requests-popup.tsx`) renders an Accept button on incoming/pending rows and nothing else — no Decline/dismiss action next to it.

If this gets picked up later, the open questions below are what would need deciding first (kept for reference, not acted on):
- Server: a decline endpoint and what happens to the row — deleted outright, or marked with a `'declined'` status (extending `notifications.status` beyond today's `'pending'`/`'accepted'`)?
- If kept as `'declined'` rather than deleted: does that block the same sender from requesting this recipient again, or can they retry?
- Client: Decline button placement/styling in `RequestsPopup` next to Accept, and whether declining needs a confirmation step (matching the existing Logout-confirmation `Popup` pattern) or is a single click.
- Does the sender get notified of a decline, or does the request just silently disappear from the recipient's list — Context's "handshake result is intentionally inert" principle (Phase 6) suggests a decline notifying the sender may be out of scope, same reasoning applied in reverse.
