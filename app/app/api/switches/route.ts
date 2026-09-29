// GET /api/switches - which pre-launch kill switches are thrown on this build.
//
// Public on purpose, like /api/challenges/health: the answer is about the
// deployment, not about anyone. The join checks, the create forms and
// character creation read it so a paused step is said plainly before any
// money moves (lib/switches.ts). Never cached: a flip plus a redeploy must
// reach the next page load.
//
// Response JSON: { worldId, baseMoneyIn, reason }
//   worldId      true while World ID is switched off (KILL_WORLD_ID)
//   baseMoneyIn  true while new money into Base is switched off
//                (KILL_BASE_MONEY_IN)
//   reason       the operator's plain-text note (KILL_REASON), or null

import { killSwitches } from "@/lib/server/kill-switches";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  const { worldId, baseMoneyIn, reason } = killSwitches();
  return Response.json({ worldId, baseMoneyIn, reason }, { headers: NO_STORE });
}
