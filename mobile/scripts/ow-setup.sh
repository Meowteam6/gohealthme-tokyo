#!/usr/bin/env bash
# One-time setup for the Apple Health path. Runs on a machine that can reach
# the Open Wearables instance; prints the server-side env block the GoHealthMe
# web app needs. Nothing here ever runs on a phone.
#
# What it creates, using only routes that exist in open-wearables:
#   1. developer login          POST /api/v1/auth/login  (form, ADMIN_EMAIL/PASSWORD)
#   2. developer API key        POST /api/v1/developer/api-keys
#   3. application credentials  POST /api/v1/applications  (secret shown once)
#
# It does NOT create users or mint SDK tokens any more. The web app does that
# per wallet at POST /api/wearable/mobile-token, which is what makes the app
# work for anyone rather than one hard-coded person.
#
# Usage:
#   OW_HOST=http://localhost:8010 scripts/ow-setup.sh
# Reads ADMIN_EMAIL / ADMIN_PASSWORD from the instance's own config unless
# OW_ADMIN_EMAIL / OW_ADMIN_PASSWORD are set.

set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
ow_env="$here/../../open-wearables/backend/config/.env"

OW_HOST="${OW_HOST:-http://localhost:8010}"

if [[ -z "${OW_ADMIN_EMAIL:-}" || -z "${OW_ADMIN_PASSWORD:-}" ]]; then
  [[ -f "$ow_env" ]] || {
    echo "no $ow_env and OW_ADMIN_EMAIL/OW_ADMIN_PASSWORD unset" >&2
    exit 1
  }
  OW_ADMIN_EMAIL="$(grep -E '^ADMIN_EMAIL=' "$ow_env" | cut -d= -f2- | tr -d '"')"
  OW_ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' "$ow_env" | cut -d= -f2- | tr -d '"')"
fi

need() { command -v "$1" >/dev/null || { echo "missing $1" >&2; exit 1; }; }
need curl; need jq

api="$OW_HOST/api/v1"

dev_token="$(curl -sf -X POST "$api/auth/login" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "username=$OW_ADMIN_EMAIL" \
  --data-urlencode "password=$OW_ADMIN_PASSWORD" | jq -r .access_token)"
[[ -n "$dev_token" && "$dev_token" != null ]] || { echo "login failed" >&2; exit 1; }
echo "1/3 developer login ok" >&2

api_key="$(curl -sf -X POST "$api/developer/api-keys" \
  -H "authorization: Bearer $dev_token" -H 'content-type: application/json' \
  -d '{"name":"gohealthme-web"}' | jq -r '.id // .key // .api_key')"
[[ -n "$api_key" && "$api_key" != null ]] || { echo "api key create failed" >&2; exit 1; }
echo "2/3 api key ok" >&2

app_json="$(curl -sf -X POST "$api/applications" \
  -H "authorization: Bearer $dev_token" -H 'content-type: application/json' \
  -d '{"name":"gohealthme-ios"}')"
app_id="$(jq -r .app_id <<<"$app_json")"
app_secret="$(jq -r .app_secret <<<"$app_json")"
[[ -n "$app_id" && "$app_id" != null ]] || { echo "application create failed" >&2; exit 1; }
echo "3/3 application credentials ok" >&2

echo >&2
echo "Paste this into the GoHealthMe web app's environment (server-only, never NEXT_PUBLIC):" >&2
echo >&2
cat <<EOF
OPEN_WEARABLES_BASE_URL=$OW_HOST
OPEN_WEARABLES_API_KEY=$api_key
OPEN_WEARABLES_APP_ID=$app_id
OPEN_WEARABLES_APP_SECRET=$app_secret
EOF
echo >&2
echo "The app_secret is shown once and cannot be retrieved again." >&2
