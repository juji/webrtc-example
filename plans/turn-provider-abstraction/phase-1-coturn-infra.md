# Phase 1 — Infra: coturn in docker-compose

## File

`docker-compose.yml`

## Service definition

```yaml
services:
  coturn:
    image: coturn/coturn
    restart: unless-stopped
    network_mode: host
    command:
      - -n
      - --log-file=stdout
      - --listening-port=3478
      - --min-port=49160
      - --max-port=49200
      - --use-auth-secret
      - --static-auth-secret=${COTURN_SECRET}
      - --realm=webrtc.local
```

`COTURN_SECRET` is read from the shell environment at `docker compose up` time (same pattern as any compose var substitution) — the actual value lives in `server/.env`, and gets exported before `docker compose up` runs, matching how this project already starts things (`bun run dev`'s `docker compose up -d` step).

## Why `network_mode: host`, not port mapping

A TURN relay allocates a UDP port per active session, out of `min-port`–`max-port` (here `49160`–`49200`, a small range for local dev — real deployments use thousands of ports). Docker's normal port-mapping (`ports: ["3478:3478"]`) only maps the ports you explicitly list — mapping an entire relay range one-by-one is impractical, and more importantly, coturn needs to know the address it should advertise back to clients as reachable, which has to match what's actually bound on the host. `network_mode: host` sidesteps both problems: coturn binds directly to the host's network stack, so `min-port`–`max-port` are actually reachable, and the address it advertises is genuinely the host's own address — no NAT-inside-Docker mismatch.

This only works for LAN/localhost testing (per checklist.md) — `network_mode: host` gives coturn the *host machine's* address, not a real public IP. Real internet-facing use needs a host that itself has a public IP (a VPS, cloud instance, etc.) — out of scope here.

## Why `--min-port`/`--max-port` this narrow

49160–49200 is 40 ports — enough for local testing (a handful of concurrent relayed connections), not a production range. Widening this later is a one-line compose change, not a design change.

## `COTURN_SECRET`

A new env var in `server/.env`, alongside the existing `METERED_APP_NAME`/`METERED_API_KEY` etc. Any random string works — it's a shared HMAC key between coturn (`--static-auth-secret`) and the server's credential-generation code (Phase 2), never exposed to the client. Generate with `openssl rand -hex 32` or similar; no format requirement beyond "long and random."

## Verification

```bash
docker compose up -d coturn
docker compose logs coturn
```

Confirm the log shows coturn started listening on `3478` with no config errors, then confirm a relay allocation actually works:

```bash
# From turn-cf/, using the same allocate-and-check-for-relay-candidate approach
# as test-turn.mjs, but pointed at the local coturn instance with HMAC-derived
# credentials (Phase 2 provides the credential-generation code this needs).
```

The full relay-candidate check (a real `RTCPeerConnection` actually gathering a `relay` candidate through this coturn instance) happens in Phase 3, once Phase 2's credential endpoint exists to generate valid HMAC credentials for the test to use — Phase 1's own verification is just "coturn is up and listening," not "TURN actually works end-to-end."
