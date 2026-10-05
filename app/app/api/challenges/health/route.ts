// GET /api/challenges/health - can this deployment make a dare link?
//
// The dare form moves the reward on chain FIRST and writes the challenge row
// (the link) second. If the row cannot be written, the challenger has paid for
// a pool nobody can open. This preflight runs before the deposit and refuses
// when the challenges store is not configured, not reachable, or not migrated
// (no contract_address column), so an unready build stops the dare before any
// USDC moves.
//
// No auth: the answer is a yes or no about this deployment, not about anyone.
// The reason code is logged, never returned; players get plain copy.
//
// NEW MONEY PAUSED (KILL_BASE_MONEY_IN, Andre, 2026-09-30). A new challenge is
// new money, so a paused build refuses here, before the store is read and
// before any deposit, with the paused copy and the operator's reason.
//
// Response JSON: { ok: true }, or 503 { ok: false, error } (paused: true
// when new money is switched off).

import {
  CHALLENGES_UNAVAILABLE_MESSAGE,
  checkChallengesHealth,
} from "@/lib/server/challenges";
import { newCorrelationId, safeError } from "@/lib/server/http";
import { killSwitches } from "@/lib/server/kill-switches";
import { challengeCreatePausedDetail } from "@/lib/switches";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  const cid = newCorrelationId("challenges-health");
  try {
    const switches = killSwitches();
    if (switches.baseMoneyIn) {
      return Response.json(
        { ok: false, paused: true, error: challengeCreatePausedDetail(switches.reason, "was") },
        { status: 503, headers: NO_STORE },
      );
    }
    const health = await checkChallengesHealth();
    if (health.ok) {
      return Response.json({ ok: true }, { headers: NO_STORE });
    }
    console.warn(`[${cid}] dares unavailable: ${health.code}`);
    return Response.json(
      { ok: false, error: CHALLENGES_UNAVAILABLE_MESSAGE },
      { status: 503, headers: NO_STORE },
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: safeError(err, cid) },
      { status: 503, headers: NO_STORE },
    );
  }
}
