// Recording a miss: the chain write, its money assert, and the ledger rows.
// Shared by the two paths that can record one:
//
//   the run loop   a player opens the run page after it ended; the run loop
//                  reads "not met" and asks adjudicateMissUnlocked (it already
//                  holds the claim's run lock)
//   the sweep      runMissPhase, every cron tick, for every joined player of
//                  every miss-eligible pool past its grace, whether or not
//                  they ever opened the app
//
// Nothing here decides the rule; lib/server/agent/miss.ts does. This module
// only acts on a decision, and it is careful in the same direction:
//
//   - a skip writes NO ledger row, so a player who never engaged does not
//     appear in the public feed
//   - the write goes to whichever key the chain trusts (SPOTTER's wallet when
//     it holds the oracle role, the legacy signer otherwise), with verdict
//     false and multiplier 0: no registry write, no payout screen, no World
//     approval, because a miss pays nobody
//   - success is asserted on chain state, never on a green transaction: the
//     participant must read back resultRecorded && !verdict
//   - ALREADY_RECORDED re-reads the participant: a pass there is never
//     overwritten or mislabelled; SETTLED means the pool paid out without
//     this result and is terminal
//
// After the pool settles, closeMissClaims writes each miss's closing row from
// the settle transaction's own events: RefundCredited for the player means
// nobody hit and the stake came back; otherwise the stake went to the players
// the same transaction paid (AchieverPaid).

import type { Address, Hex } from "viem";
import {
  appendLedger,
  defaultClaimCapUsd,
  findSpend,
  readLedger,
  type LedgerEntry,
} from "@/lib/server/agent/ledger";
import { withLock } from "@/lib/server/agent/lock";
import {
  appendErrorOnce,
  runLockName,
  RUN_LOCK_TTL_MS,
  spotterHoldsRole,
  type RunDeps,
} from "@/lib/server/agent/run";
import {
  recordResultAsSpotter,
  revertKind,
  type PoolState,
  type SpotterDeps,
} from "@/lib/server/agent/spotter";
import {
  evaluateMiss,
  missRulePool,
  missVerdictReason,
  passVerdictReason,
  type MissDecision,
  type MissPool,
  type MissReadDeps,
  type MissSkipBasis,
} from "@/lib/server/agent/miss";
import { readMissPool, writeMissPool } from "@/lib/server/agent/miss-store";
import { goalIdFor } from "@/lib/server/screening/gate";
import { errorMessage } from "@/lib/server/http";
import { missGraceSeconds } from "@/lib/miss-grace";
import type { ProviderId } from "@/lib/server/wearable/types";

/** Players judged per sweep. Each can be three provider reads. */
export const MISS_EVALS_PER_SWEEP = 6;
/** Misses written per sweep. Each is a chain write plus an inclusion wait. */
export const MISS_RECORDS_PER_SWEEP = 3;

/** The decision row's note: plain, deterministic, no health data. */
export const MISS_DECISION_NOTE =
  "not met, and the challenge is over. your wearable covered every day of it, so the miss goes on chain.";

export interface MissRecordDeps {
  spotter: SpotterDeps;
  legacyRecordResult: RunDeps["legacyRecordResult"];
  read: MissReadDeps;
  nowSeconds?: () => bigint;
  /** MISS_GRACE_HOURS in seconds; absent reads the environment. */
  graceSec?: number;
}

export type MissAdjudication =
  | { status: "recorded"; ledger: LedgerEntry[] }
  /** Nothing written. final: false means ask again later (before the grace,
   *  or a chain read that failed); final: true is the decision. */
  | {
      status: "skipped";
      basis: MissSkipBasis | "chain-read-error";
      final: boolean;
      ledger: LedgerEntry[];
    }
  | { status: "error"; message: string; ledger: LedgerEntry[] };

/** 6-decimal USDC as a two-decimal USD string, truncated, never rounded up. */
export function usdcToUsd2(amount: bigint): string {
  const cents = amount / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function missPoolOf(state: PoolState, poolId: bigint): MissPool | null {
  if (
    state.bountyModel === undefined ||
    state.goalSpec === undefined ||
    state.periodStart === undefined
  ) {
    return null;
  }
  return {
    id: poolId,
    bountyModel: state.bountyModel,
    goalSpec: state.goalSpec,
    settled: state.settled,
    cancelled: state.cancelled === true,
    periodStart: state.periodStart,
    periodEnd: state.periodEnd,
  };
}

function recordOf(
  ledger: readonly LedgerEntry[],
): Extract<LedgerEntry, { kind: "record" }> | undefined {
  return ledger.find(
    (e): e is Extract<LedgerEntry, { kind: "record" }> => e.kind === "record",
  );
}

type WriteOutcome =
  | { kind: "written"; txHash: Hex }
  | { kind: "already-recorded" }
  | { kind: "pool-settled" };

/** The chain write, dispatched exactly like a pass (run.ts RECORD step). */
async function writeMissOnChain(
  deps: MissRecordDeps,
  poolId: bigint,
  user: Address,
): Promise<WriteOutcome> {
  try {
    if (await spotterHoldsRole(deps, "oracle")) {
      const r = await recordResultAsSpotter(deps.spotter, {
        poolId,
        user,
        verdict: false,
        multiplierBps: 0,
      });
      return r.status === "recorded"
        ? { kind: "written", txHash: r.txHash }
        : { kind: "already-recorded" };
    }
    return {
      kind: "written",
      txHash: await deps.legacyRecordResult(poolId, user, false, 0n),
    };
  } catch (err) {
    const kind = revertKind(err);
    if (kind === "already-recorded") return { kind: "already-recorded" };
    if (kind === "pool-settled") return { kind: "pool-settled" };
    throw err;
  }
}

/**
 * The ledger rows for a recorded miss. The run loop already wrote the plan,
 * the read and a no-pay decision; the sweep path writes whichever of those
 * are missing, then the miss's own verdict and decision, then the record.
 */
/** The plan and the read's spend row, whichever are missing: every claim the
 *  sweep writes for starts the way a claim the player opened does. */
async function ensurePlanAndSpend(
  deps: MissRecordDeps,
  input: {
    goalId: Hex;
    poolId: bigint;
    address: Address;
    ref: string;
    providerId: ProviderId | null;
    note: string;
  },
): Promise<LedgerEntry[]> {
  const { goalId, ref } = input;
  let ledger = await readLedger(goalId);
  const provider = input.providerId === null ? null : deps.read.providerById(input.providerId);
  if (!ledger.some((e) => e.kind === "plan")) {
    ledger = await appendLedger(goalId, {
      kind: "plan",
      steps:
        provider === null
          ? []
          : [
              {
                service: provider.readService,
                label: provider.readLabel,
                estUsd: provider.readEstUsd,
              },
            ],
      capUsd: defaultClaimCapUsd(),
      poolId: input.poolId.toString(),
      participant: input.address,
    });
  }
  if (provider !== null && findSpend(ledger, provider.readService, ref) === undefined) {
    ledger = await appendLedger(goalId, {
      kind: "spend",
      service: provider.readService,
      label: provider.readLabel,
      amountUsd: provider.readEstUsd,
      ref,
      settlement: "prepaid",
      note: input.note,
    });
  }
  return ledger;
}

/**
 * A hit the sweep read for a player who has not confirmed it: the same
 * verdict row the pass path writes when the player opens the run, so their
 * run page and dashboard say "your wearable shows the goal met, confirm it"
 * instead of "not met" or "no proof". Written once; the run loop treats a
 * verdict newer than its last decision as fresh evidence and re-decides.
 */
async function writeMetRows(
  deps: MissRecordDeps,
  input: { goalId: Hex; poolId: bigint; address: Address; periodStart: bigint },
  met: NonNullable<Extract<MissDecision, { miss: false }>["met"]>,
): Promise<LedgerEntry[]> {
  const ref = `wearable-${input.periodStart.toString()}`;
  let ledger = await ensurePlanAndSpend(deps, {
    ...input,
    ref,
    providerId: met.providerId,
    note: "read once after the challenge ended; your wearable shows the goal met",
  });
  let latest: Extract<LedgerEntry, { kind: "verdict" }> | undefined;
  for (const entry of ledger) {
    if (entry.kind === "verdict" && entry.ref === ref) latest = entry;
  }
  if (latest?.verified === true) return ledger;
  ledger = await appendLedger(input.goalId, {
    kind: "verdict",
    verified: true,
    confidence: "high",
    reason: passVerdictReason(met.spec, met.qualifyingDays),
    ref,
    selfReported: false,
  });
  return ledger;
}

async function writeMissRows(
  deps: MissRecordDeps,
  input: {
    goalId: Hex;
    poolId: bigint;
    address: Address;
    state: PoolState & { periodStart: bigint };
    decision: Extract<MissDecision, { miss: true }> | null;
    resultTx: Hex | undefined;
  },
): Promise<LedgerEntry[]> {
  const { goalId } = input;
  const ref = `wearable-${input.state.periodStart.toString()}`;
  await ensurePlanAndSpend(deps, {
    goalId,
    poolId: input.poolId,
    address: input.address,
    ref,
    providerId: input.decision === null ? null : input.decision.providerId,
    note: "read once after the challenge ended, to check the whole challenge for a miss",
  });
  if (input.decision !== null) {
    await appendLedger(goalId, {
      kind: "verdict",
      verified: false,
      confidence: "high",
      reason: missVerdictReason(input.decision),
      ref,
      selfReported: false,
    });
    await appendLedger(goalId, {
      kind: "reason",
      decision: "no-pay",
      note: MISS_DECISION_NOTE,
      ref,
    });
  }
  return appendLedger(goalId, {
    kind: "record",
    goalId,
    resultTx: input.resultTx,
    registryStatus: "skipped",
    verdict: false,
    stakeUsd:
      input.state.entryFee === undefined ? undefined : usdcToUsd2(input.state.entryFee),
  });
}

/**
 * Judge one player and, on a miss, record it. The caller must hold the claim's
 * run lock (runLockName(goalId)); adjudicateMiss takes it for callers that do
 * not. Never records twice, never records false over a true, never records
 * when the chain already has a result.
 */
export async function adjudicateMissUnlocked(
  deps: MissRecordDeps,
  input: {
    goalId: Hex;
    poolId: bigint;
    address: Address;
    /** The sweep's call: when the read shows the goal met, write it to the
     *  player's ledger so they see the hit and the deadline to confirm it.
     *  The run loop never sets it (it writes its own read). */
    writeMetRow?: boolean;
  },
): Promise<MissAdjudication> {
  let ledger = await readLedger(input.goalId);
  const reader = deps.spotter.reader;
  if (reader.participantResult === undefined) {
    return {
      status: "error",
      message: "the chain reader cannot read participant results; no miss can be asserted",
      ledger,
    };
  }

  let state: PoolState;
  let participant: { joined: boolean; resultRecorded: boolean; verdict: boolean };
  try {
    state = await reader.getPoolState(input.poolId);
    participant = await reader.participantResult(input.poolId, input.address);
  } catch (err) {
    console.error(`[miss] chain read failed for ${input.goalId}: ${errorMessage(err)}`);
    return { status: "skipped", basis: "chain-read-error", final: false, ledger };
  }
  const pool = missPoolOf(state, input.poolId);
  if (pool === null || state.periodStart === undefined) {
    return { status: "skipped", basis: "chain-read-error", final: false, ledger };
  }
  const withStart = { ...state, periodStart: state.periodStart };

  // A false result on chain with no ledger row: SPOTTER's own write whose
  // append never landed (a lambda killed between the two). Reconcile the
  // receipt to the chain; the chain is the authority.
  if (
    participant.resultRecorded &&
    !participant.verdict &&
    recordOf(ledger) === undefined &&
    missRulePool(pool).ok
  ) {
    ledger = await writeMissRows(deps, {
      ...input,
      state: withStart,
      decision: null,
      resultTx: undefined,
    });
    return { status: "recorded", ledger };
  }

  const decision = await evaluateMiss(deps.read, {
    pool,
    address: input.address,
    participant,
    ledger,
    nowSec: deps.nowSeconds?.() ?? BigInt(Math.floor(Date.now() / 1000)),
    graceSec: deps.graceSec ?? missGraceSeconds(),
  });
  if (!decision.miss) {
    if (input.writeMetRow === true && decision.met !== undefined) {
      try {
        ledger = await writeMetRows(
          deps,
          { ...input, periodStart: state.periodStart },
          decision.met,
        );
      } catch (err) {
        // The row is a courtesy; the wait for the player does not depend on it.
        console.error(`[miss] could not write the hit row for ${input.goalId}: ${errorMessage(err)}`);
      }
    }
    return { status: "skipped", basis: decision.basis, final: decision.final, ledger };
  }

  try {
    const written = await writeMissOnChain(deps, input.poolId, input.address);
    if (written.kind === "pool-settled") {
      return { status: "skipped", basis: "pool-closed", final: true, ledger };
    }
    const after = await reader.participantResult(input.poolId, input.address);
    if (written.kind === "already-recorded" && after.resultRecorded && after.verdict) {
      // Somebody recorded a pass first. It stands; nothing to write here.
      return { status: "skipped", basis: "already-recorded", final: true, ledger };
    }
    if (!after.resultRecorded || after.verdict) {
      throw new Error(
        `the miss write${written.kind === "written" ? ` ${written.txHash}` : ""} did not leave a recorded miss on chain for ${input.address}; a green transaction is not a miss`,
      );
    }
    ledger = await writeMissRows(deps, {
      ...input,
      state: withStart,
      decision,
      resultTx: written.kind === "written" ? written.txHash : undefined,
    });
    return { status: "recorded", ledger };
  } catch (err) {
    const message = errorMessage(err);
    // Only a claim the player already started carries the red row; a player
    // who never engaged gets no ledger (it would put them in the feed).
    if (ledger.length > 0) {
      ledger = await appendErrorOnce(input.goalId, ledger, "record", message);
    }
    console.error(`[miss] recording the miss for ${input.goalId} failed: ${message}`);
    return { status: "error", message, ledger };
  }
}

/** adjudicateMissUnlocked under the claim's run lock; "busy" when a sibling
 *  (a polling browser) owns the claim right now. */
export async function adjudicateMiss(
  deps: MissRecordDeps,
  input: { goalId: Hex; poolId: bigint; address: Address; writeMetRow?: boolean },
): Promise<MissAdjudication | { status: "busy" }> {
  const outcome = await withLock(runLockName(input.goalId), RUN_LOCK_TTL_MS, () =>
    adjudicateMissUnlocked(deps, input),
  );
  return outcome.acquired ? outcome.value : { status: "busy" };
}

/**
 * Write the closing row for every recorded miss in a settled pool, asserted
 * on the settle transaction's events. Returns closed: true when every miss in
 * the pool has its row (or there are none), false when the settle transaction
 * could not be found or read, so the next pass tries again.
 */
export async function closeMissClaims(
  deps: { spotter: SpotterDeps; poolsAddress: Address },
  poolId: bigint,
  state: PoolState & { periodStart: bigint },
): Promise<{ closed: boolean; count: number; errors: string[] }> {
  const reader = deps.spotter.reader;
  if (
    reader.participants === undefined ||
    reader.participantResult === undefined ||
    reader.settleTxHash === undefined ||
    reader.settleLogs === undefined
  ) {
    return { closed: false, count: 0, errors: ["the chain reader cannot close misses"] };
  }
  const players = await reader.participants(poolId);
  const misses: Address[] = [];
  for (const player of players) {
    const result = await reader.participantResult(poolId, player);
    if (result.resultRecorded && !result.verdict) misses.push(player);
  }
  if (misses.length === 0) return { closed: true, count: 0, errors: [] };

  const txHash = await reader.settleTxHash(poolId);
  if (txHash === null) {
    return {
      closed: false,
      count: 0,
      errors: [`pool ${poolId}: settled, but its settle transaction was not found yet`],
    };
  }
  const logs = await reader.settleLogs(txHash, poolId);
  const errors: string[] = [];
  let count = 0;
  for (const player of misses) {
    const goalId = goalIdFor(deps.poolsAddress, poolId, player, state.periodStart);
    const ledger = await readLedger(goalId);
    const record = recordOf(ledger);
    if (record === undefined || record.verdict !== false) continue;
    if (ledger.some((e) => e.kind === "settle" && e.status === "closed")) continue;

    const same = (a: string) => a.toLowerCase() === player.toLowerCase();
    const refund = logs.refunded.find((r) => same(r.participant) && r.amount > 0n);
    if (refund !== undefined) {
      await appendLedger(goalId, {
        kind: "settle",
        status: "closed",
        outcome: "refunded",
        txHash,
        note: "nobody hit, so settle credited every stake back, this one included",
      });
      count += 1;
      continue;
    }
    const achievers = logs.paid.filter((p) => p.amount > 0n);
    if (achievers.length > 0 && !achievers.some((p) => same(p.participant))) {
      await appendLedger(goalId, {
        kind: "settle",
        status: "closed",
        outcome: "forfeited",
        txHash,
        note: `settle paid ${achievers.length} ${achievers.length === 1 ? "player" : "players"} who hit; this stake went to them`,
      });
      count += 1;
      continue;
    }
    // Neither a refund for this player nor a payout to anybody else: the
    // events do not say what happened to the stake. Say nothing rather than
    // guess, and surface it.
    errors.push(
      `pool ${poolId}: settle ${txHash} shows no refund for ${player} and no achiever paid; the miss row stays open`,
    );
  }
  return { closed: errors.length === 0, count, errors };
}

/**
 * Close every recorded miss in a pool its creator cancelled. HealthPoolsV3's
 * cancelPool() has no time guard: it works any time before settle, and after
 * it every joiner, a recorded miss included, takes their stake back through
 * claimRefund(). So the miss's closing row says the stake is refundable, and
 * nothing tells that player their stake went to the players who hit.
 */
async function closeCancelledMisses(
  deps: { spotter: SpotterDeps; poolsAddress: Address },
  poolId: bigint,
  periodStart: bigint,
): Promise<number> {
  const reader = deps.spotter.reader;
  if (reader.participants === undefined) return 0;
  let count = 0;
  for (const player of await reader.participants(poolId)) {
    const goalId = goalIdFor(deps.poolsAddress, poolId, player, periodStart);
    const ledger = await readLedger(goalId);
    const record = recordOf(ledger);
    if (record === undefined || record.verdict !== false) continue;
    if (ledger.some((e) => e.kind === "settle" && e.status === "closed")) continue;
    await appendLedger(goalId, {
      kind: "settle",
      status: "closed",
      outcome: "cancelled",
      note: "the creator cancelled the challenge before it settled, so every stake, this one included, can be claimed back",
    });
    count += 1;
  }
  return count;
}

export interface MissPhaseReport {
  missesRecorded: number;
  missesClosed: number;
  missSkips: { poolId: string; address: string; basis: string }[];
  missErrors: string[];
  truncated: boolean;
}

/**
 * The sweep's miss phase. For every pool that can record a miss and is past
 * its grace, judge each joined player once (a few per tick, resumable through
 * the per-pool record), then mark the pool done so settlement may proceed.
 * For every such pool that has settled, close its misses. Pools that can
 * never record a miss, or are finished, are marked closed and never read
 * again.
 */
export async function runMissPhase(
  deps: MissRecordDeps & { poolsAddress: Address },
  opts: { outOfTime: () => boolean },
): Promise<MissPhaseReport> {
  const report: MissPhaseReport = {
    missesRecorded: 0,
    missesClosed: 0,
    missSkips: [],
    missErrors: [],
    truncated: false,
  };
  const reader = deps.spotter.reader;
  if (reader.participants === undefined || reader.participantResult === undefined) {
    report.missErrors.push("the chain reader cannot list participants; miss phase skipped");
    return report;
  }
  const now = deps.nowSeconds?.() ?? BigInt(Math.floor(Date.now() / 1000));
  const grace = BigInt(deps.graceSec ?? missGraceSeconds());
  let evaluations = 0;

  const total = await reader.poolCount();
  for (let poolId = 1n; poolId <= total; poolId++) {
    if (opts.outOfTime()) {
      report.truncated = true;
      break;
    }
    try {
      const record = await readMissPool(poolId);
      if (record.closed) continue;
      const state = await reader.getPoolState(poolId);
      const pool = missPoolOf(state, poolId);
      if (pool === null || state.periodStart === undefined) {
        report.missErrors.push(`pool ${poolId}: pool fields unreadable; retrying next pass`);
        continue;
      }
      if (pool.cancelled) {
        report.missesClosed += await closeCancelledMisses(deps, poolId, pool.periodStart);
        await writeMissPool(poolId, { ...record, closed: true });
        continue;
      }
      if (!missRulePool(pool).ok) {
        await writeMissPool(poolId, { ...record, closed: true });
        continue;
      }
      if (pool.settled) {
        const closing = await closeMissClaims(deps, poolId, {
          ...state,
          periodStart: state.periodStart,
        });
        report.missesClosed += closing.count;
        report.missErrors.push(...closing.errors);
        if (closing.closed) await writeMissPool(poolId, { ...record, closed: true });
        continue;
      }
      if (now < pool.periodEnd + grace || record.done) continue;

      const players: Address[] = await reader.participants(poolId);
      let complete = true;
      for (const player of players) {
        const key = player.toLowerCase();
        if (record.evaluated[key] !== undefined) continue;
        if (record.waiting[key] !== undefined) {
          // A hit SPOTTER is waiting on. Only the chain can end the wait (the
          // player confirmed and the pass landed); the wearable is not read
          // again. Until then the pool holds, up to its hold deadline.
          try {
            const result = await reader.participantResult(poolId, player);
            if (result.resultRecorded) {
              record.evaluated[key] = "already-recorded";
              delete record.waiting[key];
              await writeMissPool(poolId, { ...record, done: false });
              continue;
            }
          } catch (err) {
            report.missErrors.push(`pool ${poolId}: ${player}: ${errorMessage(err)}`);
          }
          complete = false;
          continue;
        }
        if (
          opts.outOfTime() ||
          evaluations >= MISS_EVALS_PER_SWEEP ||
          report.missesRecorded >= MISS_RECORDS_PER_SWEEP
        ) {
          complete = false;
          report.truncated = true;
          break;
        }
        evaluations += 1;
        const goalId = goalIdFor(deps.poolsAddress, poolId, player, pool.periodStart);
        const outcome = await adjudicateMiss(deps, {
          goalId,
          poolId,
          address: player,
          writeMetRow: true,
        });
        if (outcome.status === "recorded") {
          record.evaluated[key] = "miss";
          report.missesRecorded += 1;
          // Saved per player, so a sweep killed mid-pool keeps its progress.
          await writeMissPool(poolId, { ...record, done: false });
        } else if (outcome.status === "skipped" && outcome.final) {
          report.missSkips.push({
            poolId: poolId.toString(),
            address: player,
            basis: outcome.basis,
          });
          if (outcome.basis === "met" || outcome.basis === "pass-in-progress") {
            // A hitter: settling now would refund them with no share. Wait
            // for their pass (or the hold deadline) instead.
            record.waiting[key] = outcome.basis;
            complete = false;
          } else {
            record.evaluated[key] = outcome.basis;
          }
          await writeMissPool(poolId, { ...record, done: false });
        } else {
          complete = false;
          if (outcome.status === "error") {
            report.missErrors.push(`pool ${poolId}: ${player}: ${outcome.message}`);
          }
        }
      }
      await writeMissPool(poolId, { ...record, done: complete });
    } catch (err) {
      report.missErrors.push(`pool ${poolId}: ${errorMessage(err)}`);
    }
  }
  return report;
}
