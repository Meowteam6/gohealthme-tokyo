#!/usr/bin/env bash
#
# ETHGlobal Tokyo 2026: print the state of GoHealthMe V4's HealthPoolsV3 on Base
# Sepolia with cast. Read-only; needs no key.
#
# Usage (from repo root):
#   TOKYO_POOLS=0x.. ./scripts/tokyo-status.sh
#   ./scripts/tokyo-status.sh 0x..
#
# Prints roles (owner, oracle, authorizedSettler, healthVerdict, rake, join
# gate), every pool from getPool with its participant count and settle window,
# and the USDC and ETH balances that decide whether the demo can pay.

set -euo pipefail
export PATH="$PATH:$HOME/.foundry/bin"

POOLS="${1:-${TOKYO_POOLS:-}}"
[ -n "$POOLS" ] || { echo "usage: TOKYO_POOLS=0x.. $0  (or pass the address)" >&2; exit 1; }

RPC="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
USDC="${USDC_ADDRESS:-0x036CbD53842c5426634e7929541eC2318f3dCF7e}"
V3_FROZEN=0x66815e3AC541eB18d01D2aed25D0D9779583D832

call() { local out; out="$(cast call "$POOLS" "$1" "${@:2}" --rpc-url "$RPC")"; printf '%s' "${out%% *}"; }
usdc_of() { local out; out="$(cast call "$USDC" "balanceOf(address)(uint256)" "$1" --rpc-url "$RPC")"; printf '%s' "${out%% *}"; }
fmt_jst() {
  TZ=Asia/Tokyo date -r "$1" '+%a %Y-%m-%d %H:%M JST' 2>/dev/null \
    || TZ=Asia/Tokyo date -d "@$1" '+%a %Y-%m-%d %H:%M JST'
}
usd() { printf '%d.%06d USDC' $(( $1 / 1000000 )) $(( $1 % 1000000 )); }

NOW="$(date +%s)"
CHAIN="$(cast chain-id --rpc-url "$RPC")"
if [ "$(printf '%s' "$POOLS" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$V3_FROZEN" | tr '[:upper:]' '[:lower:]')" ]; then
  echo "note: this is the FROZEN V3 pilot contract, not V4's" >&2
fi

OWNER="$(call 'owner()(address)')"
ORACLE="$(call 'oracle()(address)')"
SETTLER="$(call 'authorizedSettler()(address)')"
VERDICT="$(call 'healthVerdict()(address)')"
RAKE="$(call 'commitmentFeeBps()(uint16)')"
GATE="$(call 'joinGateEnabled()(bool)')"
COUNT="$(call 'poolCount()(uint256)')"

echo "== HealthPoolsV3 $POOLS (chain $CHAIN) =="
echo "now               $NOW  $(fmt_jst "$NOW")"
echo "owner             $OWNER"
echo "oracle            $ORACLE"
echo "authorizedSettler $SETTLER  (ETH $(cast balance "$SETTLER" --rpc-url "$RPC" --ether))"
if [ "$VERDICT" = "0x0000000000000000000000000000000000000000" ]; then
  echo "healthVerdict     0x0 (oracle-only settlement)"
else
  echo "healthVerdict     $VERDICT (verdict gate ON)"
fi
echo "commitmentFeeBps  $RAKE"
echo "joinGateEnabled   $GATE"
echo "contract USDC     $(usd "$(usdc_of "$POOLS")")"
echo "owner USDC        $(usd "$(usdc_of "$OWNER")")  ETH $(cast balance "$OWNER" --rpc-url "$RPC" --ether)"
echo "poolCount         $COUNT"
echo

for ((i = 1; i <= COUNT; i++)); do
  RAW="$(cast call "$POOLS" "getPool(uint256)((address,uint8,bool,bool,uint64,uint64,uint256,uint256,string,string))" "$i" --rpc-url "$RPC")"
  # Tuple fields: creator, bountyModel, settled, cancelled, periodStart, periodEnd, entryFee, balance, initiative, goalSpec
  BODY="${RAW#(}"; BODY="${BODY%)}"
  IFS=',' read -r CREATOR MODEL SETTLED CANCELLED START END ENTRY BAL REST <<< "$BODY"
  START="$(printf '%s' "$START" | awk '{print $1}')"
  END="$(printf '%s' "$END" | awk '{print $1}')"
  ENTRY="$(printf '%s' "$ENTRY" | awk '{print $1}')"
  BAL="$(printf '%s' "$BAL" | awk '{print $1}')"
  STRINGS="$(printf '%s' "$RAW" | grep -o '"[^"]*"' | tr '\n' ' ')"
  N="$(call 'participantCount(uint256)(uint256)' "$i")"
  if [ "$CANCELLED" = " true" ] || [ "$CANCELLED" = "true" ]; then
    STATE="cancelled"
  elif [ "$SETTLED" = " true" ] || [ "$SETTLED" = "true" ]; then
    STATE="settled"
  elif [ "$NOW" -le "$END" ]; then
    STATE="live (ends in $(( (END - NOW) / 60 )) min)"
  elif [ "$NOW" -le $((END + 86400)) ]; then
    STATE="due: settler-only for $(( (END + 86400 - NOW) / 60 )) more min"
  else
    STATE="due: anyone may settle"
  fi
  echo "pool $i  $STRINGS"
  echo "        model $(printf '%s' "$MODEL" | tr -d ' ')  entry $(usd "$ENTRY")  balance $(usd "$BAL")  participants $N  creator $(printf '%s' "$CREATOR" | tr -d ' ')"
  echo "        start $START $(fmt_jst "$START")"
  echo "        end   $END $(fmt_jst "$END")"
  echo "        state $STATE"
done
