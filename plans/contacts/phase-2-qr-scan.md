# Phase 2 — QR code scan

## Files

`server/src/routes/users.ts` (added `GET /:id`), `client/lib/api.ts` (added `fetchUserById`, `PublicUser` type), `client/lib/scan-qr.ts` (new — decode helpers), `client/components/qr-code-popup.tsx` (new — replaces the QR-only markup that used to live inline in `client/app/chat/page.tsx`), `client/app/chat/page.tsx` (simplified to just mount `QrCodePopup`), `client/package.json` (added `jsqr`).

## Scope decision: fetch + verify is part of this phase, not Phase 3/4

Originally scoped as "just decode the QR and show what's in it." Reconsidered before building: a scan that only decodes JSON doesn't establish anything — the whole point of Phase 1's fingerprint-in-QR design was trust-on-first-use verification (see checklist.md's Context), and that verification only happens once the real key is fetched from the server and hashed. Deferring the fetch/verify step to a later phase would have meant re-opening this phase's UI to add it later. So Phase 2 ends at "verified this really is who the QR claims, or not" — Phase 3 (the handshake) picks up from a confirmed-verified scan, not a raw decode.

## Server: lookup-by-id, explicitly not search

```ts
// server/src/routes/users.ts
usersRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [user] = await db
    .select({ id: users.id, username: users.username, mlKemPublicKey: users.mlKemPublicKey })
    .from(users)
    .where(eq(users.id, id))
  if (!user) return c.json({ error: 'user not found' }, 404)
  return c.json({ user })
})
```

Deliberately requires an already-known `id` (from a scan) rather than any queryable field — matches checklist.md's "no searchable contact database" decision. Selecting only `id`/`username`/`mlKemPublicKey` (not `mlDsaPublicKey`, not `createdAt`) — no reason to expose more than what verification needs.

**Pre-existing inconsistency noticed, not fixed here** (out of this phase's scope, flagged for awareness): `GET /users/` (the old open search route) still exists and works exactly as before, even though the client-side `searchUsers()` function that called it was deleted in [[encryption-at-rest]] Phase 3. The server-side search endpoint was never actually removed — it's just unused from the client today. Worth deleting at some point, but that's a separate cleanup, not part of this phase's diff.

## Client: two decode paths, one shared parser

`client/lib/scan-qr.ts`:

```ts
export type ScannedContact = { id: string; username?: string; keyFingerprint: string };

function parsePayload(text: string): ScannedContact | null { /* JSON.parse + shape check */ }

export async function decodeQrFromFile(file: File): Promise<ScannedContact | null> {
  // createImageBitmap(file) -> draw to canvas -> getImageData -> jsQR(...)
}

export function scanQrFromVideo(video: HTMLVideoElement, onResult: (contact: ScannedContact) => void) {
  // requestAnimationFrame loop: draw current video frame to canvas -> jsQR(...)
  // calls onResult and stops once a valid payload is found; returns a stop() fn
}
```

Both paths funnel through the same `parsePayload` so the rest of the app (verification, and later the handshake) only ever deals with one shape, regardless of whether the QR came from a live camera frame or an uploaded image. `jsQR` operates on raw `ImageData` either way — camera and file-upload are just two different ways of getting pixels onto a canvas.

Library choice: `jsQR` (npm, no Bun-specific API) is decode-only and unopinionated about camera lifecycle — deliberately chosen over a heavier all-in-one library (e.g. `html5-qrcode`) since this app already has to manage its own popup/tab lifecycle, and driving `getUserMedia` + a `requestAnimationFrame` loop directly is a small amount of code, not worth pulling in a bigger dependency for.

## Client: merged into one tabbed popup, not a separate scan popup

`client/components/qr-code-popup.tsx` absorbed the QR-generation code that used to live directly in `client/app/chat/page.tsx` (Phase 1's `useEffect` + `<img>` + Download button), rather than adding a second, separate popup for scanning. Reasoning: they're the same conceptual action ("here's my QR code" / "read someone else's QR code") and a tabbed single popup matches the instruction to title it just "QR Code" with "My QR Code" / "Scan QR Code" as tabs, rather than two differently-titled popups.

Component owns four pieces of state: `tab` (`"mine" | "scan"`), `qrDataUrl` (Phase 1's generated code), `scanned` (a decoded `ScannedContact` once found), `verifyResult` (`checking` / `verified` / `mismatch` / `not-found`). Effects:
- Regenerates `qrDataUrl` whenever the popup opens on the "mine" tab (unchanged from Phase 1).
- Starts the camera + `scanQrFromVideo` loop whenever the "scan" tab is active and nothing's been scanned yet; tears down the `MediaStream` and stops the scan loop on cleanup (tab switch, popup close, or a result found).
- Once `scanned` is set (by either the camera loop or the upload handler), fetches the real key and computes `verifyResult` — this is the fetch-and-verify step described above.
- Resets all scan-related state (`tab` back to `"mine"`, `scanned`, `verifyResult`) whenever the popup closes, so reopening always starts fresh rather than showing a stale scan result.

Camera failure (permission denied, no camera) is caught silently — the upload button is always available as a fallback regardless of camera state, so there's no separate "camera unavailable" error UI to build.

## Verification (fingerprint check, not just "did it decode")

```ts
useEffect(() => {
  if (!scanned) return;
  setVerifyResult({ status: "checking" });
  fetchUserById(scanned.id).then(async (found) => {
    if (!found) { setVerifyResult({ status: "not-found" }); return; }
    const actualFingerprint = await fingerprint(fromBase64(found.mlKemPublicKey));
    setVerifyResult(
      actualFingerprint === scanned.keyFingerprint
        ? { status: "verified", username: found.username }
        : { status: "mismatch" },
    );
  });
}, [scanned]);
```

Reuses `fingerprint()` from `client/lib/keys.ts` unchanged (Phase 1) — same hash function on both the generating and scanning side is what makes the comparison meaningful. A mismatch is surfaced as a real, distinct UI state ("Key fingerprint doesn't match... may be out of date or tampered with"), not silently treated the same as a not-found user — these are different failure modes worth telling the user apart (a stale/tampered QR vs. a QR for someone who no longer exists).

## Explicitly not done in this phase

- **No action on a "Verified" result.** Confirms trust, stops there — no "Add contact" button, no server write, no notification to the scanned user. That's Phase 3 (the live handshake) and Phase 4 (persistence).
- **No UI for camera permission being denied** beyond silently falling back to upload-only — no explicit "camera blocked, here's how to enable it" messaging.
- **No re-scan rate limiting or camera-frame throttling** — the `requestAnimationFrame` loop runs every frame; fine at this scale, would need throttling if it ever became a real performance concern.
- Old `GET /users/` open-search route not removed (noted above) — separate cleanup.

## Verification

1. Open `/chat`, click the QR header button, switch to "Scan QR Code" — camera permission prompt appears (or upload button works if denied/unavailable).
2. Scan a QR generated by Phase 1 (e.g. a second logged-in account's code) — confirm it decodes and shows "Verified: {username}".
3. Manually edit a downloaded QR's encoded fingerprint (or construct a fake payload) and scan it — confirm "Key fingerprint doesn't match" is shown, not a false "Verified."
4. Scan/upload a QR encoding an `id` that doesn't exist server-side (e.g. after `bun run wipe`) — confirm "No user found" is shown.
5. Upload a non-QR image — confirm it's handled gracefully (no result, no crash), since `decodeQrFromFile` returns `null` when `jsQR` finds nothing.
6. Close and reopen the popup after a scan — confirm it resets to the "My QR Code" tab with no stale scan state.
7. `bunx tsc --noEmit` clean in both `client/` and `server/`.
