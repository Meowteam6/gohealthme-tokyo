// Read a pool's contributors from PoolFunded logs, KEEPING the funder
// addresses.
//
// sponsor-data.ts reads the same event but reduces it to counts and USDC sums
// and discards the identities; this reader is the one place that needs the
// addresses, to name who chipped in to sweeten a challenge. Scoped to one pool
// via the indexed poolId topic and windowed with the shared scanInWindows +
// poolsScanFromBlock helpers, so it never scans from block 0 (Arc's 100k-block
// getLogs cap).
//
// createPool does NOT emit PoolFunded - it emits PoolCreated - so the creator's
// initial reward is not a contribution here. This returns only the wallets that
// added to the pot AFTER creation via fundPool, never the challenger. That is
// exactly what the "backed by" strip wants: the extra contributors, not the
// person who put the pot up.

import type { Address } from "viem";
import {
  ContractNotConfiguredError,
  getArcPublicClient,
  getHealthPoolsAddress,
  poolFundedEvent,
} from "@/lib/contract";
import { poolsScanFromBlock, scanInWindows } from "@/lib/server/chunked-logs";

export interface PoolFunding {
  /** Unique funders, first-contribution first. */
  funders: Address[];
  /** Sum of every fundPool top-up, in USDC base units. The dare landing
   *  subtracts it from the prize to name the challenger's own seed. */
  total: bigint;
}

/**
 * Unique funder addresses for a pool, first-contribution first, and the sum
 * of what they added. A wallet that chips in more than once appears once. The
 * event carries no health data, so the addresses are safe to return and name.
 */
export async function fetchPoolFunding(poolId: bigint): Promise<PoolFunding> {
  const address = getHealthPoolsAddress();
  if (address === null) throw new ContractNotConfiguredError();
  const client = getArcPublicClient();

  const latest = await client.getBlockNumber();
  const logs = await scanInWindows(
    poolsScanFromBlock(),
    latest,
    (fromBlock, toBlock) =>
      client.getLogs({
        address,
        event: poolFundedEvent,
        args: { poolId },
        fromBlock,
        toBlock,
      }),
  );

  const seen = new Set<string>();
  const funders: Address[] = [];
  let total = 0n;
  for (const log of logs) {
    total += log.args.amount ?? 0n;
    const funder = log.args.funder;
    if (funder === undefined) continue;
    const key = funder.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    funders.push(funder);
  }
  return { funders, total };
}
