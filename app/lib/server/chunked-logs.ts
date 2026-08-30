// Windowed eth_getLogs for Base Sepolia.
//
// Base Sepolia public RPCs cap a single eth_getLogs block range hard: publicnode
// rejects anything over 50,000 ("exceed maximum block range: 50000") and
// sepolia.base.org 413s on wide ranges. So any scan that must cover the
// contract's history is split into windows under that cap. Pinning the start
// near the HealthPools deploy keeps it to a handful of windows.

/** Under Base Sepolia's eth_getLogs cap (publicnode maxes at 50k; sepolia.base.org
 *  smaller still and fails over to publicnode via viem's fallback transport). */
const RANGE = 45_000n;

/** Default window batch size. A caller running several scans at once passes a
 *  lower value so their combined peak stays under the RPC rate limit. */
const CONCURRENCY = 6;

/**
 * Scan start for HealthPools history. The canonical V3 contract
 * (0x66815e3AC541eB18d01D2aed25D0D9779583D832) deployed on Base Sepolia on
 * 2026-08-24 (~block 45.92M; Base runs ~2s blocks), so a full scan from 0 wastes
 * thousands of empty windows. Pinned safely before that deploy. The prior
 * default (54M) was an Arc-testnet block that sits ABOVE Base Sepolia's head
 * (~46.09M), so every windowed scan short-circuited to empty on Base - the
 * activity ticker and on-chain stats read nothing. Override with
 * HEALTH_POOLS_FROM_BLOCK once history grows enough to retune it.
 */
export function poolsScanFromBlock(): bigint {
  const raw = process.env.HEALTH_POOLS_FROM_BLOCK ?? "";
  if (/^\d+$/.test(raw)) return BigInt(raw);
  return 45_800_000n;
}

/**
 * Split [fromBlock, toBlock] into windows no wider than RANGE, run `query` on
 * each, and concatenate the results in window order. `query` receives one
 * window's block bounds and returns that window's logs. Windows run CONCURRENCY
 * at a time so a multi-window scan stays under the RPC's rate limit while still
 * overlapping round trips. A range that fits in one window is a single call.
 */
export async function scanInWindows<T>(
  fromBlock: bigint,
  toBlock: bigint,
  query: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  concurrency: number = CONCURRENCY,
): Promise<T[]> {
  if (toBlock < fromBlock) return [];
  const batchSize = concurrency < 1 ? 1 : concurrency;
  const windows: Array<[bigint, bigint]> = [];
  for (let from = fromBlock; from <= toBlock; from += RANGE) {
    const to = from + RANGE - 1n > toBlock ? toBlock : from + RANGE - 1n;
    windows.push([from, to]);
  }
  const out: T[] = [];
  for (let i = 0; i < windows.length; i += batchSize) {
    const batch = windows.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(([f, t]) => query(f, t)));
    for (const r of results) out.push(...r);
  }
  return out;
}
