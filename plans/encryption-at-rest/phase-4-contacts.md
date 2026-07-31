# Phase 4 — Adding contacts

Not yet scoped. Placeholder — Phase 3's chat UI removed user search entirely, leaving no way to start a new conversation from the app. This phase is about how a user adds/finds someone to chat with, replacing that gap.

To be figured out before implementation starts (see checklist.md's "Related, deliberately deferred" section — user discovery / key verification is already flagged there as needing design work):
- How discovery works now that open username search is gone (was: `GET /users?q=`, deliberately removed).
- Whether this is just "search again, but scoped/permissioned," or the QR-code/handshake model floated earlier.
- Relationship to key verification (trust-on-first-use vs. out-of-band verification) — same deferred item, may or may not be bundled in.
