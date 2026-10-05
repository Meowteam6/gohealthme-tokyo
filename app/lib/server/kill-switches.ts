// Pre-launch kill switches (Andre, 2026-09-30). SERVER ONLY: read from plain
// server env on every call, never from a NEXT_PUBLIC_ variable, so the browser
// learns them only through GET /api/switches and a deployment cannot bake a
// stale answer into its bundle.
//
//   KILL_WORLD_ID=1        World ID is off: worldSetup() reports off (paused),
//                          so verify refuses new proofs, rp-context is off and
//                          the lobby shows the list path; the World ID payout
//                          confirmation resolves to off, so SPOTTER pays on the
//                          verdict alone. Bindings World already made keep
//                          counting (lib/server/access.ts), so a verified
//                          player keeps their way in, their challenge pages,
//                          withdraw and refund.
//   KILL_BASE_MONEY_IN=1   New money into Base is off: new stakes, new
//                          challenges, chip-ins and the test USDC faucet.
//                          Money already in is never paused.
//   KILL_REASON=...        Optional plain-text note shown to players.
//
// "1" or "true" (any case, spaces trimmed) throws a switch; anything else
// leaves it alone, so a typo can never pause a working product. On Vercel an
// env change takes effect on the next deployment: redeploy after flipping one
// (docs/WORLD.md, "Kill switches").

import { cleanKillReason, type Switches } from "@/lib/switches";

export type { Switches };

function thrown(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function killSwitches(): Switches {
  return {
    worldId: thrown("KILL_WORLD_ID"),
    baseMoneyIn: thrown("KILL_BASE_MONEY_IN"),
    reason: cleanKillReason(process.env.KILL_REASON),
  };
}
