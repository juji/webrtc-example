#!/usr/bin/env bash
set -euo pipefail

docker compose up -d
trap 'docker compose down' EXIT

until docker compose exec -T postgres pg_isready -U webrtc >/dev/null 2>&1; do
  echo "waiting for postgres.."
  sleep 0.5
done

until curl -sf -o /dev/null --max-time 1 http://localhost:9000 || [ "$?" = 22 ]; do
  echo "waiting for rustfs.."
  sleep 0.5
done

bun run --cwd server db:push

bun run --filter '*' dev
