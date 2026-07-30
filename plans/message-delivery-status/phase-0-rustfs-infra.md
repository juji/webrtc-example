# Phase 0 — Infra: RustFS in docker-compose

## File

`docker-compose.yml`

## Service definition (verified working)

```yaml
services:
  rustfs:
    image: rustfs/rustfs
    restart: unless-stopped
    environment:
      RUSTFS_ACCESS_KEY: webrtc
      RUSTFS_SECRET_KEY: webrtcsecret
      RUSTFS_CORS_ALLOWED_ORIGINS: http://localhost:3000,https://webrtc-client.jujitest.com
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - rustfs-data:/data

volumes:
  rustfs-data:
```

Port 9000 is the S3 API (what the presigned URLs point at), port 9001 is RustFS's web console (not required for this app to function, but harmless to expose for manual inspection during development).

## Why these specific env vars

- `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY` — override the default `rustfsadmin`/`rustfsadmin` credentials. RustFS logs a warning if left at the default; explicit values avoid that and match this project's existing pattern of explicit, simple dev credentials (see `postgres`'s `POSTGRES_USER`/`POSTGRES_PASSWORD` in the same file).
- `RUSTFS_CORS_ALLOWED_ORIGINS` — **required** for Phase 3's direct-from-browser upload to work at all. Without it, RustFS's default CORS behavior (as of versions before `1.0.0-beta.2`) reflected any origin with credentials enabled — a real security advisory ([GHSA-x5xv-223c-8vm7](https://github.com/rustfs/rustfs/security/advisories/GHSA-x5xv-223c-8vm7)), fixed in `beta.2`+. The image pulled during verification was `1.0.0-beta.8` (already patched), but explicit origins are still the correct, minimal-trust configuration rather than relying on default/reflective behavior. List both the local dev origin and the tunneled production-ish origin, comma-separated (verified this format works — see "Verification" below).

## Why RustFS instead of writing to the Hono server's disk

The server process itself has no durable, network-attached storage of its own worth relying on for this — and more importantly, Phase 3's design requires the client to upload directly to the storage layer (not proxy bytes through Hono), which only makes sense against something that speaks a real client-facing upload protocol (S3-style presigned URLs). RustFS is a lightweight, Rust-native, S3-API-compatible object store that runs as a single Docker container, fitting this project's existing "everything runs via `docker compose` + `bun run dev`" setup without adding a hosted/paid dependency.

## Known limitation: presigned POST is broken, use PUT

RustFS's presigned **POST** operation (the mechanism typically used for form-based uploads with server-defined restrictions like max size or content-type, via a policy document) has an open, unresolved bug as of the version tested: attempting it returns `MalformedPOSTRequest`, and the same request works fine against real AWS S3 or MinIO — this is a RustFS-specific incompatibility ([rustfs/rustfs#608](https://github.com/rustfs/rustfs/issues/608)).

Phase 3 uses presigned **PUT** instead: a plain signed URL the client sends the raw file body to via `fetch(url, { method: 'PUT', body: file })`. This was verified working end-to-end (bucket creation, presigned PUT generation via `@aws-sdk/s3-request-presigner`, successful PUT, successful presigned GET readback of the exact bytes) against a locally running RustFS `1.0.0-beta.8` container before this plan was written. Presigned PUT is also simpler than presigned POST (no policy-document/form-field construction needed), which fits this project's "keep it minimal" convention.

## Verification

```bash
docker compose up -d rustfs

# Confirm CORS reflects only the configured origins, not any origin:
curl -s -X OPTIONS "http://localhost:9000/attachments/test.txt" \
  -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: PUT" \
  -D - -o /dev/null | grep -i access-control-allow-origin
# → access-control-allow-origin: http://localhost:3000

curl -s -X OPTIONS "http://localhost:9000/attachments/test.txt" \
  -H "Origin: http://evil.example.com" -H "Access-Control-Request-Method: PUT" \
  -D - -o /dev/null | grep -i access-control-allow-origin
# → (nothing — origin not reflected, browser will block the actual request)
```

The `attachments` bucket referenced above doesn't need to exist yet for this OPTIONS/CORS check to succeed — bucket creation (and the public-read policy attachments need) happens on server startup in Phase 3, via `ensureAttachmentsBucket()` in `server/src/index.ts`.
