# Phase 1 — QR code creation

## Files

`client/lib/keys.ts` (added `fingerprint()`), `client/app/chat/page.tsx` (modified — QR trigger button, popup, generation effect), `client/components/popup.tsx` (modified — single-button footer now right-aligned + full-width instead of always left-aligned), `client/package.json` (added `qrcode` + `@types/qrcode`).

## Payload: fingerprint, not the raw key

First attempt encoded `{ id, username, mlKemPublicKey: toBase64(...) }` directly. The ML-KEM-768 public key is ~1184 bytes raw, ~1580 characters once base64-encoded — far past what a QR can hold at a reasonable density. `qrcode` was forced to its largest version (40), rendering as a dense, barely-scannable grid, confirmed visually against a real generated code before switching approach.

Fixed by encoding a fingerprint instead of the key itself:

```ts
// client/lib/keys.ts
export async function fingerprint(publicKey: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(publicKey).buffer as ArrayBuffer);
  return toBase64(new Uint8Array(digest)).slice(0, 16);
}
```

`new Uint8Array(publicKey).buffer as ArrayBuffer` works around a TS quirk where `Uint8Array<ArrayBufferLike>`'s `.buffer` doesn't satisfy `BufferSource` (`ArrayBufferLike` includes `SharedArrayBuffer`, which `crypto.subtle.digest` doesn't accept) — re-wrapping produces a fresh view backed by a plain `ArrayBuffer`.

Truncating the SHA-256 digest to 16 base64 chars (~12 bytes / 96 bits) keeps the QR payload short (`{ id, username, keyFingerprint }` is on the order of 90 characters total, not ~1600) while remaining infeasible to collide by chance for this use case — the fingerprint isn't the sole authentication factor, only a check against a key independently fetched from the server by `id` (Phase 2's job).

**Trust model is unchanged from the original raw-key design**, just split into two steps: BB reads `keyFingerprint` directly off AA's screen (out-of-band, same as before), then in Phase 2 fetches AA's actual `mlKemPublicKey` from the server by `id` and re-hashes it locally — accepting the key only if it matches. A server that tries to hand back a substituted key still fails the hash check. The QR itself never needs to carry key bytes.

## Trigger + render

`client/app/chat/page.tsx`: a `QrCode` (lucide) icon button sits in the sidebar's sticky header, next to the "Chats" title:

```tsx
<button onClick={() => setShowQr(true)} aria-label="Show my QR code" ...>
  <QrCode className="h-4 w-4" />
</button>
```

Generation is driven by a `useEffect` gated on `showQr` (only runs while the popup is open) and `user`:

```tsx
useEffect(() => {
  if (!showQr || !user) return;
  loadKeys(user.username).then(async (keys) => {
    if (!keys) return;
    const payload = JSON.stringify({
      id: user.id,
      username: user.username,
      keyFingerprint: await fingerprint(keys.kemPublicKey),
    });
    setQrDataUrl(await QRCode.toDataURL(payload));
  });
}, [showQr, user]);
```

`loadKeys` reads the local IndexedDB key bundle (`client/lib/keys.ts`, unchanged) — no server round-trip needed to render the code, since everything in the payload is already known client-side. `qrDataUrl` starts `null`; the popup shows an `animate-pulse` placeholder block until the async chain resolves, then swaps to the real `<img>`.

## Popup: Download button, right-aligned and full-width

The QR `Popup` instance passes a single custom `buttons` entry (Download) instead of the default Cancel/Confirm pair:

```tsx
<Popup
  open={showQr}
  onClose={() => setShowQr(false)}
  title="My QR code"
  buttons={qrDataUrl ? [{ label: "Download", onClick: ..., bgColor: "#ea580c", fgColor: "#ffffff" }] : []}
>
```

This exposed two latent issues in `components/popup.tsx`, both fixed as part of this phase (not scope creep — the component broke under a use case this phase introduced):

1. **`buttons={[]}` crashed.** The footer always rendered `footerButtons[0]` unconditionally; an empty array made that `undefined`, throwing on `.onClick`/`.label` access. Fixed by wrapping the whole footer block in `{footerButtons.length > 0 && (...)}`.
2. **A single button rendered left-aligned**, because the layout hard-codes slot 0 as "left" and everything after as "right" — correct for the two-button Cancel/Confirm case this component was originally built for, wrong for a lone action button (Download reads as a primary action, belongs right-aligned like Confirm does). Fixed with a length check: `footerButtons.length > 1` decides whether slot 0 renders on the left at all, and the right-hand wrapper (plus the button itself) gets `w-full` when there's exactly one button, so it also stretches full-width instead of shrink-wrapping.

Button color went through several rounds of live back-and-forth (default popup black → blue → purple → amber "happy" tone → reverted to plain dark → settled on a saturated orange `#ea580c` with white text) — no technical reasoning behind the final color beyond visual preference; documented here only so the value isn't mysterious later.

## Responsive sizing

QR `<img>` uses `aspect-square w-full max-w-sm` instead of a fixed pixel size (`h-56 w-56` initially) — scales with the popup's own width (full-bleed on mobile, capped at `max-w-md` card on desktop per `Popup`'s existing responsive behavior) rather than staying a fixed small square regardless of viewport.

## Explicitly not done in this phase

- Dark-mode inversion of the QR image was tried (`dark:invert` on the `<img>`) and then explicitly reverted — QR codes stay black-on-white in both themes.
- No icon on the Download button — `PopupButton`'s type has no icon slot; adding one was judged out of scope for what was asked.
- Nothing about *scanning* a QR (camera access, payload parsing) — that's Phase 2.
- No server endpoint to fetch a user's `mlKemPublicKey` by `id` yet — needed by Phase 2 to verify the fingerprint, doesn't exist today (`GET /users?q=` was removed entirely in [[encryption-at-rest]] Phase 3, and there is no `GET /users/:id` replacement).

## Verification

1. Open `/chat`, click the QR header button — popup opens, shows a loading placeholder, then a QR image.
2. Scan the generated QR with a phone camera/QR reader app and confirm it decodes to valid JSON with `id`, `username`, `keyFingerprint` fields (not garbled/unreadable — this was the original bug being fixed).
3. Click Download — a `{username}-qr-code.png` file saves with the correct image.
4. Resize the browser across the mobile/desktop breakpoint with the popup open — QR resizes with the popup rather than staying a fixed size.
5. `bunx tsc --noEmit` clean in `client/`.
