// Public, on-chain-derived stats for a wallet's profile page. Everything here
// is computed from HealthPools money/identity events, which carry addresses,
// amounts, and block positions ONLY - never an initiative or goalSpec - so the
// output is health-safe by construction. No health data, no ledger prose, no
// wearable read is ever touched by this module.
//
// The counters map to the paid-wall:
//   goalsHit    = AchieverPaid events paying this wallet (a verified win, paid)
//   usdcEarned  = sum of AchieverPaid amounts to this wallet
//   poolsJoined = PoolJoined events for this wallet
//   winStreak   = trailing run of verdict==true in this wallet's ResultRecorded
//
// getLogs is filtered server-side by the indexed address param, so each query
// is scoped to one wallet rather than the whole contract, and the result is
// cached briefly per wallet so a profile view does not re-scan on every render.

import { getAddress, type Address, type Hex } from "viem";
import {
  achieverPaidEvent,
  formatUsdc,
  getArcPublicClient,
  getHealthPoolsAddress,
  healthPoolsAbi,
  healthVerdictReadAbi,
  poolJoinedEvent,
  resultRecordedEvent,
} from "@/lib/contract";
import { proofTierFromVerdict, type ProofTier } from "@/lib/proof-tier";
import { normalizeAddress } from "@/lib/social";
import { readLedger, type LedgerEntry } from "@/lib/server/agent/ledger";
import { scanInWindows, poolsScanFromBlock } from "@/lib/server/chunked-logs";
import { poolVerdictRegistry } from "@/lib/server/verdict";

export interface SocialWin {
  /** ISO-8601 block time, or "" when the block time could not be read. */
  at: string;
  amountUsd: string; // formatted, two decimals, e.g. "40.00"
  txHash: string; // the settlement tx -> Arcscan link
  role: "achiever";
  /** Trust tier of an achiever win (from the HealthVerdict facet bitmap). A
   *  "self-reported" win is a real win but must NEVER render as verified.
   *  "unknown" is neither proven verified nor known self-reported. */
  tier: ProofTier | null;
}

export interface SocialStats {
  goalsHit: number; // total achiever wins (verified + self-reported + unknown)
  /** Achiever wins whose on-chain verdict asserts a trust facet. This is the
   *  number the profile's "Verified wins" stat shows — self-reported wins are
   *  excluded so it can never overstate. */
  verifiedWins: number;
  /** Achiever wins whose on-chain verdict asserts no facet (bitmap 0): real
   *  wins, paid at 1x, that are NOT verified and are counted separately. */
  selfReportedWins: number;
  usdcEarned: bigint; // USDC in 6-decimal base units
  poolsJoined: number;
  winStreak: number;
  recentWins: SocialWin[]; // newest first, capped at WINS_LIMIT
  /** False when the chain could not be read: the counters above are then
   *  placeholders, and the profile must say so instead of showing zeros as
   *  fact. True for a real (possibly empty) answer. */
  readOk: boolean;
}

export const EMPTY_STATS: SocialStats = {
  goalsHit: 0,
  verifiedWins: 0,
  selfReportedWins: 0,
  usdcEarned: 0n,
  poolsJoined: 0,
  winStreak: 0,
  recentWins: [],
  readOk: true,
};

const UNREADABLE_STATS: SocialStats = { ...EMPTY_STATS, readOk: false };

// How many recent payout rows the paid-wall shows. Block timestamps for these
// are fetched one block at a time, so the cap also bounds that fan-out.
const WINS_LIMIT = 12;

// Each event query is windowed (Arc caps a single getLogs at 100k blocks and
// runs sub-second blocks) via scanInWindows from the pinned deploy-era start.
// The per-wallet scans run at once, so each uses a small window concurrency
// to keep their combined peak under the RPC rate limit.
const SCAN_CONCURRENCY = 2;

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; stats: SocialStats }>();

/** Test seam. */
export function clearSocialStatsCache(): void {
  cache.clear();
}

type Positioned = { blockNumber: bigint | null; logIndex: number | null };

/** Chronological order across the chain: block first, log index within block. */
function byPosition(a: Positioned, b: Positioned): number {
  const ab = a.blockNumber ?? 0n;
  const bb = b.blockNumber ?? 0n;
  if (ab !== bb) return ab < bb ? -1 : 1;
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
}

/**
 * Resolve ISO timestamps for a bounded set of block numbers. Best-effort: a
 * block whose header cannot be read is simply absent from the map, and the
 * caller renders that win without a relative time rather than failing.
 */
async function resolveBlockTimes(
  blockNumbers: (bigint | null)[],
): Promise<Map<bigint, string>> {
  const out = new Map<bigint, string>();
  const distinct = Array.from(
    new Set(
      blockNumbers.filter((b): b is bigint => b !== null).map((b) => b.toString()),
    ),
  ).map((s) => BigInt(s));
  if (distinct.length === 0) return out;

  const client = getArcPublicClient();
  await Promise.all(
    distinct.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber });
        out.set(blockNumber, new Date(Number(block.timestamp) * 1000).toISOString());
      } catch {
        // Leave this block out; the win row renders without a timestamp.
      }
    }),
  );
  return out;
}

/**
 * Resolve the on-chain trust tier of each of a wallet's achiever wins, keyed by
 * pool id. Every AchieverPaid to this wallet has a goalId of
 * computeGoalId(pool, poolId, wallet, periodStart); its HealthVerdict facet
 * bitmap says whether the win is verified-tier or the low-trust self-reported
 * tier (bitmap 0). No getLogs — this is a plain view read per distinct pool.
 *
 * Best-effort and fail-safe: with the registry unset, or on any read failure,
 * the pool is left OUT of the map and the caller treats it as "unknown" (never
 * verified). A win is only ever counted as verified when the chain proves it.
 */
async function achieverTierByPool(
  poolsAddress: Address,
  account: Address,
  achieverPoolIds: bigint[],
): Promise<Map<string, ProofTier>> {
  const out = new Map<string, ProofTier>();
  const distinct = Array.from(
    new Set(achieverPoolIds.map((id) => id.toString())),
  ).map((s) => BigInt(s));
  if (distinct.length === 0) return out;

  // The pool's own healthVerdict() decides where the tier lives (the V3 P19
  // lesson, lib/server/verdict.ts): a registry address means the on-chain
  // facet bitmap; 0x0 means an oracle-only pool with no bitmap at all, so the
  // tier comes from SPOTTER's ledger verdict for that goal. The env var is
  // never consulted. A failed read leaves every pool "unknown".
  let registry: Address | null;
  try {
    registry = await poolVerdictRegistry(poolsAddress);
  } catch {
    return out;
  }

  const client = getArcPublicClient();
  await Promise.all(
    distinct.map(async (poolId) => {
      try {
        const goalId = (await client.readContract({
          address: poolsAddress,
          abi: healthPoolsAbi,
          functionName: "computeGoalId",
          args: [poolId, account],
        })) as Hex;
        if (registry === null) {
          const tier = tierFromLedger(await readLedger(goalId));
          if (tier !== null) out.set(poolId.toString(), tier);
          return;
        }
        const verdict = await client.readContract({
          address: registry,
          abi: healthVerdictReadAbi,
          functionName: "getVerdict",
          args: [goalId],
        });
        out.set(
          poolId.toString(),
          proofTierFromVerdict(verdict.verified, Number(verdict.bitmap)),
        );
      } catch {
        // Leave this pool out; the caller reads it as "unknown" (not verified).
      }
    }),
  );
  return out;
}

/**
 * The tier of an oracle-only win, from SPOTTER's own record of it: the newest
 * verified verdict entry. A self-reported verdict is the low tier; any other
 * verified verdict (wearable or document) is the verified tier. No verified
 * verdict on file means the win cannot be classified, so null ("unknown").
 */
export function tierFromLedger(ledger: LedgerEntry[]): ProofTier | null {
  let tier: ProofTier | null = null;
  for (const entry of ledger) {
    if (entry.kind !== "verdict" || entry.verified !== true) continue;
    tier = entry.selfReported === true ? "self-reported" : "verified";
  }
  return tier;
}

/**
 * Compute a wallet's public stats. Never throws: a dead RPC or a rejected log
 * query yields placeholder counters with readOk false, so the profile still
 * renders its identity and says the stats could not be read.
 */
export async function getSocialStats(rawAddress: string): Promise<SocialStats> {
  const lower = normalizeAddress(rawAddress);
  if (lower === null) return EMPTY_STATS;

  const cached = cache.get(lower);
  if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.stats;
  }

  const poolsAddress = getHealthPoolsAddress();
  if (poolsAddress === null) return UNREADABLE_STATS;
  const account = getAddress(lower) as Address;
  const client = getArcPublicClient();
  const start = poolsScanFromBlock();

  try {
    const latest = await client.getBlockNumber();
    const scan = <T>(
      query: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
    ) => scanInWindows(start, latest, query, SCAN_CONCURRENCY);
    const [achiever, joined, results] = await Promise.all([
      scan((fromBlock, toBlock) =>
        client.getLogs({
          address: poolsAddress,
          event: achieverPaidEvent,
          args: { participant: account },
          fromBlock,
          toBlock,
        }),
      ),
      scan((fromBlock, toBlock) =>
        client.getLogs({
          address: poolsAddress,
          event: poolJoinedEvent,
          args: { participant: account },
          fromBlock,
          toBlock,
        }),
      ),
      scan((fromBlock, toBlock) =>
        client.getLogs({
          address: poolsAddress,
          event: resultRecordedEvent,
          args: { participant: account },
          fromBlock,
          toBlock,
        }),
      ),
    ]);

    // Trust tier per winning pool, read from the HealthVerdict facet bitmap.
    // A win is only counted as verified when the chain proves a trust facet;
    // a bitmap-0 verdict is a real but self-reported win, counted separately.
    const achieverPoolIds = achiever
      .map((log) => log.args.poolId)
      .filter((id): id is bigint => id !== undefined);
    const tierByPool = await achieverTierByPool(
      poolsAddress,
      account,
      achieverPoolIds,
    );
    const tierOfPool = (poolId: bigint | undefined): ProofTier =>
      poolId === undefined ? "unknown" : (tierByPool.get(poolId.toString()) ?? "unknown");

    let verifiedWins = 0;
    let selfReportedWins = 0;
    for (const log of achiever) {
      const tier = tierOfPool(log.args.poolId);
      if (tier === "verified") verifiedWins += 1;
      else if (tier === "self-reported") selfReportedWins += 1;
    }

    let usdcEarned = 0n;
    for (const log of achiever) usdcEarned += log.args.amount ?? 0n;

    // Win streak: trailing run of verified results in chronological order.
    const streak = [...results].sort(byPosition).reduce((run, log) => {
      return log.args.verdict === true ? run + 1 : 0;
    }, 0);

    // Recent payout rows: the achiever payouts this wallet received, newest
    // first, capped. Each carries the settlement tx hash directly off the log;
    // block time is resolved for the capped set only.
    type WinLog = {
      blockNumber: bigint | null;
      logIndex: number | null;
      txHash: string;
      amount: bigint;
      role: "achiever";
      tier: ProofTier | null;
    };
    const winLogs: WinLog[] = achiever
      .map((log) => ({
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        txHash: String(log.transactionHash ?? ""),
        amount: log.args.amount ?? 0n,
        role: "achiever" as const,
        tier: tierOfPool(log.args.poolId),
      }))
      .filter((w) => w.txHash !== "")
      .sort((a, b) => byPosition(b, a))
      .slice(0, WINS_LIMIT);

    const blockTimes = await resolveBlockTimes(
      winLogs.map((w) => w.blockNumber),
    );
    const recentWins: SocialWin[] = winLogs.map((w) => ({
      at:
        w.blockNumber !== null
          ? (blockTimes.get(w.blockNumber) ?? "")
          : "",
      amountUsd: formatUsdc(w.amount),
      txHash: w.txHash,
      role: w.role,
      tier: w.tier,
    }));

    const stats: SocialStats = {
      goalsHit: achiever.length,
      verifiedWins,
      selfReportedWins,
      usdcEarned,
      poolsJoined: joined.length,
      winStreak: streak,
      recentWins,
      readOk: true,
    };

    cache.set(lower, { at: Date.now(), stats });
    return stats;
  } catch (err) {
    console.error("[social-stats] log scan failed", err);
    return UNREADABLE_STATS;
  }
}
