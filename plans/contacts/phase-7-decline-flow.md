# Phase 7 — Decline flow

Not yet scoped. Placeholder — Phase 5's `RequestsPopup` lists incoming requests with an Accept button (wired in Phase 6) but no way to reject/dismiss an unwanted one. This phase is about that missing counterpart.

To be figured out before implementation starts:
- Server: a decline endpoint and what happens to the row — deleted outright, or marked with a `'declined'` status (extending `contact_requests.status` beyond today's `'pending'`/`'accepted'`)?
- If kept as `'declined'` rather than deleted: does that block the same sender from requesting this recipient again, or can they retry?
- Client: Decline button placement/styling in `RequestsPopup` next to Accept, and whether declining needs a confirmation step (matching the existing Logout-confirmation `Popup` pattern) or is a single click.
- Does the sender get notified of a decline, or does the request just silently disappear from the recipient's list — Context's "handshake result is intentionally inert" principle (Phase 6) suggests a decline notifying the sender may be out of scope, same reasoning applied in reverse.
