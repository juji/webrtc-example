## Attachment upload validation

### Why this path exists at all

File sends normally go P2P over the WebRTC data channel (`useWebRtcChat.sendFile`, chunked binary transfer, no server involvement). The presign/upload/confirm flow (`sendFailoverFile`, `client/lib/api.ts:200`) is the fallback used specifically when P2P isn't available — e.g. the peer is offline — so the file has to be relayed through server-side object storage (RustFS) instead of sent directly. This validation phase is about that fallback path, since it's the one that ever lets a file touch server-controlled storage at all.

### The gap

Today `POST /attachment/presign` (`server/src/routes/messages.ts:119`) validates only that `clientId`/`fromUsername`/`toUsername`/`fileName`/`fileType` are present, non-empty strings — no extension check, no mime-type check, no size limit, and the raw `fileName` is embedded unsanitized into the storage key (`${clientId}-${fileName}`, line 140). This phase adds extension allow/block-listing; size limits and filename sanitization are out of scope here (not asked for), worth their own note if they come up.

### Env vars

- `ATTACHMENT_WHITELIST_EXTENSIONS` — comma-separated list, e.g. `pdf,png,jpg,jpeg,gif,mp4,mov,zip`. When set (non-empty), **only** these extensions are allowed — the blacklist is not consulted at all.
- `ATTACHMENT_BLACKLIST_EXTENSIONS` — comma-separated list. Used only when the whitelist is unset/empty. Defaults to known executable/script extensions if the env var itself is unset (see below) — an operator can override the default by setting the var, including setting it to an empty string to disable blocking entirely.
- Matching is case-insensitive, matched against the file's extension (text after the last `.` in `fileName`), not its declared `fileType`/mime — mime is client-declared and not trustworthy, the extension is the only thing actually visible in the stored `fileName`.
- No `server/src/env.ts` exists in this codebase — every other env var is read inline via `process.env.X` at point of use (see `server/src/storage.ts`'s `RUSTFS_*` vars). Match that: read both vars inline in `messages.ts`, no new central config file.

### Default blacklist (used when `ATTACHMENT_BLACKLIST_EXTENSIONS` is unset and no whitelist is set)

```
exe, msi, bat, cmd, com, scr, pif, vbs, vbe, js, jse, wsf, wsh, ps1, ps1xml, psc1,
sh, bash, zsh, csh, ksh, run,
app, apk, ipa, dmg, pkg,
dll, so, dylib, sys, drv,
jar, deb, rpm
```
One flat comma-separated default string in code, e.g.:
```ts
const DEFAULT_BLACKLIST = "exe,msi,bat,cmd,com,scr,pif,vbs,vbe,js,jse,wsf,wsh,ps1,ps1xml,psc1,sh,bash,zsh,csh,ksh,run,app,apk,ipa,dmg,pkg,dll,so,dylib,sys,drv,jar,deb,rpm";
```

### Server-side enforcement (the real trust boundary)

In `POST /attachment/presign`, before generating the presigned PUT URL: extract the extension from `fileName`, check it against whitelist-if-set-else-blacklist, reject with 400 if disallowed. This is what actually matters — the client is untrusted, and the presign step is the last point before a file lands in storage.

### Client-side check (fail-fast UX only, not a security boundary)

In `ChatPane`'s file picker (see [[phase-5-attachment-picker-mockup]] — the picker itself doesn't exist yet, this hooks into it once built): same extension check, run against the same two env vars exposed to the client (`NEXT_PUBLIC_`-prefixed, matching this codebase's existing pattern for client-visible server config — see `NEXT_PUBLIC_SERVER_URL` in `client/lib/api.ts`). Rejects obviously-disallowed files before the presign round-trip; the server check is what's actually relied on, this is purely to avoid a wasted request/wait for something that'll be rejected anyway.
