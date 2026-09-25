// Read-only check of the settlement gate SPOTTER will apply to a pool.
//
// Run from app/ (loads repo-root .env then app/.env.local):
//   npm run agent:verdict-gate
//
// Reads HealthPools.healthVerdict() through the same code path the settle
// preflight, the attester-role check and recordVerdict use
// (lib/server/verdict.ts poolVerdictRegistry), and prints which gate is
// selected. Sends no transaction and needs no signer. Exit code 0 either way;
// non-zero only when the read itself fails.

import { poolVerdictRegistry } from "../lib/server/verdict";
import { requireEnv } from "../lib/server/env";

async function main(): Promise<void> {
  const pools = requireEnv("HEALTH_POOLS_ADDRESS");
  const registry = await poolVerdictRegistry(pools as `0x${string}`);

  console.log(`pool:      ${pools}`);
  if (registry === null) {
    console.log("registry:  0x0 (none latched on the pool)");
    console.log(
      "gate:      oracle-only - settle pays on recordResult(verdict=true) alone; " +
        "no canSettle read, no attester-role read, no recordVerdict write",
    );
  } else {
    console.log(`registry:  ${registry}`);
    console.log(
      "gate:      registry - settle also requires canSettle(goalId) on that " +
        "registry; recordVerdict is written there",
    );
  }
  const configured = process.env.HEALTH_VERDICT_ADDRESS?.trim() ?? "";
  console.log(
    `env:       HEALTH_VERDICT_ADDRESS ${configured === "" ? "unset (not required)" : `${configured} (ignored; the chain wins)`}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
