// GET /api/agent/feed - the claims SPOTTER has touched, newest first, each
// redacted to public money facts. This endpoint is unauthenticated and the
// full ledger carries model-authored prose about medical documents, so every
// claim passes through toPublicFeedClaim before it leaves the server. Backs
// the History page (/agent). Read-only.
//
// With ?for=<address> the response also carries `mine`: that player's own
// claims from a wider window, so History can lead with them. An address is
// public and a goalId is computeGoalId(pool, participant) on chain, so the
// filter adds no linkage that was not already public. No participant address
// is ever echoed back.

import { listLedgerGoalIds, readLedger } from "@/lib/server/agent/ledger";
import { toPublicFeedClaim } from "@/lib/server/agent/feed-view";
import { participantOf } from "@/lib/server/agent/named-feed";
import { errorMessage, jsonError } from "@/lib/server/http";

const FEED_LIMIT = 20;
/** How far back History looks for the player's own claims. */
const MINE_WINDOW = 200;
const MINE_LIMIT = 50;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request?: Request) {
  try {
    const forParam =
      request !== undefined ? new URL(request.url).searchParams.get("for") : null;
    const player =
      forParam !== null && ADDRESS_RE.test(forParam) ? forParam.toLowerCase() : null;

    const index = await listLedgerGoalIds(player !== null ? MINE_WINDOW : FEED_LIMIT);
    const rows = await Promise.all(
      index.map(async ({ goalId, at }) => {
        const ledger = await readLedger(goalId);
        return {
          claim: toPublicFeedClaim(goalId, at, ledger),
          participant: player !== null ? participantOf(ledger) : null,
        };
      }),
    );
    const claims = rows.slice(0, FEED_LIMIT).map((r) => r.claim);
    if (player === null) return Response.json({ claims });

    const mine = rows
      .filter((r) => r.participant === player)
      .slice(0, MINE_LIMIT)
      .map((r) => r.claim);
    return Response.json({ claims, mine });
  } catch (err) {
    // Loud server-side, generic client-side: the real message can carry
    // store paths and ledger file names, which do not belong on an
    // unauthenticated endpoint.
    console.error("agent feed error:", errorMessage(err));
    return jsonError(500, "agent feed unavailable");
  }
}
