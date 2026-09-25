// GET /api/activity - a system-wide live activity ticker.
//
// Reads REDACTION-SAFE on-chain events from HealthPools - PoolJoined,
// PoolFunded, AchieverPaid - which by their event shape carry only poolId,
// addresses, amounts, and tx hashes: NO initiative, NO goalSpec, NO health
// string of any kind (see lib/contract.ts:232-235). PoolCreated is deliberately
// NOT read here because its payload includes goalSpec. Private challenge pools
// are filtered out entirely (isChallengePool, excludes-on-uncertainty), the same
// posture the public payout feed takes. So an item exposes only: actor handle
// (or truncated-address fallback), event type, amount (payouts/funds), and time.
//
// getLogs over a bounded recent window (there is no system-wide indexer), merged
// newest-first, handles resolved via the social profiles table, cached ~30s so a
// polled ticker does not re-scan every request. Never 500s the ticker: on error
// it serves the last good result, or an empty list.

import {
  achieverPaidEvent,
  formatUsdc,
  getArcPublicClient,
  getHealthPoolsAddress,
  poolFundedEvent,
  poolJoinedEvent,
} from "@/lib/contract";
import { poolsScanFromBlock, scanInWindows } from "@/lib/server/chunked-logs";
import { resolveProfiles } from "@/lib/server/social-profile";
import { isChallengePool } from "@/lib/server/challenge-pool";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";

const CACHE_TTL_MS = 30_000;
const MAX_EVENTS = 14;
const SCAN_CONCURRENCY = 4;

type ActivityType = "joined" | "funded" | "paid";

interface ActivityItem {
  type: ActivityType;
  handle: string | null;
  address: string | null;
  amountUsd: string | null;
  at: string;
  id: string;
}

interface RawItem {
  type: ActivityType;
  poolId: bigint;
  actor: string;
  amount: bigint | null;
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
}

let cache: { at: number; events: ActivityItem[] } | null = null;

/** No pools contract on this build (unset, malformed or the refused V3
 *  address). Reported as an error, never as an empty chain. */
class NoPoolsContractError extends Error {}

async function buildActivity(): Promise<ActivityItem[]> {
  const poolsAddress = getHealthPoolsAddress();
  if (poolsAddress === null) throw new NoPoolsContractError();

  const client = getArcPublicClient();
  const latest = await client.getBlockNumber();
  // Scan the contract's full history from the pinned deploy floor - the same
  // source every other on-chain reader in the app uses. The floor keeps this to
  // a handful of windows; MAX_EVENTS + newest-first slicing keeps the ticker
  // showing only the latest moments.
  const start = poolsScanFromBlock();

  const scan = <T>(q: (f: bigint, t: bigint) => Promise<T[]>) =>
    scanInWindows(start, latest, q, SCAN_CONCURRENCY);

  const [joined, funded, paid] = await Promise.all([
    scan((fromBlock, toBlock) =>
      client.getLogs({ address: poolsAddress, event: poolJoinedEvent, fromBlock, toBlock }),
    ),
    scan((fromBlock, toBlock) =>
      client.getLogs({ address: poolsAddress, event: poolFundedEvent, fromBlock, toBlock }),
    ),
    scan((fromBlock, toBlock) =>
      client.getLogs({ address: poolsAddress, event: achieverPaidEvent, fromBlock, toBlock }),
    ),
  ]);

  const raw: RawItem[] = [];
  const push = (
    type: ActivityType,
    poolId: unknown,
    actor: unknown,
    amount: unknown,
    blockNumber: bigint | null | undefined,
    logIndex: number | null | undefined,
    txHash: string | null | undefined,
  ) => {
    if (
      typeof poolId !== "bigint" ||
      typeof actor !== "string" ||
      blockNumber == null ||
      txHash == null
    ) {
      return;
    }
    raw.push({
      type,
      poolId,
      actor: actor.toLowerCase(),
      amount: typeof amount === "bigint" ? amount : null,
      blockNumber,
      logIndex: logIndex ?? 0,
      txHash,
    });
  };

  for (const l of joined) {
    push("joined", l.args.poolId, l.args.participant, null, l.blockNumber, l.logIndex, l.transactionHash);
  }
  for (const l of funded) {
    push("funded", l.args.poolId, l.args.funder, l.args.amount, l.blockNumber, l.logIndex, l.transactionHash);
  }
  for (const l of paid) {
    push("paid", l.args.poolId, l.args.participant, l.args.amount, l.blockNumber, l.logIndex, l.transactionHash);
  }

  // Newest-first by (blockNumber, logIndex).
  raw.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? b.logIndex - a.logIndex
      : b.blockNumber > a.blockNumber
        ? 1
        : -1,
  );

  // Exclude private challenge pools - check each unique poolId once.
  const uniquePoolIds = [...new Set(raw.map((r) => r.poolId.toString()))];
  const flags = await Promise.all(
    uniquePoolIds.map(async (pid) => [pid, await isChallengePool(pid)] as const),
  );
  const challenge = new Set(flags.filter(([, isCh]) => isCh).map(([pid]) => pid));
  const publicItems = raw
    .filter((r) => !challenge.has(r.poolId.toString()))
    .slice(0, MAX_EVENTS);

  // Resolve block times (unique blocks, best-effort) and handles.
  const uniqueBlocks = [
    ...new Set(publicItems.map((r) => r.blockNumber.toString())),
  ].map((s) => BigInt(s));
  const blockTimes = new Map<string, string>();
  await Promise.all(
    uniqueBlocks.map(async (bn) => {
      try {
        const blk = await client.getBlock({ blockNumber: bn });
        blockTimes.set(bn.toString(), new Date(Number(blk.timestamp) * 1000).toISOString());
      } catch {
        // best-effort; item just loses its precise time
      }
    }),
  );

  const profiles = await resolveProfiles([...new Set(publicItems.map((r) => r.actor))]);

  return publicItems.map((r) => ({
    type: r.type,
    handle: profiles.get(r.actor)?.handle ?? null,
    address: r.actor,
    amountUsd: r.amount !== null ? formatUsdc(r.amount) : null,
    at: blockTimes.get(r.blockNumber.toString()) ?? new Date(0).toISOString(),
    id: `${r.txHash}:${r.logIndex}`,
  }));
}

export async function GET() {
  const cid = newCorrelationId("activity");
  const now = Date.now();
  if (cache !== null && now - cache.at < CACHE_TTL_MS) {
    return Response.json({ events: cache.events });
  }
  try {
    const events = await buildActivity();
    cache = { at: now, events };
    return Response.json({ events });
  } catch (err) {
    if (err instanceof NoPoolsContractError) {
      // "Quiet right now" would be a lie: nothing is being read at all.
      console.error(`[${cid}] no HealthPools contract configured for this build`);
      return jsonError(503, "Runs are not open on this build yet.");
    }
    if (cache !== null) return Response.json({ events: cache.events });
    return jsonError(500, safeError(err, cid));
  }
}
