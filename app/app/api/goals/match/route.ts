// GET /api/goals/match?q=<free text> - rank live pools against a typed goal.
//
// Deliberately keyword scoring, not an LLM: five demo pools rank identically
// for free, and the agent's reasoning step is where the Gemini call is
// load-bearing. Scores are token overlap between the query and each pool's
// initiative + goal text; unfunded and settled pools rank last.

import { ContractNotConfiguredError, fetchPools } from "@/lib/contract";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "be", "do", "for", "get", "going", "i", "in",
  "is", "it", "my", "of", "on", "the", "to", "will",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const queryTokens = new Set(tokens(q));
    const pools = await fetchPools();

    const now = BigInt(Math.floor(Date.now() / 1000));
    const matches = pools
      .filter((pool) => !pool.settled && pool.periodEnd > now)
      .map((pool) => {
        const poolTokens = tokens(`${pool.initiative} ${pool.goalSpec}`);
        let score = 0;
        for (const token of poolTokens) {
          if (queryTokens.has(token)) score += 1;
        }
        return {
          poolId: pool.id.toString(),
          initiative: pool.initiative,
          goalSpec: pool.goalSpec,
          balance: pool.balance.toString(),
          entryFee: pool.entryFee.toString(),
          periodEnd: pool.periodEnd.toString(),
          // Model 2 is a self-staked commitment pool: the money is the
          // participants' own stakes, not a sponsor's. The card copy branches on
          // this so it never tells a self-staker a sponsor funded their goal.
          bountyModel: pool.bountyModel,
          score,
        };
      })
      .sort(
        (a, b) => b.score - a.score || Number(BigInt(b.balance) - BigInt(a.balance)),
      );

    return Response.json({ matches });
  } catch (err) {
    const cid = newCorrelationId("goals-match");
    if (err instanceof ContractNotConfiguredError) {
      console.error(`[${cid}] ${err.message}`);
      return jsonError(503, "Runs are not open on this build yet.");
    }
    return jsonError(500, safeError(err, cid));
  }
}
