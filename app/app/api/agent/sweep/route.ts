// GET/POST /api/agent/sweep - settle every recorded claim whose pool period
// has ended, driven by Vercel cron (app/vercel.json, every two minutes).
//
// Why this exists: the run route only settles while a browser is polling it.
// A participant whose pool ends after they close the tab would otherwise
// never be paid - the exact "manual checkout" failure the agent exists to
// remove. The sweep finds claims that are recorded but not settled and drives
// the SAME settle block the run loop uses (settleRecordedClaim), so both paths
// append identical ledger entries and both assert on the AchieverPaid payout,
// never on transaction success.
//
// Each claim's pool linkage (poolId + participant) is stored in its plan
// entry at plan time, which is what makes this route self-sufficient: no
// request body, no chain scan, just the ledger.
//
// WHAT IT READS. Primary source is the pending-settlement queue (lock.ts): a
// sorted set of claims scored by the moment they become settleable, written
// when a claim defers and removed when it settles. The sweep reads only what
// is actually due instead of walking the newest N ledgers and asking the chain
// about each one. A bounded index scan still runs afterwards, with whatever
// time budget is left, for claims recorded before the queue existed; those get
// migrated into the queue as they are seen, so the fallback drains itself.
//
// TIME BUDGET. Settles are sequential (each is a Circle transaction plus an
// inclusion wait) and the function window is 60s. Without a budget the loop is
// killed mid-claim with no checkpoint. It therefore stops cleanly at 45s and
// reports `truncated`; the next cron tick two minutes later picks up where it
// left off, because eligibility is derived from the ledger, not from position
// in a list.
//
// SINGLE FLIGHT. A manual run and the cron tick must not overlap - two sweeps
// would race each other's settles. One lock, held for the whole sweep; a
// second caller is told a sweep is already running and changes nothing.
//
// Auth: `authorization: Bearer ${CRON_SECRET}`, timing-safe compared. Vercel
// cron sends exactly that header (as a GET) when the CRON_SECRET env var
// exists, so GET and POST share one handler.
//
// APPROVED, NOT RECORDED (World ID for Agents). A claim the human confirmed
// but whose record write never ran (the tab closed after the confirmation) is
// recorded here through the same run loop the browser drives
// (lib/server/agent/approved-record.ts), and its pool is held from the pool
// phase meanwhile, so a confirmed win is never refunded as unadjudicated.
//
// THE MISS PHASE (commitment model, 2026-09-26). Between the claim phase and
// the pool phase, every joined player of every pool that can record a miss
// (model 2, wearable only, a metric whose day is final) is judged once after
// periodEnd + MISS_GRACE_HOURS, whether or not they ever opened the app
// (lib/server/agent/miss-record.ts runMissPhase). A skip writes nothing; a
// miss is written on chain and asserted. Such a pool settles only after every
// player in it was judged (the per-pool marker, passed to every settle as
// missPhaseDone), and once it settles each miss gets its closing row.
//
// Response JSON:
//   { swept: [...goalIds], settled, deferred, errors, recorded, truncated,
//     poolsSettled, poolErrors, missesRecorded, missesClosed,
//     missSkips: [{ poolId, address, basis }], missErrors, skipped? }

import { timingSafeEqual } from "crypto";
import { isAddress, type Address, type Hex } from "viem";
import {
  settleRecordedClaim,
  livePoolSettleLock,
  SETTLE_UNPAYABLE_MESSAGE,
  type SettleClaimDeps,
} from "@/lib/server/agent/run";
import {
  addPendingSettlement,
  listDuePendingSettlements,
  removePendingSettlement,
  withLock,
} from "@/lib/server/agent/lock";
import {
  listLedgerGoalIds,
  readLedger,
  type LedgerEntry,
} from "@/lib/server/agent/ledger";
import { getCircleClient, getSpotterWallet } from "@/lib/server/agent/wallet";
import {
  arcReader,
  settleDuePoolAsSpotter,
  type ArcReader,
  type SpotterDeps,
  type SpotterExecutor,
} from "@/lib/server/agent/spotter";
// --- miss rule ---
import { runMissPhase } from "@/lib/server/agent/miss-record";
import { missPhaseDone } from "@/lib/server/agent/miss-store";
import { recordResult } from "@/lib/server/oracle";
import {
  providerById,
  providerConfigured,
  pinnedProviderId,
  storedProviderId,
} from "@/lib/server/wearable";
// --- end miss rule ---
import { liveBuyDeps } from "@/lib/server/agent/x402";
import {
  approvedUnrecordedOf,
  recordApprovedClaim,
  withinRecordHold,
  type ApprovedRecordTarget,
} from "@/lib/server/agent/approved-record";
import { requireEnv, requireHealthPoolsAddress } from "@/lib/server/env";
import { errorMessage, jsonError } from "@/lib/server/http";
// --- ens ---
import {
  reconcileSettlementReceipts,
  writeSettlementReceipt,
} from "@/lib/server/ens/receipt";
import { storeSettleTxCache } from "@/lib/server/agent/spotter";
// --- end ens ---

// One sweep can settle several pools, each a Circle transaction plus an
// inclusion wait; the default function window is not enough for that.
export const maxDuration = 60;

/** Stop cleanly with this much of the window left, so the response is written
 *  and the queue state is consistent instead of being killed mid-settle. */
const SWEEP_BUDGET_MS = 45_000;

/** The miss phase stops starting new players past this point of the sweep:
 *  one player can cost three provider reads plus a chain write, and the pool
 *  phase after it must still get its turn inside the window. */
const MISS_PHASE_BUDGET_MS = 30_000;

/** Above maxDuration, so a killed sweep's lock always expires. */
const SWEEP_LOCK_TTL_MS = 75_000;
const SWEEP_LOCK = "agent:sweep";

/** How many due claims one sweep pulls from the queue. Comfortably more than
 *  the time budget can settle; the remainder is picked up next tick. */
const DUE_BATCH = 200;

/** Fallback horizon for claims recorded before the pending queue existed.
 *  Bounded on purpose: the queue is the real index, this is a migration path
 *  that drains itself as legacy claims are re-queued or settle. */
const FALLBACK_SCAN_LIMIT = 100;

/** How long after periodEnd a pool must sit before the pool phase settles it.
 *  A participant whose proof is mid-verification has no settled claim yet, and
 *  settling underneath them turns a payout into a refund (the contract refunds
 *  whoever the oracle never adjudicated). This margin gives an in-flight
 *  verification room to land; the claim phase settles those properly. */
const POOL_SETTLE_MIN_AGE_S = 30 * 60;

/** Settles per sweep from the pool phase. Reads are cheap, settles are not;
 *  the remainder is picked up by the next cron tick two minutes later. */
const POOL_SETTLE_MAX_PER_SWEEP = 10;

interface SweepCounts {
  swept: string[];
  settled: number;
  deferred: number;
  errors: number;
  /** Human-approved claims whose record write this sweep drove (tab closed). */
  recorded: number;
  truncated: boolean;
  /** Pools settled by the pool phase (abandoned pools, no claim to drive them). */
  poolsSettled: number;
  /** One line per pool the pool phase could not settle. Never silent. */
  poolErrors: string[];
  // --- miss rule ---
  /** Misses written on chain this sweep (verdict=false, asserted). */
  missesRecorded: number;
  /** Recorded misses given their closing row after their pool settled. */
  missesClosed: number;
  /** Players judged with nothing recorded, and why (they are refunded). */
  missSkips: { poolId: string; address: string; basis: string }[];
  /** Miss-phase failures, one line each. Never silent. */
  missErrors: string[];
  // --- end miss rule ---
}

function authorized(request: Request): boolean {
  const expected = Buffer.from(`Bearer ${requireEnv("CRON_SECRET")}`);
  const header = request.headers.get("authorization");
  if (header === null) return false;
  const provided = Buffer.from(header);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

type Eligibility =
  | { settle: true; poolId: bigint; participant: Address }
  /** Approved by the human, not recorded yet: drive the record write. */
  | { settle: false; record: ApprovedRecordTarget; poolId: bigint }
  | { settle: false; poolId?: bigint; record?: undefined };

/** Approved claims recorded per sweep. Each is a full run-loop pass (an
 *  evidence read, a record write, maybe a settle), so a few per tick keeps the
 *  sweep inside its window; the rest are picked up two minutes later. */
const APPROVED_RECORDS_PER_SWEEP = 3;

/**
 * Decide whether a claim is worth a settle attempt, from its ledger alone.
 * Claims that are done or beyond recovery are dropped from the pending queue
 * here, which is what keeps the queue from growing without bound.
 */
async function eligibility(
  goalId: string,
  ledger: LedgerEntry[],
  nowMs: number,
): Promise<Eligibility> {
  // --- miss rule ---
  // A recorded miss pays this player nothing, so the claim settle (which
  // asserts AchieverPaid for the participant) can never succeed for it. Drop
  // it from the queue and do NOT claim its pool: the pool phase settles it
  // once the miss phase is done, and the miss phase closes the row.
  if (ledger.some((e) => e.kind === "record" && e.verdict === false)) {
    await removePendingSettlement(goalId);
    return { settle: false };
  }
  // --- end miss rule ---
  if (!ledger.some((e) => e.kind === "record")) {
    // World ID for Agents: the human confirmed, but the record write never
    // ran because nobody polled after the confirmation (tab closed). Record
    // it now, and report the pool so the pool phase does not settle it
    // underneath this claim and refund a confirmed win.
    const approved = approvedUnrecordedOf(ledger);
    if (approved !== null) {
      if (withinRecordHold(approved, nowMs)) {
        return { settle: false, record: approved, poolId: approved.poolId };
      }
      console.error(
        `[agent/sweep] ${goalId}: approved claim still unrecorded after the hold window; releasing pool ${approved.poolId} to the pool phase`,
      );
      await removePendingSettlement(goalId);
    }
    // Otherwise nothing is on chain for this claim, so there is nothing to pay.
    return { settle: false };
  }
  // Already paid - the run loop's fast path would say "paid" too.
  if (ledger.some((e) => e.kind === "settle" && e.status === "settled")) {
    await removePendingSettlement(goalId);
    return { settle: false };
  }
  // Terminal: the pool settled without this claim; retrying cannot help.
  if (
    ledger.some(
      (e) =>
        e.kind === "error" &&
        e.stage === "settle" &&
        e.message === SETTLE_UNPAYABLE_MESSAGE,
    )
  ) {
    await removePendingSettlement(goalId);
    return { settle: false };
  }
  const plan = ledger.find((e) => e.kind === "plan");
  if (
    plan?.poolId === undefined ||
    !/^\d+$/.test(plan.poolId) ||
    plan.participant === undefined ||
    !isAddress(plan.participant)
  ) {
    // A claim planned before the pool linkage existed; the run route is
    // the only thing that can settle it.
    return { settle: false };
  }

  // The deferred entry already carries the moment this becomes settleable.
  // Honouring it costs nothing and saves an RPC round trip per claim that is
  // still inside its pool period; it also re-queues legacy claims so the
  // fallback scan stops finding them.
  const deferred = ledger.find(
    (e): e is Extract<LedgerEntry, { kind: "settle" }> =>
      e.kind === "settle" && e.status === "deferred",
  );
  const dueMs =
    deferred?.periodEndIso === undefined
      ? null
      : Date.parse(deferred.periodEndIso);
  if (dueMs !== null && Number.isFinite(dueMs)) {
    await addPendingSettlement(goalId, Math.floor(dueMs / 1000));
    // Not due yet: the claim path owns this pool. Report the linkage so the
    // pool phase leaves it alone rather than refunding a claim mid-flight.
    if (dueMs > nowMs) return { settle: false, poolId: BigInt(plan.poolId) };
  }

  return {
    settle: true,
    poolId: BigInt(plan.poolId),
    participant: plan.participant as Address,
  };
}

/**
 * Phase 2: settle pools no claim will ever settle.
 *
 * The claim phase above can only reach a pool some participant submitted proof
 * for. A participant who joins and never uploads anything leaves no ledger
 * entry at all, so their pool is invisible here, settle() is never called, and
 * the contract's refund-the-unadjudicated path never runs - their stake has no
 * way out of the contract. Measured on Base Sepolia 2026-09-02: pools 2, 3 and
 * 4 each held a participant's 0.50 USDC, 11-22h past periodEnd, unsettled.
 *
 * Pool ids run 1..poolCount and are never deleted, so this enumerates them
 * oldest-first: the longest-stuck stake is always freed first, whatever the
 * time budget allows. Pools the claim phase is already handling are skipped.
 */
async function sweepDuePools(
  circle: SpotterExecutor,
  reader: ArcReader,
  claimPools: Set<string>,
  outOfTime: () => boolean,
): Promise<{ poolsSettled: number; poolErrors: string[] }> {
  const poolsSettled = { count: 0 };
  const poolErrors: string[] = [];
  const deps: SpotterDeps = {
    circle,
    reader,
    settleLock: livePoolSettleLock(),
    // A pool that can record a miss settles only after every player in it
    // was judged; settleDuePoolAsSpotter reads this marker.
    missPhaseDone,
  };

  const total = await reader.poolCount();
  const cutoff =
    BigInt(Math.floor(Date.now() / 1000)) - BigInt(POOL_SETTLE_MIN_AGE_S);

  for (let poolId = 1n; poolId <= total; poolId++) {
    if (outOfTime() || poolsSettled.count >= POOL_SETTLE_MAX_PER_SWEEP) break;
    if (claimPools.has(poolId.toString())) continue;

    try {
      const state = await reader.getPoolState(poolId);
      if (state.settled) continue;
      // Still running, or inside the margin an in-flight verification needs.
      if (state.periodEnd >= cutoff) continue;

      const outcome = await settleDuePoolAsSpotter(deps, { poolId });
      if (outcome.status === "settled") {
        poolsSettled.count += 1;
        // The miss phase closes this pool's recorded misses from this
        // transaction's own events; remember it so no log scan is needed.
        await storeSettleTxCache().write(poolId, outcome.txHash);
      }
      // --- ens ---
      // A pool settled for its own sake (refunds, no claim) still gets its
      // receipt on pool-<id>.gohealthme.eth; achievers are counted from the
      // settle tx's AchieverPaid logs. Never throws, never blocks the sweep.
      if (outcome.status === "settled") {
        let achievers = 0;
        try {
          achievers = (await reader.achieverPayouts(outcome.txHash)).length;
        } catch (err) {
          console.error(`[agent/sweep] pool ${poolId}: could not count achievers for the ENS receipt: ${errorMessage(err)}`);
        }
        await writeSettlementReceipt({
          poolId,
          settleTxHash: outcome.txHash,
          achieverCount: achievers,
        });
      }
      // --- end ens ---
    } catch (err) {
      // Surfaced in the response, never swallowed: an unsettleable pool is a
      // participant whose stake is still stuck.
      poolErrors.push(`pool ${poolId}: ${errorMessage(err)}`);
    }
  }

  return { poolsSettled: poolsSettled.count, poolErrors };
}

async function runSweep(): Promise<SweepCounts> {
  const circle = getCircleClient();
  // Chain guard (money-path): refuse to sweep unless the settler wallet is on
  // Base. A wrong-chain CIRCLE_WALLET_ID reports COMPLETE on Circle while doing
  // nothing on Base, so an unattended cron would silently mark pools "settled"
  // that never paid. getSpotterWallet throws on a chain mismatch.
  await getSpotterWallet(circle);
  const deps: SettleClaimDeps = {
    spotter: { circle, reader: arcReader() },
    buy: liveBuyDeps(),
  };

  const startedAt = Date.now();
  const counts: SweepCounts = {
    swept: [],
    settled: 0,
    deferred: 0,
    errors: 0,
    recorded: 0,
    truncated: false,
    poolsSettled: 0,
    poolErrors: [],
    missesRecorded: 0,
    missesClosed: 0,
    missSkips: [],
    missErrors: [],
  };
  const seen = new Set<string>();
  /** Pools the claim phase owns this tick; the pool phase must not touch them. */
  const claimPools = new Set<string>();
  let recordAttempts = 0;

  const outOfTime = () => Date.now() - startedAt >= SWEEP_BUDGET_MS;

  const consider = async (rawGoalId: string): Promise<void> => {
    const goalId = rawGoalId.toLowerCase();
    if (seen.has(goalId)) return;
    seen.add(goalId);

    const ledger = await readLedger(goalId);
    const verdict = await eligibility(goalId, ledger, Date.now());
    if (verdict.poolId !== undefined) claimPools.add(verdict.poolId.toString());
    if (!verdict.settle && verdict.record !== undefined) {
      if (recordAttempts >= APPROVED_RECORDS_PER_SWEEP) return;
      recordAttempts += 1;
      counts.swept.push(goalId);
      try {
        const result = await recordApprovedClaim(goalId as Hex, verdict.record);
        if (result.status === "paid") {
          counts.recorded += 1;
          counts.settled += 1;
        } else if (result.status === "recorded") {
          // Recorded; the run loop queued it for settle at period end.
          counts.recorded += 1;
          counts.deferred += 1;
        } else {
          counts.errors += 1;
          console.error(
            `[agent/sweep] ${goalId}: approved claim not recorded this tick (run status ${result.status}); retrying next tick`,
          );
        }
      } catch (err) {
        counts.errors += 1;
        console.error(
          `[agent/sweep] ${goalId}: recording the approved claim failed: ${errorMessage(err)}`,
        );
      }
      return;
    }
    if (!verdict.settle) return;

    counts.swept.push(goalId);
    const outcome = await settleRecordedClaim(deps, {
      goalId: goalId as Hex,
      poolId: verdict.poolId,
      participant: verdict.participant,
    });
    if (outcome.status === "settled") counts.settled += 1;
    else if (outcome.status === "deferred") counts.deferred += 1;
    else counts.errors += 1;
  };

  const due = await listDuePendingSettlements(
    Math.floor(Date.now() / 1000),
    DUE_BATCH,
  );
  for (const goalId of due) {
    if (outOfTime()) {
      counts.truncated = true;
      return counts;
    }
    await consider(goalId);
  }

  // Migration path for claims recorded before the pending queue existed.
  for (const { goalId } of await listLedgerGoalIds(FALLBACK_SCAN_LIMIT)) {
    if (outOfTime()) {
      counts.truncated = true;
      return counts;
    }
    await consider(goalId);
  }

  // --- miss rule ---
  try {
    const misses = await runMissPhase(
      {
        spotter: { circle, reader: deps.spotter.reader },
        legacyRecordResult: recordResult,
        read: { pinnedProviderId, storedProviderId, providerConfigured, providerById },
        poolsAddress: requireHealthPoolsAddress() as Address,
      },
      { outOfTime: () => Date.now() - startedAt >= MISS_PHASE_BUDGET_MS },
    );
    counts.missesRecorded = misses.missesRecorded;
    counts.missesClosed = misses.missesClosed;
    counts.missSkips = misses.missSkips;
    counts.missErrors = misses.missErrors;
    if (misses.truncated) counts.truncated = true;
  } catch (err) {
    // Never blocks the pool phase: an unjudged pool is held until its hold
    // deadline and then settles, refunding whoever was not judged.
    counts.missErrors.push(`miss phase: ${errorMessage(err)}`);
  }
  // --- end miss rule ---

  const pools = await sweepDuePools(
    circle,
    deps.spotter.reader,
    claimPools,
    outOfTime,
  );
  counts.poolsSettled = pools.poolsSettled;
  counts.poolErrors = pools.poolErrors;

  // --- ens ---
  // Receipts the money path sent without waiting, or failed to send, are
  // finished here with inclusion asserted on TextUpdated logs. A settled
  // pool with no known settle tx is listed, never given an invented receipt.
  try {
    const receipts = await reconcileSettlementReceipts(
      deps.spotter.reader,
      (poolId) => storeSettleTxCache().read(poolId),
      outOfTime,
    );
    if (receipts.checked > 0 || receipts.skipped.length > 0) {
      console.log(
        `[agent/sweep] ens receipts: checked ${receipts.checked}, written ${receipts.written}, pending ${receipts.pending}` +
          (receipts.skipped.length > 0 ? `, skipped: ${receipts.skipped.join("; ")}` : ""),
      );
    }
  } catch (err) {
    console.error(`[agent/sweep] ens receipt reconciliation failed: ${errorMessage(err)}`);
  }
  // --- end ens ---

  return counts;
}

async function sweep(): Promise<Response> {
  const outcome = await withLock(SWEEP_LOCK, SWEEP_LOCK_TTL_MS, runSweep);
  if (outcome.acquired) return Response.json(outcome.value);
  // Another sweep (a cron tick, or a manual run) holds the lock. Overlapping
  // sweeps would race each other's settles, so this one changes nothing and
  // says so.
  return Response.json({
    swept: [],
    settled: 0,
    deferred: 0,
    errors: 0,
    recorded: 0,
    truncated: false,
    poolsSettled: 0,
    poolErrors: [],
    missesRecorded: 0,
    missesClosed: 0,
    missSkips: [],
    missErrors: [],
    skipped: "a sweep is already running",
  });
}

async function handle(request: Request): Promise<Response> {
  try {
    if (!authorized(request)) {
      return jsonError(401, "Missing or invalid authorization bearer token");
    }
    return await sweep();
  } catch (err) {
    // Never hand the caller raw internals: cron sees a generic failure, the
    // detail goes to the server log where the operator can read it.
    console.error(`[agent/sweep] failed: ${errorMessage(err)}`);
    return jsonError(500, "The settlement sweep failed. See the server logs.");
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
