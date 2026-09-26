// What a run page says once the run is over: settled or cancelled. Pure and
// node-tested; PoolDetail and the sponsor console render what this decides.
//
// The chain is the only source. HealthPoolsV3 semantics this mirrors
// (contracts/src/HealthPoolsV3.sol):
//   - settle() refunds every participant with no recorded result (B-2),
//     credits each recorded achiever, and leaves a recorded miss's stake in
//     the pot. On a self-staked pool (model 2) that pot is split among the
//     players who hit, so a recorded miss's stake goes to them. SPOTTER
//     records a miss only when the wearable covered the whole run
//     (lib/server/agent/miss.ts); without that data nothing is recorded and
//     the stake is refunded.
//   - Model 2 (self-staked) with nobody hitting refunds every recorded staker
//     too, so no stake stays behind.
//   - cancelPool() pays nobody; every joiner takes their stake back through
//     claimRefund().
//   - sweep() returns the pool's remaining balance to the creator, only after
//     the pool is settled or cancelled, and on a cancelled pool only once every
//     refund was claimed (refundLiability == 0, else REFUNDS_PENDING).

import type { PoolPhase } from "@/lib/pool-lifecycle";

export interface ParticipantResult {
  resultRecorded: boolean;
  verdict: boolean;
}

export interface SettleTally {
  total: number;
  /** Recorded as hitting the goal. On an oracle-only pool (healthVerdict()
   *  = 0x0, every V4 pool) this is exactly who settle() counted. */
  achievers: number;
  /** No result recorded: refunded at settle (B-2). */
  refunded: number;
  /** Recorded as missing it. */
  missed: number;
}

export function settleTallyOf(results: readonly ParticipantResult[]): SettleTally {
  let achievers = 0;
  let refunded = 0;
  let missed = 0;
  for (const r of results) {
    if (!r.resultRecorded) refunded += 1;
    else if (r.verdict) achievers += 1;
    else missed += 1;
  }
  return { total: results.length, achievers, refunded, missed };
}

export interface RunEndInput {
  phase: Extract<PoolPhase, "settled" | "cancelled">;
  bountyModel: number;
  joined: boolean;
  /** Null while the per-participant reads are loading or failed. */
  tally: SettleTally | null;
}

export interface RunEndCopy {
  headline: string;
  body: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The card at the top of a finished run, for everyone who opens it: players,
 * the creator, and strangers. It says what actually happened on chain and
 * never claims a payout it did not read.
 */
export function runEndCopy(input: RunEndInput): RunEndCopy {
  if (input.phase === "cancelled") {
    return {
      headline: "Challenge cancelled",
      body: input.joined
        ? "The creator called this challenge off before it settled, so nobody was paid a prize. Every player takes their stake back; yours is below."
        : "The creator called this challenge off before it settled, so nobody was paid a prize and every player takes their stake back.",
    };
  }

  const tally = input.tally;
  if (tally === null) {
    return {
      headline: "This challenge has settled",
      body: "Every result on it is final on chain.",
    };
  }
  if (tally.total === 0) {
    return {
      headline: "This challenge has settled",
      body: "Nobody entered it, so there was nobody to pay.",
    };
  }
  if (tally.achievers === 0) {
    const stakesStayed = tally.missed > 0 && input.bountyModel !== 2;
    return {
      headline: "Settled. No hit was recorded",
      body: stakesStayed
        ? `No prize went out. ${plural(tally.refunded, "player with no recorded result was", "players with no recorded result were")} credited their stake back; ${plural(tally.missed, "recorded miss", "recorded misses")} stayed in the pot.`
        : "No prize went out. Every player's stake was credited back to them at settle.",
    };
  }
  return {
    headline: "This challenge has settled",
    body: `${tally.achievers} of ${tally.total} hit it and were credited from the pot.${
      input.bountyModel === 2 && tally.missed > 0
        ? ` The stakes of ${plural(tally.missed, "recorded miss", "recorded misses")} went to the players who hit.`
        : ""
    }${
      tally.refunded > 0
        ? ` ${plural(tally.refunded, "player", "players")} with no recorded result got their stake back.`
        : ""
    }`,
  };
}

/**
 * The lobby tag on a closed run. "Paid out" was the old label for every
 * settled pool, including cancelled ones and pools nobody hit; the chain flag
 * alone cannot say anyone was paid, so the tag names the state instead.
 */
export function closedRunTag(phase: PoolPhase): string {
  switch (phase) {
    case "cancelled":
      return "Cancelled";
    case "settled":
      return "Settled";
    default:
      return "Ended";
  }
}

export type SweepState =
  /** Not the creator, or the run is not over. */
  | { kind: "hidden" }
  /** The leftover can be taken back now, in one transaction. */
  | { kind: "ready"; amount: bigint }
  /** Cancelled, and players have not all taken their stake back. The contract
   *  refuses the sweep (REFUNDS_PENDING) until they do. */
  | { kind: "refunds-pending"; pendingStakes: number; pendingAmount: bigint }
  /** Nothing left in the pool. */
  | { kind: "empty" };

export interface SweepInput {
  phase: PoolPhase;
  isCreator: boolean;
  balance: bigint;
  entryFee: bigint;
  /** Only read for cancelled pools; null while loading or failed. */
  refundLiability: bigint | null;
}

export function sweepStateOf(input: SweepInput): SweepState {
  if (!input.isCreator) return { kind: "hidden" };
  if (input.phase !== "settled" && input.phase !== "cancelled") return { kind: "hidden" };
  if (input.phase === "cancelled") {
    // Unknown liability: do not offer a transaction the contract may refuse.
    if (input.refundLiability === null) return { kind: "hidden" };
    if (input.refundLiability > 0n) {
      const pendingStakes =
        input.entryFee > 0n ? Number(input.refundLiability / input.entryFee) : 0;
      return {
        kind: "refunds-pending",
        pendingStakes,
        pendingAmount: input.refundLiability,
      };
    }
  }
  if (input.balance <= 0n) return { kind: "empty" };
  return { kind: "ready", amount: input.balance };
}
