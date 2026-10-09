#!/usr/bin/env bash
# API smoke test against a seeded database (pnpm db:seed aster-start|aster-demo):
# boots the real server, lists the dev personas, logs in as Maya Rao and reads GET /me.
# Usage: AUTH_MODE=dev DATABASE_URL=... bash scripts/smoke-api.sh
set -euo pipefail

PORT="${SMOKE_PORT:-4099}"
BASE="http://127.0.0.1:${PORT}/api/v1"
MAYA="a57e0003-0000-4000-8000-000000000002" # fixtures/aster people.maya
JAR="$(mktemp)"
LOG="$(mktemp)"

(cd apps/api && AUTH_MODE=dev API_PORT="$PORT" exec npx tsx src/main.ts) >"$LOG" 2>&1 &
PID=$!
cleanup() {
  kill "$PID" 2>/dev/null || true
  rm -f "$JAR"
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null || {
  cat "$LOG"
  echo "API did not start" >&2
  exit 1
}

personas=$(curl -sf "$BASE/auth/dev-personas")
echo "$personas" | grep -q '"Maya Rao"' || {
  echo "persona picker does not list Maya Rao: $personas" >&2
  exit 1
}

curl -sf -c "$JAR" -H 'content-type: application/json' -d "{\"userId\":\"$MAYA\"}" "$BASE/auth/dev-login" >/dev/null
me=$(curl -sf -b "$JAR" "$BASE/me")
echo "$me" | grep -q '"displayName":"Maya Rao"' || {
  echo "GET /me did not return Maya Rao: $me" >&2
  exit 1
}
echo "$me" | grep -q '"illustrative":true' || {
  echo "tenant is not marked illustrative" >&2
  exit 1
}
status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/me")
[ "$status" = "401" ] || {
  echo "GET /me without a session returned $status (expected 401)" >&2
  exit 1
}
echo "API smoke OK: personas, dev-login, /me (illustrative tenant), 401 without session"
