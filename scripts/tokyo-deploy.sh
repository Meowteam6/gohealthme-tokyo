#!/usr/bin/env bash
#
# ETHGlobal Tokyo 2026: deploy GoHealthMe V4's own HealthPoolsV3 on Base Sepolia
# and seed the three wearable demo pools. V4 must never act on V3's frozen pools,
# so the app points at THIS contract through HEALTH_POOLS_ADDRESS.
#
# Idempotent:
#   - the deploy is skipped when TOKYO_POOLS names an already deployed V4 contract
#   - each pool is seeded only if no pool with the same initiative exists on it
#   - a pool whose periodEnd has already passed is skipped with a warning
#
# Uses forge create + cast send, not forge script: broadcast directly, no local
# simulation surprises (same reason as demo-reset.sh). Every address and tx hash
# is appended to DEPLOYMENTS.md under the Tokyo 2026 heading.
#
# Usage (from repo root):
#   ./scripts/tokyo-deploy.sh                          # deploy + seed
#   TOKYO_POOLS=0x.. ./scripts/tokyo-deploy.sh         # seed missing pools into an existing V4 contract
#   DRY_RUN=1 ./scripts/tokyo-deploy.sh                # print the plan, send nothing
#   POOL1_END=<unix> POOL2_END=<unix> POOL3_END=<unix>  # move the windows (unix seconds, UTC)
#   POOL_ENTRY=1000000 POOL_FUNDING=2000000            # micro-USDC: entry per joiner, sponsor pot per pool
#   BASESCAN_API_KEY=..                                # optional: verify on Basescan; Sourcify is tried anyway
#
# Reads PRIVATE_KEY (deployer = owner) from contracts/.env. ORACLE_ADDRESS and
# SETTLER_ADDRESS default to the values verified on the V3 contract ON CHAIN
# (DEPLOYMENTS.md's V3 heading lists stale ones; chain wins).
#
# Requires: foundry on PATH, deployer funded with Base Sepolia ETH and USDC.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$PATH:$HOME/.foundry/bin"

# Rehearsal seams (see the anvil dry run in DEPLOYMENTS.md): ENV_FILE points at
# a throwaway key file, DEPLOYMENTS_FILE at a scratch copy, SKIP_VERIFY=1 skips
# the explorer step. Production runs leave all three unset.
ENV_FILE="${ENV_FILE:-contracts/.env}"
DEPLOYMENTS_FILE="${DEPLOYMENTS_FILE:-DEPLOYMENTS.md}"
SKIP_VERIFY="${SKIP_VERIFY:-0}"

[ -f "$ENV_FILE" ] || { echo "error: $ENV_FILE not found" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a
: "${PRIVATE_KEY:?PRIVATE_KEY missing in $ENV_FILE}"

RPC="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
CHAIN_ID=84532
USDC="${USDC_ADDRESS:-0x036CbD53842c5426634e7929541eC2318f3dCF7e}"
V3_FROZEN=0x66815e3AC541eB18d01D2aed25D0D9779583D832
# Oracle: the key app/.env.local ORACLE_SIGNER_PRIVATE_KEY signs with (verified
# on the V3 contract: oracle() == this address).
ORACLE="${ORACLE_ADDRESS:-0xA56eAD3A32b6261bDE6C2A45495C9250084F7F2D}"
# Settler: SPOTTER's Circle developer-controlled EOA on Base Sepolia (verified on
# the V3 contract: authorizedSettler() == this address; it is the wallet behind
# CIRCLE_WALLET_ID and has been paying gas for V3 settles).
SETTLER="${SETTLER_ADDRESS:-0x5BECa2BCe03ef2D8d91091744b2CfD6d1A5cd483}"

POOL_ENTRY="${POOL_ENTRY:-1000000}"       # 1 USDC stake per joiner
POOL_FUNDING="${POOL_FUNDING:-2000000}"   # 2 USDC sponsor pot per pool, from the deployer
KEEP_MIN="${KEEP_MIN:-15000000}"          # never spend the deployer below 15 USDC

# Demo windows (JST = UTC+9). Settle is settler-only for 24h after periodEnd,
# then permissionless, so each of these can be settled by SPOTTER minutes after
# it ends: pool 1 Saturday evening, pools 2 and 3 Sunday morning around the
# 09:00 JST submission deadline and the judging that follows.
POOL1_END="${POOL1_END:-1790465400}"   # Sun 2026-09-27 08:30 JST (Sat 23:30 UTC); the first sleep run ended 19:00 Sat, before any night, and was cancelled
POOL2_END="${POOL2_END:-1790463600}"   # Sun 2026-09-27 08:00 JST (Sat 23:00 UTC)
POOL3_END="${POOL3_END:-1790472600}"   # Sun 2026-09-27 10:30 JST (01:30 UTC)
POOL4_END="${POOL4_END:-1790478000}"   # Sun 2026-09-27 12:00 JST (03:00 UTC); the first run created after MISS_RULE_FROM_POOL_ID, so a wearable-shown miss forfeits

# initiative = the short title the pool list shows; goalSpec = the text
# app/lib/wearable-goal.ts classifies. No proof marker means wearable floor.
# "for 1 night" / "for 1 day" sets goalDays = 1 so a one-day window can pay.
POOL1_INIT="Sleep 7 hours Saturday night";  POOL1_GOAL="Sleep at least 7 hours for 1 night"     # sleep_hours 7 (replaced "Sleep 7 hours tonight", cancelled 2026-09-26: its window held no night)
POOL2_INIT="One workout today";      POOL2_GOAL="Complete at least 1 workout for 1 day"  # workouts 1
POOL3_INIT="Sleep efficiency 85 tonight"; POOL3_GOAL="Sleep efficiency 85% or better for 1 night"
POOL4_INIT="One workout Sunday";      POOL4_GOAL="Complete at least 1 workout for 1 day"  # workouts 1, the judged commitment-model run (pool 6)  # sleep_efficiency 85 (replaced the steps run, cancelled 2026-09-26: steps is not a launch goal)

DRY_RUN="${DRY_RUN:-0}"

fmt_jst() {
  # macOS date -r, GNU date -d
  TZ=Asia/Tokyo date -r "$1" '+%a %Y-%m-%d %H:%M JST' 2>/dev/null \
    || TZ=Asia/Tokyo date -d "@$1" '+%a %Y-%m-%d %H:%M JST'
}

tx_hash() {
  # cast send --json prints a receipt object; pull transactionHash without jq.
  sed -n 's/.*"transactionHash":"\(0x[0-9a-fA-F]*\)".*/\1/p' | head -1
}

# sepolia.base.org is load-balanced: a nonce read right after a mined tx can hit
# a lagging node and return the old nonce ("replacement transaction
# underpriced"). Track the nonce here: start from the pending nonce, never go
# below what this run already used.
NEXT_NONCE=""
send() {
  # send <to> <sig> <args...>
  local chain_nonce
  chain_nonce="$(cast nonce "$DEPLOYER" --rpc-url "$RPC" --block pending)"
  if [ -z "$NEXT_NONCE" ] || [ "$chain_nonce" -gt "$NEXT_NONCE" ]; then
    NEXT_NONCE="$chain_nonce"
  fi
  cast send "$@" --nonce "$NEXT_NONCE" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" --json | tx_hash
  NEXT_NONCE=$((NEXT_NONCE + 1))
}

log() { echo "$*" >> "$LOG_TMP"; }

# ---------------------------------------------------------------- preflight

GOT_CHAIN="$(cast chain-id --rpc-url "$RPC")"
[ "$GOT_CHAIN" = "$CHAIN_ID" ] || { echo "error: RPC is chain $GOT_CHAIN, not Base Sepolia ($CHAIN_ID)" >&2; exit 1; }

DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
[ "$(lc "$ORACLE")" != "$(lc "$DEPLOYER")" ] || { echo "error: oracle must differ from deployer (C-2)" >&2; exit 1; }
[ "$(lc "$SETTLER")" != "$(lc "$DEPLOYER")" ] || { echo "error: settler must differ from deployer (C-2)" >&2; exit 1; }
[ "$(lc "$ORACLE")" != "$(lc "$SETTLER")" ] || { echo "error: oracle must differ from settler (C-2)" >&2; exit 1; }

if [ -n "${TOKYO_POOLS:-}" ] && [ "$(lc "$TOKYO_POOLS")" = "$(lc "$V3_FROZEN")" ]; then
  echo "error: TOKYO_POOLS is the frozen V3 contract; V4 never seeds into it" >&2; exit 1
fi

NOW="$(date +%s)"
ETH_BAL="$(cast balance "$DEPLOYER" --rpc-url "$RPC" --ether)"
USDC_BAL="$(cast call "$USDC" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC")"; USDC_BAL="${USDC_BAL%% *}"

echo "== Tokyo 2026 deploy (Base Sepolia $CHAIN_ID) =="
echo "deployer  $DEPLOYER  ($ETH_BAL ETH, $USDC_BAL uUSDC)"
echo "oracle    $ORACLE"
echo "settler   $SETTLER"
echo "usdc      $USDC"
echo "now       $NOW  $(fmt_jst "$NOW")"
for i in 1 2 3 4; do
  init_var="POOL${i}_INIT"; goal_var="POOL${i}_GOAL"; end_var="POOL${i}_END"
  echo "pool $i    ${!init_var} | ${!goal_var} | entry $POOL_ENTRY | pot $POOL_FUNDING | ends ${!end_var} $(fmt_jst "${!end_var}")"
done

if [ "$DRY_RUN" = "1" ]; then echo "DRY_RUN=1: nothing sent"; exit 0; fi

LOG_TMP="$(mktemp)"
trap 'rm -f "$LOG_TMP"' EXIT
STAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ------------------------------------------------------------------ deploy

if [ -n "${TOKYO_POOLS:-}" ]; then
  POOLS="$TOKYO_POOLS"
  CODE="$(cast code "$POOLS" --rpc-url "$RPC")"
  [ "$CODE" != "0x" ] || { echo "error: no code at TOKYO_POOLS=$POOLS" >&2; exit 1; }
  echo "==> Reusing HealthPoolsV3 $POOLS"
  log "- $STAMP reuse: HealthPoolsV3 \`$POOLS\` (seed-only run)"
else
  echo "==> forge create HealthPoolsV3 (oracle-only, rake 0, gate off)"
  OUT="$( ( cd contracts && forge create src/HealthPoolsV3.sol:HealthPoolsV3 \
    --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --broadcast \
    --constructor-args "$USDC" "$ORACLE" "$SETTLER" 0x0000000000000000000000000000000000000000 ) )"
  POOLS="$(printf '%s\n' "$OUT" | awk '/Deployed to:/ {print $3}')"
  DEPLOY_TX="$(printf '%s\n' "$OUT" | awk '/Transaction hash:/ {print $3}')"
  [ -n "$POOLS" ] || { echo "error: deploy failed (no address)"; printf '%s\n' "$OUT" >&2; exit 1; }
  echo "    deployed at $POOLS  tx $DEPLOY_TX"
  log "- $STAMP deploy: HealthPoolsV3 \`$POOLS\`"
  log "  - explorer https://sepolia.basescan.org/address/$POOLS"
  log "  - deploy tx https://sepolia.basescan.org/tx/$DEPLOY_TX"
  log "  - constructor: usdc \`$USDC\`, oracle \`$ORACLE\`, settler \`$SETTLER\`, verdict \`0x0\` (oracle-only)"
fi

# Post-deploy assertions read back from chain, never trusted from the args.
chk() { local got; got="$(cast call "$POOLS" "$1" --rpc-url "$RPC")"; got="${got%% *}"; [ "$(lc "$got")" = "$(lc "$2")" ] || { echo "error: $1 = $got, expected $2" >&2; exit 1; }; }
chk "owner()(address)" "$DEPLOYER"
chk "oracle()(address)" "$ORACLE"
chk "authorizedSettler()(address)" "$SETTLER"
chk "healthVerdict()(address)" "0x0000000000000000000000000000000000000000"
chk "commitmentFeeBps()(uint16)" "0"
chk "joinGateEnabled()(bool)" "false"
echo "    roles verified on chain: owner=deployer, oracle, settler, verdict 0x0, rake 0, gate off"

# ------------------------------------------------------------- verification

if [ "$SKIP_VERIFY" != "1" ] && [ -z "${TOKYO_POOLS:-}" ]; then
  CTOR_ARGS="$(cast abi-encode "constructor(address,address,address,address)" "$USDC" "$ORACLE" "$SETTLER" 0x0000000000000000000000000000000000000000)"
  if [ -n "${BASESCAN_API_KEY:-}" ]; then
    echo "==> Verifying on Basescan"
    ( cd contracts && forge verify-contract --chain "$CHAIN_ID" --etherscan-api-key "$BASESCAN_API_KEY" \
        --constructor-args "$CTOR_ARGS" --watch "$POOLS" src/HealthPoolsV3.sol:HealthPoolsV3 ) \
      && log "  - verified on Basescan" || echo "    (Basescan verification failed; source is in the repo)"
  else
    echo "==> No BASESCAN_API_KEY; trying Sourcify (keyless)"
    ( cd contracts && forge verify-contract --chain "$CHAIN_ID" --verifier sourcify \
        --constructor-args "$CTOR_ARGS" "$POOLS" src/HealthPoolsV3.sol:HealthPoolsV3 ) \
      && log "  - verified on Sourcify (https://repo.sourcify.dev/contracts/full_match/$CHAIN_ID/$POOLS/)" \
      || echo "    (Sourcify verification failed; set BASESCAN_API_KEY and rerun with TOKYO_POOLS=$POOLS to retry)"
  fi
fi

# --------------------------------------------------------------------- seed

pool_exists() {
  # true when a pool with this initiative already exists on $POOLS
  local count i out
  count="$(cast call "$POOLS" "poolCount()(uint256)" --rpc-url "$RPC")"; count="${count%% *}"
  for ((i = 1; i <= count; i++)); do
    out="$(cast call "$POOLS" "getPool(uint256)((address,uint8,bool,bool,uint64,uint64,uint256,uint256,string,string))" "$i" --rpc-url "$RPC")"
    if printf '%s' "$out" | grep -F -q "\"$1\""; then echo "$i"; return 0; fi
  done
  return 1
}

TO_SEED=()
for i in 1 2 3 4; do
  init_var="POOL${i}_INIT"; end_var="POOL${i}_END"
  if existing="$(pool_exists "${!init_var}")"; then
    echo "==> pool $i already seeded as poolId $existing (${!init_var}); skipping"
    continue
  fi
  if [ "${!end_var}" -le $((NOW + 300)) ]; then
    echo "==> pool $i (${!init_var}) ends ${!end_var} $(fmt_jst "${!end_var}"), already past or under 5 min away; skipping. Override POOL${i}_END." >&2
    continue
  fi
  TO_SEED+=("$i")
done

if [ "${#TO_SEED[@]}" -eq 0 ]; then
  echo "==> nothing to seed"
else
  TOTAL=$((POOL_FUNDING * ${#TO_SEED[@]}))
  if [ "$USDC_BAL" -lt $((TOTAL + KEEP_MIN)) ]; then
    echo "error: deployer USDC $USDC_BAL < funding $TOTAL + floor $KEEP_MIN. Top up: https://faucet.circle.com" >&2; exit 1
  fi
  echo "==> approve $TOTAL uUSDC to $POOLS"
  APPROVE_TX="$(send "$USDC" "approve(address,uint256)" "$POOLS" "$TOTAL")"
  echo "    tx $APPROVE_TX"

  for i in "${TO_SEED[@]}"; do
    init_var="POOL${i}_INIT"; goal_var="POOL${i}_GOAL"; end_var="POOL${i}_END"
    START="$(date +%s)"
    echo "==> createPool: ${!init_var}"
    TX="$(send "$POOLS" "createPool(string,string,uint256,uint64,uint64,uint8,uint256)" \
      "${!init_var}" "${!goal_var}" "$POOL_ENTRY" "$START" "${!end_var}" 2 "$POOL_FUNDING")"
    # The pool id comes from this transaction's own PoolCreated event (topic 1),
    # not poolCount(): the load-balanced public RPC can answer from a node that
    # has not seen the new block yet and report the previous id.
    PID="$(cast receipt "$TX" --rpc-url "$RPC" --json | python3 -c '
import json, sys
pools = sys.argv[1].lower()
for log in json.load(sys.stdin)["logs"]:
    if log["address"].lower() == pools and len(log["topics"]) >= 2:
        print(int(log["topics"][1], 16)); break
' "$POOLS")"
    [ -n "$PID" ] || { echo "error: no PoolCreated event in $TX" >&2; exit 1; }
    echo "    poolId $PID  tx $TX  start $START  end ${!end_var} $(fmt_jst "${!end_var}")"
    log "- $STAMP pool $PID: **${!init_var}** | goalSpec \"${!goal_var}\" | model 2 (commitment) | entry $POOL_ENTRY uUSDC | sponsor pot $POOL_FUNDING uUSDC"
    log "  - periodStart $START ($(fmt_jst "$START")), periodEnd ${!end_var} ($(fmt_jst "${!end_var}")); settler-only until $((${!end_var} + 86400)) ($(fmt_jst $((${!end_var} + 86400)))), then anyone"
    log "  - create tx https://sepolia.basescan.org/tx/$TX"
  done
fi

# ---------------------------------------------------------------- record

MARK="<!-- tokyo-deploy-log -->"
if grep -q -F "$MARK" "$DEPLOYMENTS_FILE"; then
  # Insert this run's lines right after the marker so the newest run reads first.
  awk -v mark="$MARK" -v logfile="$LOG_TMP" '
    { print }
    $0 == mark { while ((getline line < logfile) > 0) print line; close(logfile) }
  ' "$DEPLOYMENTS_FILE" > "$DEPLOYMENTS_FILE.tmp" && mv "$DEPLOYMENTS_FILE.tmp" "$DEPLOYMENTS_FILE"
  echo "==> $DEPLOYMENTS_FILE updated under the Tokyo 2026 heading"
else
  echo "warning: marker $MARK not found in $DEPLOYMENTS_FILE; log follows" >&2
  cat "$LOG_TMP"
fi

cat <<EOF

== Done ==
HealthPoolsV3 (V4, Tokyo): $POOLS
App env to switch (app/.env.local and the gohealthme-tokyo Vercel project):
  HEALTH_POOLS_ADDRESS=$POOLS
  NEXT_PUBLIC_HEALTH_POOLS_ADDRESS=$POOLS
State: TOKYO_POOLS=$POOLS ./scripts/tokyo-status.sh
EOF
