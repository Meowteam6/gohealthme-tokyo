// GET /api/pools/[id]/funding - what backers added to a pool through fundPool:
// the sum and the funders, from the PoolFunded scan (lib/server/pool-funders).
//
// The run page subtracts the sum from the pot net of stakes to name the
// creator's own seed at create, which is what tells a challenge with a reward
// from a stake on yourself that friends have backed (lib/game/money-sharing
// challengeRunKindOf). The challenge link page makes the same read on the
// server; this is the browser's way to it.
//
// No auth: it says what the chain says about a pool's pot, nothing about
// anyone's goal, and the event carries no health data. Cached at the edge for
// a minute: the scan is windowed getLogs, and the pot's other reads on the
// page are no fresher.
//
// Response JSON: { total, funders } with total in USDC base units as a
// string; 400 on a bad run number, 503 while the pools contract is not
// configured, 502 when the chain did not answer.

import { ContractNotConfiguredError } from "@/lib/contract";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";
import { fetchPoolFunding } from "@/lib/server/pool-funders";

export const dynamic = "force-dynamic";

const CACHE = { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };
// The same plain line the sponsor console gets: no env var name, and nothing
// about a send, since this is a read.
const NOT_CONFIGURED = "Runs are not open on this build yet.";

type Ctx = { params: Promise<{ id: string }> };

function poolIdOf(raw: string): bigint | null {
  try {
    const id = BigInt(raw);
    return id > 0n ? id : null;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, ctx: Ctx) {
  const cid = newCorrelationId("pool-funding");
  const { id } = await ctx.params;
  const poolId = poolIdOf(id);
  if (poolId === null) return jsonError(400, "That is not a run number.");
  try {
    const funding = await fetchPoolFunding(poolId);
    return Response.json(
      { total: funding.total.toString(), funders: funding.funders },
      { headers: CACHE },
    );
  } catch (err) {
    if (err instanceof ContractNotConfiguredError) {
      return jsonError(503, NOT_CONFIGURED);
    }
    return jsonError(502, safeError(err, cid));
  }
}
