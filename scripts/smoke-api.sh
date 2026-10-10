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
echo "$me" | grep -q "\"timeZone\":\"Europe/Berlin\"" || {
  echo "$me" >&2
  echo "GET /me did not return the tenant time zone" >&2
  exit 1
}

# Wave 3 reads the screens use first (aster-demo has ME-104; aster-start answers 404 for the case).
for path in /me/overview /people /me/scope-options; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE$path")
  [ "$code" = "200" ] || {
    echo "GET $path returned $code (expected 200)" >&2
    exit 1
  }
done
case_code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/me/cases/ME-104")
if [ "$case_code" = "200" ]; then
  for path in /me/cases/ME-104/pilot-plan /me/cases/ME-104/sizing /me/cases/ME-104/economics; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE$path")
    [ "$code" = "200" ] || {
      echo "GET $path returned $code (expected 200)" >&2
      exit 1
    }
  done
elif [ "$case_code" != "404" ]; then
  echo "GET /me/cases/ME-104 returned $case_code" >&2
  exit 1
fi
echo "API smoke OK: personas, dev-login, /me (illustrative tenant, time zone), 401 without session, overview, directory, case reads ($case_code)"
