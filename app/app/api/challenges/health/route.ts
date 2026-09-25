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
// Response JSON: { ok: true } or 503 { ok: false, error }.

import {
  CHALLENGES_UNAVAILABLE_MESSAGE,
  checkChallengesHealth,
} from "@/lib/server/challenges";
import { newCorrelationId, safeError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  const cid = newCorrelationId("challenges-health");
  try {
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
