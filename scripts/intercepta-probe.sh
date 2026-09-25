#!/usr/bin/env bash
# Calibrate Intercepta screening once the API key lands.
#
# Screens the wallets SPOTTER will actually pay (Andre's demo wallet, the
# SPOTTER Circle wallet) and the four OFAC SDN Lazarus Group addresses through
# the same endpoint the app calls, and prints toxicScore plus trait names.
# Use the output to confirm the clean wallets clear, the sanctioned ones
# carry sanction_address, and to decide whether INTERCEPTA_BLOCK_SCORE is
# worth setting (the docs publish no score range).
#
# Usage: INTERCEPTA_API_KEY=... scripts/intercepta-probe.sh [address ...]
# Reads app/.env.local when the variable is not exported. Never prints the key.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${INTERCEPTA_API_KEY:-}" && -f "$ROOT/app/.env.local" ]]; then
  INTERCEPTA_API_KEY="$(grep -E '^INTERCEPTA_API_KEY=' "$ROOT/app/.env.local" | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [[ -z "${INTERCEPTA_API_KEY:-}" ]]; then
  echo "INTERCEPTA_API_KEY is not set. Request one at https://intercepta.io/ethglobal" >&2
  exit 2
fi

BASE="${INTERCEPTA_BASE_URL:-https://api.web3antivirus.io}"

DEFAULT_ADDRESSES=(
  # clean, ours
  "${SPOTTER_WALLET_ADDRESS:-0x0000000000000000000000000000000000000000}"
  # OFAC SDN, Lazarus Group (DPRK), Ronin bridge, listed 2022-04-14 / 2022-04-22
  0x098B716B8Aaf21512996dC57EB0615e2383E2f96
  0xa0e1c89Ef1a489c9C7dE96311eD5Ce5D32c20E4B
  0x3Cffd56B47B7b41c56258D9C7731ABaDc360E073
  0x53b6936513e738f44FB50d2b9476730C0Ab3Bfc1
)

ADDRESSES=("$@")
if [[ ${#ADDRESSES[@]} -eq 0 ]]; then ADDRESSES=("${DEFAULT_ADDRESSES[@]}"); fi

for addr in "${ADDRESSES[@]}"; do
  if [[ "$addr" == "0x0000000000000000000000000000000000000000" ]]; then
    echo "skip: SPOTTER_WALLET_ADDRESS not set; pass wallets as arguments" >&2
    continue
  fi
  url="$BASE/api/public/v2/extension/account/$addr/quick-scan"
  body="$(curl -sS -m 10 -H "X-API-KEY: $INTERCEPTA_API_KEY" -H "accept: application/json" -w '\n%{http_code}' "$url")"
  code="${body##*$'\n'}"
  json="${body%$'\n'*}"
  if [[ "$code" != "200" ]]; then
    echo "$addr  HTTP $code  $json"
    continue
  fi
  if command -v jq >/dev/null 2>&1; then
    echo "$addr  $(echo "$json" | jq -c '{toxicScore, traits: [.traits[]?.name]}')"
  else
    echo "$addr  $json"
  fi
done
