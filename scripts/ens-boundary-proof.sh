#!/usr/bin/env bash
# Prove SPOTTER's ENSv2 permission boundary on live Sepolia (eth_call only,
# no key needed, costs nothing). Thin wrapper over app/scripts/ens-boundary-proof.ts.
set -euo pipefail
cd "$(dirname "$0")/../app"
exec npm run -s ens:proof
