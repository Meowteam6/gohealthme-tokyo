#!/usr/bin/env bash
# Did Apple Watch data actually land in Open Wearables? Runs on the Mac.
# Reads the API key and user id written by scripts/ow-bootstrap.sh and asks
# the backend three questions, all via routes that exist in the repo:
#   recent sync events   GET /api/v1/users/{id}/sync/recent
#   daily activity       GET /api/v1/users/{id}/summaries/activity
#   daily sleep          GET /api/v1/users/{id}/summaries/sleep
# Empty answers are printed as empty. Nothing here is inferred.

set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
# Server credentials come from the same block ow-setup.sh printed.
# Export them, or drop them in a gitignored .ow-server.env beside this app.
[[ -f "$here/.ow-server.env" ]] && source "$here/.ow-server.env"
: "${OW_HOST:?set OW_HOST}" ; : "${OW_API_KEY:?set OW_API_KEY}" ; : "${OW_USER_ID:?set OW_USER_ID (from the app screen)}"
api="$OW_HOST/api/v1"
days="${1:-7}"
start="$(date -u -v-"${days}"d +%Y-%m-%dT00:00:00Z)"
end="$(date -u +%Y-%m-%dT23:59:59Z)"
hdr=(-H "X-Open-Wearables-API-Key: $OW_API_KEY")

echo "== recent sync events (newest first) for $OW_USER_ID"
curl -sf "${hdr[@]}" "$api/users/$OW_USER_ID/sync/recent?limit=10" | jq -c '.[]' || echo "(none)"

echo "== daily activity $start .. $end"
curl -sf "${hdr[@]}" "$api/users/$OW_USER_ID/summaries/activity?start_date=$start&end_date=$end" \
  | jq -c '.data[]? // .items[]? // .'

echo "== daily sleep $start .. $end"
curl -sf "${hdr[@]}" "$api/users/$OW_USER_ID/summaries/sleep?start_date=$start&end_date=$end" \
  | jq -c '.data[]? // .items[]? // .'
